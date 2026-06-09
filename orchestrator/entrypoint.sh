#!/bin/sh
# Orchestrator container entrypoint: wait for the 10 nodes, create DIDs on first
# run, (re)wire quorums, then serve the UI + API. Idempotent and reboot-safe.
set -e
cd /app
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

echo "[orch] waiting for nodes..."
node wait-nodes.mjs

if [ ! -f "$DATA_DIR/node_registry.json" ]; then
  echo "[orch] first run — creating + registering one DID per node"
  node bootstrap-dids.mjs
else
  echo "[orch] node_registry.json present — skipping DID creation"
fi

echo "[orch] wiring network (register + setup/addquorum, idempotent)"
node wire-network.mjs || echo "[orch] wire-network reported issues — continuing"

echo "[orch] starting UI + API on :${PORT:-4000}"
exec node server-v2.mjs
