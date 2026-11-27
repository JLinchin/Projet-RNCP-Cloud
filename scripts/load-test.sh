#!/usr/bin/env bash
# Génère de la charge sur l'API pour démontrer l'autoscaling horizontal (HPA).
# Usage : scripts/load-test.sh [url] [durée_s] [concurrence]
#   puis, dans un autre terminal : kubectl -n library-prod get hpa backend -w
set -euo pipefail
URL="${1:-https://library.localhost}"; DURATION="${2:-180}"; CONC="${3:-40}"
CA="${CA_CERT:-$(dirname "$0")/../infra/terraform/.generated/ca.crt}"
HOST="$(echo "$URL" | sed -E 's#https?://([^/:]+).*#\1#')"
end=$((SECONDS + DURATION))
echo "Charge sur $URL/api/books pendant ${DURATION}s, $CONC clients"
worker() { while (( SECONDS < end )); do curl -s -o /dev/null --cacert "$CA" --resolve "$HOST:443:127.0.0.1" "$URL/api/books?q=a"; done; }
for _ in $(seq 1 "$CONC"); do worker & done
wait
echo "Terminé. Observer le retour à minReplicas après la fenêtre de stabilisation (2 min)."
