#!/usr/bin/env bash
# scripts/vault-status.sh: one row per Vault node, then the Raft voters.
# Read-only.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

printf '%-8s %-10s %-5s %-6s %-8s %-8s %-7s %s\n' NODE CONTAINER INIT SEALED SEAL HA RAFT VERSION
for node in vault-s $VID_CLUSTER_NODES; do
  cstate=$(vid_container_state "$(vault_container "$node")")
  if [ "$cstate" != running ]; then
    printf '%-8s %-10s\n' "$node" "$cstate"
    continue
  fi
  vault_node "$node"
  if ! s=$(vault_json 2>/dev/null); then
    printf '%-8s %-10s %s\n' "$node" "$cstate" "unreachable"
    continue
  fi
  ha=-
  if jq -e '.initialized and (.sealed | not)' <<<"$s" >/dev/null; then
    ha=$(curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/sys/leader" | jq -r 'if .is_self then "active" else "standby" end' 2>/dev/null || echo -)
  fi
  printf '%-8s %-10s %-5s %-6s %-8s %-8s %-7s %s\n' "$node" "$cstate" \
    "$(jq -r .initialized <<<"$s")" "$(jq -r .sealed <<<"$s")" "$(jq -r .type <<<"$s")" \
    "$ha" "$(jq -r '.raft_committed_index // "-"' <<<"$s")" "$(jq -r .version <<<"$s")"
done

if [ -s "$VID_STATE/tokens/ansible-platform" ]; then
  vault_cluster
  vault_token ansible-platform
  echo
  echo "Raft peers"
  vault operator raft list-peers -format=json 2>/dev/null |
    jq -r '.data.config.servers[] | "  \(.node_id)  \(if .leader then "leader" else "follower" end)  voter=\(.voter)"' ||
    echo "  (could not read the Raft configuration)"
fi
