#!/usr/bin/env bash
# Construit les 3 images, les tague avec le SHA du commit et les pousse vers le registre local.
# Usage : scripts/build-push.sh [tag]
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-$(git rev-parse --short HEAD)}"
REGISTRY="${REGISTRY:-localhost:5001}"

for c in backend worker frontend; do
  image="$REGISTRY/biblio-$c:$TAG"
  echo "==> $image"
  docker build --pull --build-arg APP_VERSION="$TAG" -t "$image" "$c"
  # Scan local optionnel si Trivy est installé sur le poste/runner
  if command -v trivy >/dev/null; then
    trivy image --quiet --severity CRITICAL --ignore-unfixed --exit-code 1 "$image"
  fi
  docker push "$image"
done
echo "Images publiées avec le tag $TAG"
