#!/usr/bin/env bash
# scripts/seal-token-rotate.sh <node>: give one cluster node a new seal token,
# recreate only that node, wait until it is unsealed again, then revoke the
# old token. The other nodes are untouched: each has its own token.
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

node=${1:?Usage: make seal-token-rotate NODE=vault-1|vault-2|vault-3}
[ "$(vault_cluster_of "$node")" = vault ] || {
  echo "seal-token-rotate: $node is not a cluster node" >&2
  exit 64
}
file="$VID_STATE/seal/$node"

vault_node vault-s
vault_token ansible-seal
old_accessor=""
if [ -s "$file" ]; then
  # token=@file: the CLI reads the file itself, so the token never shows in ps.
  old_accessor=$(vault write -format=json auth/token/lookup token=@"$file" 2>/dev/null | jq -r '.data.accessor' || true)
fi
t=$(vault token create -role=autounseal -display-name="vid-seal-$node" -field=token)
new_accessor=$(vault token lookup -format=json "$t" | jq -r '.data.accessor')
# Write in place: the file is a single-file bind mount (keep the inode).
: >"$file"
printf '%s' "$t" >"$file"
unset t VAULT_TOKEN
echo "seal-token-rotate: $node has a new seal token (accessor $(fingerprint "$new_accessor"))"

"$VID_ROOT/scripts/compose.sh" vault up -d --force-recreate "$node" >/dev/null 2>&1
vault_node "$node"
vault_wait unsealed 90
echo "seal-token-rotate: $node restarted and unsealed with the new token"

if [ -n "$old_accessor" ] && [ "$old_accessor" != null ]; then
  vault_node vault-s
  vault_token ansible-seal
  vault write -f auth/token/revoke-accessor accessor="$old_accessor" >/dev/null 2>&1 || true
  echo "seal-token-rotate: old token revoked (accessor $(fingerprint "$old_accessor"))"
fi
