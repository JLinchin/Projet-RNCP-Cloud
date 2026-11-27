#!/usr/bin/env bash
# Déploiement canary du back-end puis promotion automatique (ou annulation).
#  1. la nouvelle version est déployée sur 1 pod « canary » à côté des pods stables
#     (même Service => ~1/3 du trafic avec 2 pods stables) ;
#  2. analyse : N requêtes réelles via l'Ingress, 0 erreur tolérée, pod canary sans redémarrage ;
#  3. succès => promotion (rolling update de toutes les briques) ; échec => retrait du canary.
# Usage : scripts/canary.sh <namespace> <tag> <fichier-values> <url>
set -euo pipefail
NS="$1"; TAG="$2"; VALUES="$3"; URL="$4"
REQUESTS="${CANARY_REQUESTS:-60}"
CHART="$(dirname "$0")/../helm/library"
CA="${CA_CERT:-$(dirname "$0")/../infra/terraform/.generated/ca.crt}"
HOST="$(echo "$URL" | sed -E 's#https?://([^/:]+).*#\1#')"
export HELM_DRIVER="${HELM_DRIVER:-configmap}"

current="$(kubectl -n "$NS" get deploy backend -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | awk -F: '{print $NF}' || true)"
if [[ -z "$current" ]]; then
  echo "Premier déploiement : installation directe de $TAG"
  helm upgrade --install library "$CHART" -n "$NS" -f "$VALUES" --set image.tag="$TAG" --atomic --wait --timeout 5m
  exit 0
fi
if [[ "$current" == "$TAG" ]]; then
  echo "Version $TAG déjà en production"; exit 0
fi

rollback() {
  echo "!! Canary en échec : retrait du canary, la production reste en $current" >&2
  helm upgrade library "$CHART" -n "$NS" -f "$VALUES" --set image.tag="$current" --set canary.enabled=false --wait --timeout 5m
  exit 1
}

echo "==> Canary : stable=$current, canary=$TAG"
helm upgrade --install library "$CHART" -n "$NS" -f "$VALUES" \
  --set image.tag="$current" --set canary.enabled=true --set canary.tag="$TAG" --wait --timeout 3m || rollback
kubectl -n "$NS" rollout status deploy/backend-canary --timeout=180s || rollback

errors=0; served_by_canary=0
for _ in $(seq 1 "$REQUESTS"); do
  body="$(curl -s --max-time 5 --cacert "$CA" --resolve "$HOST:443:127.0.0.1" -w ' %{http_code}' "$URL/api/health" || echo ' 000')"
  code="${body##* }"
  [[ "$code" == "200" ]] || errors=$((errors + 1))
  [[ "$body" == *"\"version\":\"$TAG\""* ]] && served_by_canary=$((served_by_canary + 1))
  sleep 0.5
done
restarts="$(kubectl -n "$NS" get pods -l track=canary -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | awk '{s+=$1} END {print s+0}')"
echo "Analyse : $REQUESTS requêtes, $errors erreur(s), $served_by_canary servie(s) par le canary, $restarts redémarrage(s)"

[[ "$errors" -eq 0 && "$restarts" -eq 0 && "$served_by_canary" -gt 0 ]] || rollback

echo "==> Promotion de $TAG"
helm upgrade library "$CHART" -n "$NS" -f "$VALUES" --set image.tag="$TAG" --set canary.enabled=false --atomic --wait --timeout 5m
"$(dirname "$0")/smoke-test.sh" "$URL" "$TAG"
