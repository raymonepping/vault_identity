#!/usr/bin/env bash
# scripts/vault-up.sh: phase 5 (make vault-up) and the cold start. vault-s
# up and unsealed, then vault-1, vault-2, vault-3 in that order; each
# unseals itself through Transit with its own seal token. A node whose seal
# Vault is unreachable exits at start, so the order matters (gotcha 2).
# On the very first run the cluster is not initialised yet: phase bootstrap
# does that, so this script stops at "answers".
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
compose() { "$VID_ROOT/scripts/compose.sh" "$@"; }

"$VID_ROOT/scripts/network.sh"
compose seal up -d vault-s >/dev/null
"$VID_ROOT/scripts/vault-unseal.sh"
vault_node vault-s
vault_wait active
for node in $VID_CLUSTER_NODES; do
  [ -s "$VID_STATE/seal/$node" ] || die "vault-up: no seal token for $node: run make seal-tokens"
done

# Nodes whose seal token phase seal-tokens replaced read it at start only.
restart=$(cat "$BUILD_DIR/seal-restart" 2>/dev/null | sort -u | tr '\n' ' ' || true)
for node in $VID_CLUSTER_NODES; do
  if [[ " $restart " == *" $node "* ]] && [ "$(vid_container_state "$(vault_container "$node")")" = running ]; then
    podman restart "$(vault_container "$node")" >/dev/null
    echo "vault-up: $node restarted to read its new seal token"
  else
    compose vault up -d "$node" >/dev/null 2>&1
  fi
  vault_node "$node"
  vault_wait reachable 45
done
rm -f "$BUILD_DIR/seal-restart"

vault_node vault-1
if ! vault_json | jq -e '.initialized' >/dev/null; then
  echo "vault-up: vault-s active, vault-1..3 answer; the cluster is not initialised yet (phase bootstrap)"
  exit 0
fi
for node in $VID_CLUSTER_NODES; do
  vault_node "$node"
  vault_wait unsealed 90
done
# Unsealed is not yet serving: wait until one voter has won the election.
for _ in $(seq 1 60); do
  for node in $VID_CLUSTER_NODES; do
    vault_node "$node"
    if curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/sys/leader" | jq -e '.is_self' >/dev/null 2>&1; then
      echo "vault-up: vault-s active, vault-1..3 unsealed, $node is the leader"
      exit 0
    fi
  done
  sleep 2
done
die "vault-up: no cluster leader after 120s (make vault-status, make vault-logs)"
