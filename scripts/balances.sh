#!/usr/bin/env bash
# Show every node's DID(s) with their RBT (+ pledged) and FT balances.
#
#   ./scripts/balances.sh              # query localhost
#   HOST=1.2.3.4 ./scripts/balances.sh # query a remote host
#
# Pulls the node list from data/orchestrator/node_registry.json, then asks each
# node for ALL the DIDs it holds (bootstrap DID + any customer DIDs on node9/10)
# and their balances.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REG="data/orchestrator/node_registry.json"
HOST="${HOST:-localhost}"

command -v jq >/dev/null 2>&1 || { echo "jq is required:  sudo apt-get install -y jq"; exit 1; }
[ -f "$REG" ] || { echo "No $REG yet — bring the stack up and let the orchestrator bootstrap first."; exit 1; }

echo "Rubix node balances ($HOST)"
printf "%-7s %-11s %-7s %-8s %-30s %s\n" "NODE" "ROLE" "RBT" "PLEDGED" "FT HOLDINGS" "DID"
printf '%.0s-' {1..100}; echo

# node list from the registry, sorted by port
jq -r '.nodes | to_entries[] | [.value.port, .key, .value.role, .value.did] | @tsv' "$REG" \
  | sort -n \
  | while IFS=$'\t' read -r port name role regdid; do
      base="http://$HOST:$port"

      # every DID this node holds (falls back to the registry DID if the API is empty)
      dids="$(curl -s --max-time 5 "$base/rubix/v1/dids" 2>/dev/null | jq -r '(.result // [])[]? // empty')"
      if [ -z "$dids" ]; then
        if curl -s --max-time 3 "$base/api/ping" >/dev/null 2>&1; then dids="$regdid"; else
          printf "%-7s %-11s %s\n" "$name" "$role" "(offline)"
          continue
        fi
      fi

      for did in $dids; do
        rbtj="$(curl -s --max-time 5 "$base/rubix/v1/dids/$did/balances/rbt" 2>/dev/null)"
        ftj="$(curl -s --max-time 5 "$base/rubix/v1/dids/$did/balances/ft" 2>/dev/null)"
        bal="$(echo "$rbtj"  | jq -r '.result.balance // 0' 2>/dev/null)"
        pl="$(echo "$rbtj"   | jq -r '.result.pledged // 0' 2>/dev/null)"
        fts="$(echo "$ftj"   | jq -r '(.result // []) | map("\(.name):\(.count)") | join(", ")' 2>/dev/null)"
        [ -z "$fts" ] && fts="-"
        printf "%-7s %-11s %-7s %-8s %-30s %s\n" "$name" "$role" "${bal:-0}" "${pl:-0}" "$fts" "$did"
      done
  done
