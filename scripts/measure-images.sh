#!/usr/bin/env bash
# Mesure FinOps n°1 : taille des images (stockage registre, temps de pull, surface d'attaque).
# Compare le Dockerfile « naïf » (finops/) au Dockerfile multi-stage optimisé.
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -q -f finops/Dockerfile.backend.naive -t biblio-backend:naive backend >/dev/null
docker build -q -t biblio-backend:optimized backend >/dev/null
for t in naive optimized; do
  size=$(docker image inspect "biblio-backend:$t" --format '{{.Size}}')
  printf "biblio-backend:%-10s %6d Mo\n" "$t" $((size / 1024 / 1024))
done
if command -v trivy >/dev/null; then
  for t in naive optimized; do
    n=$(trivy image --quiet --format json "biblio-backend:$t" | jq '[.Results[]?.Vulnerabilities[]?] | length')
    echo "vulnérabilités détectées ($t) : $n"
  done
fi
