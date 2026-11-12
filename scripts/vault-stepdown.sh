#!/usr/bin/env bash
# scripts/vault-stepdown.sh: ask the active node to step down and wait until
# another voter is active. ansible-platform token (sys/step-down).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

leader() {
  local n
  for n in $VID_CLUSTER_NODES; do
    vault_node "$n"
    if curl -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/sys/leader" | jq -e '.is_self' >/dev/null 2>&1; then
      echo "$n"
      return 0
    fi
  done
  return 1
}

before=$(leader) || {
  echo "stepdown: no active node found" >&2
  exit 1
}
vault_node "$before"
vault_token ansible-platform
vault operator step-down >/dev/null
unset VAULT_TOKEN
for _ in $(seq 1 30); do
  sleep 2
  after=$(leader) || continue
  if [ "$after" != "$before" ]; then
    echo "stepdown: $before stepped down, $after is active"
    exit 0
  fi
done
echo "stepdown: $before is still (or again) active after 60s" >&2
exit 1
