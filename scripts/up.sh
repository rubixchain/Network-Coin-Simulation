#!/usr/bin/env bash
# Bring up the whole stack (10 nodes + 10 postgres + demo UI) in one command.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f .env ] || cp .env.example .env

if [ -z "${EXTERNAL_IP:-}" ]; then
  EXTERNAL_IP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
export EXTERNAL_IP

docker compose up -d --build
echo
echo "Stack starting (first run downloads the node binary + builds images — a few minutes)."
echo "UI:   http://${EXTERNAL_IP:-localhost}:8080"
echo "Logs: docker compose logs -f orchestrator"
echo "Open firewall: 8080/tcp (UI); 4001-4010/tcp only for inbound RBT from external nodes."
echo "Then fund node1 (issuer) + node7/node8 (quorums) with test RBT."
