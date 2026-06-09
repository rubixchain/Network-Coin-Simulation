#!/usr/bin/env bash
# Build the rubix-node image from the official release binary, and optionally
# push it to a registry so cloud VMs can pull instead of building.
#
#   ./scripts/build-node-image.sh                       # build locally
#   RUBIX_VERSION=v1.0.1 ./scripts/build-node-image.sh   # build a newer release
#   RUBIX_NODE_IMAGE=ghcr.io/you/rubix-node:v1.0.0 PUSH=1 ./scripts/build-node-image.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="${RUBIX_NODE_IMAGE:-network-coin/rubix-node:v1.0.0}"
VER="${RUBIX_VERSION:-v1.0.0}"

echo "Building $IMAGE from rubixgoplatform $VER ..."
docker build --build-arg RUBIX_VERSION="$VER" -t "$IMAGE" docker/node
echo "Built $IMAGE"

if [ "${PUSH:-0}" = "1" ]; then
  docker push "$IMAGE"
  echo "Pushed $IMAGE — set RUBIX_NODE_IMAGE=$IMAGE in .env to pull it everywhere."
fi
