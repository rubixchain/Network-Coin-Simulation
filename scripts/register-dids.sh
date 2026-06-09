#!/usr/bin/env bash
# Register every node's DID(s) on the network (two-step signature flow).
#
#   ./scripts/register-dids.sh           # register all DIDs on all nodes
#   ./scripts/register-dids.sh node7     # only that node
#   HOST=1.2.3.4 ./scripts/register-dids.sh
#
# Registration publishes the DID<->peerID mapping so other nodes (and quorums)
# can resolve it. It's idempotent — safe to re-run, e.g. after a restart.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REG="data/orchestrator/node_registry.json"
HOST="${HOST:-localhost}"
ONLY="${1:-}"

command -v jq >/dev/null 2>&1 || { echo "jq is required:  sudo apt-get install -y jq"; exit 1; }
[ -f "$REG" ] || { echo "No $REG yet — bring the stack up first."; exit 1; }

PASSWORD="$(jq -r '.didPassword // "mypassword"' "$REG")"

register_did() {  # $1=base url  $2=did
  local base="$1" did="$2" resp id final msg
  resp="$(curl -s --max-time 30 -X POST "$base/rubix/v1/dids/$did/register")"
  id="$(echo "$resp" | jq -r '.result.id // empty' 2>/dev/null)"
  if [ -n "$id" ]; then
    final="$(curl -s --max-time 60 -X POST "$base/rubix/v1/signature" \
              -H 'Content-Type: application/json' \
              -d "{\"id\":\"$id\",\"password\":\"$PASSWORD\"}")"
    msg="$(echo "$final" | jq -r '.message // "no response"' 2>/dev/null)"
  else
    msg="$(echo "$resp" | jq -r '.message // "no response"' 2>/dev/null)"
  fi
  echo "$msg"
}

jq -r '.nodes | to_entries[] | [.value.port, .key, .value.did] | @tsv' "$REG" \
  | sort -n \
  | while IFS=$'\t' read -r port name regdid; do
      [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
      base="http://$HOST:$port"
      dids="$(curl -s --max-time 5 "$base/rubix/v1/dids" 2>/dev/null | jq -r '(.result // [])[]? // empty')"
      [ -z "$dids" ] && dids="$regdid"
      for did in $dids; do
        printf "%-7s %-12s " "$name" "${did:0:12}…"
        register_did "$base" "$did"
      done
  done
