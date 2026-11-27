#!/usr/bin/env bash
# Tests de fumée post-déploiement : santé de l'API, version attendue, catalogue, front.
# Usage : scripts/smoke-test.sh https://library.localhost [version_attendue]
set -euo pipefail
BASE="${1:?URL de base}"
EXPECTED="${2:-}"
CA="${CA_CERT:-$(dirname "$0")/../infra/terraform/.generated/ca.crt}"
HOST="$(echo "$BASE" | sed -E 's#https?://([^/:]+).*#\1#')"
CURL=(curl -fsS --max-time 5 --retry 5 --retry-delay 2 --retry-all-errors --cacert "$CA" --resolve "$HOST:443:127.0.0.1")

echo "--> $BASE/api/health"
health="$("${CURL[@]}" "$BASE/api/health")"
echo "    $health"
if [[ -n "$EXPECTED" && "$health" != *"\"version\":\"$EXPECTED\""* ]]; then
  echo "ÉCHEC : version attendue $EXPECTED" >&2
  exit 1
fi
echo "--> $BASE/api/books";  "${CURL[@]}" "$BASE/api/books" >/dev/null
echo "--> $BASE/ (front)"
page="$("${CURL[@]}" "$BASE/")"
[[ "$page" == *"<title>Bibliothèque</title>"* ]] || { echo "ÉCHEC : page d'accueil inattendue" >&2; exit 1; }
echo "--> en-tête HSTS"
headers="$("${CURL[@]}" -I "$BASE/")"
grep -qi "strict-transport-security" <<< "$headers" || { echo "ÉCHEC : HSTS absent" >&2; exit 1; }
echo "Tests de fumée OK"
