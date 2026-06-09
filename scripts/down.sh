#!/usr/bin/env bash
# Stop the stack. Pass --wipe to also delete all node data (fresh start next up).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose down
if [ "${1:-}" = "--wipe" ]; then
  rm -rf data
  echo "Wiped ./data — next up starts from scratch."
fi
