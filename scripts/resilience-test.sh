#!/usr/bin/env bash
# Tests de résilience : (1) suppression de pods, (2) rolling update sous trafic,
# (3) persistance des données après suppression du pod PostgreSQL.
# Usage : scripts/resilience-test.sh [namespace] [url]
set -euo pipefail
NS="${1:-library-prod}"; URL="${2:-https://library.localhost}"
CA="${CA_CERT:-$(dirname "$0")/../infra/terraform/.generated/ca.crt}"
HOST="$(echo "$URL" | sed -E 's#https?://([^/:]+).*#\1#')"
LOG="$(mktemp)"

probe() { # sonde continue : 1 requête / 100 ms, journalise le code HTTP
  while :; do curl -s -o /dev/null -w '%{http_code}\n' --max-time 2 --cacert "$CA" --resolve "$HOST:443:127.0.0.1" "$URL/api/books" >> "$LOG"; sleep 0.1; done
}
report() { local total ok; total=$(wc -l < "$LOG"); ok=$(grep -c '^200$' "$LOG" || true); echo "    $ok/$total requêtes OK ($((total - ok)) en erreur)"; : > "$LOG"; }

probe & PROBE=$!
trap 'kill $PROBE 2>/dev/null; rm -f "$LOG"' EXIT

echo "1) Suppression brutale d'un pod back-end"
victim="$(kubectl -n "$NS" get pod -l app.kubernetes.io/name=backend,track=stable -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" delete pod "$victim" --wait=false
sleep 20; kubectl -n "$NS" get pods -l app.kubernetes.io/name=backend; report

echo "2) Rolling update sous trafic (maxUnavailable=0, preStop, readiness)"
kubectl -n "$NS" rollout restart deploy/backend
kubectl -n "$NS" rollout status deploy/backend --timeout=180s; report

echo "3) Persistance : suppression du pod PostgreSQL"
before=$(curl -s --cacert "$CA" --resolve "$HOST:443:127.0.0.1" "$URL/api/books" | grep -o '"id"' | wc -l)
kubectl -n "$NS" delete pod postgres-0
kubectl -n "$NS" wait --for=condition=Ready pod/postgres-0 --timeout=180s
sleep 10
after=$(curl -s --cacert "$CA" --resolve "$HOST:443:127.0.0.1" "$URL/api/books" | grep -o '"id"' | wc -l)
echo "    ouvrages avant : $before / après : $after"; report
[[ "$before" == "$after" ]] && echo "Données persistées (PersistentVolume)" || { echo "ÉCART DE DONNÉES" >&2; exit 1; }
