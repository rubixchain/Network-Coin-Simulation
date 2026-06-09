#!/usr/bin/env bash
# One-shot cloud deploy: install Docker if missing, then bring up the stack.
# Recommended to run as root (or with sudo) on a fresh Linux VM.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
  command -v systemctl >/dev/null 2>&1 && $SUDO systemctl enable --now docker || true
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 required"; exit 1; }

chmod +x scripts/*.sh 2>/dev/null || true
./scripts/up.sh
