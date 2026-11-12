#!/usr/bin/env bash
# scripts/root-regen.sh [--revoke] <seal|vault>
#
# Only when the operator asks (D6). Runs `vault operator generate-root` with a
# one-time password and the saved unseal key (seal) or recovery key (vault),
# and writes the root token to .secrets/vault/root-<cluster> (0600). It
# prints where the token is, never the token. --revoke revokes and deletes it.
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

revoke=false
if [ "${1:-}" = --revoke ]; then
  revoke=true
  shift
fi
cluster=${1:?Usage: root-regen.sh [--revoke] seal|vault}
case "$cluster" in
seal) vault_node vault-s ;;
vault) vault_cluster ;;
*)
  echo "root-regen: unknown cluster $cluster (seal|vault)" >&2
  exit 64
  ;;
esac
out="$VID_STATE/root-$cluster"

if [ "$revoke" = true ]; then
  [ -s "$out" ] || {
    echo "root-regen: no regenerated root token for $cluster"
    exit 0
  }
  VAULT_TOKEN=$(cat "$out") vault token revoke -self >/dev/null 2>&1 || true
  rm -f "$out"
  echo "root-regen: $cluster root token revoked and ${out#"$VID_ROOT"/} deleted"
  exit 0
fi

# Vault 2.0: generate-root needs a token as well as the key share
# (HCSEC-2026-08). The Ansible token of that cluster holds sys/generate-root/*.
if [ "$cluster" = seal ]; then vault_token ansible-seal; else vault_token ansible-platform; fi
[ ! -s "$out" ] || {
  echo "root-regen: ${out#"$VID_ROOT"/} already exists; make root-revoke CLUSTER=$cluster first" >&2
  exit 1
}
if [ "$cluster" = seal ]; then
  key=$(vault_init_field seal '.unseal_keys_b64[0]')
else
  key=$(vault_init_field vault '.recovery_keys_b64[0]')
fi
vault operator generate-root -cancel >/dev/null 2>&1 || true
otp=$(vault operator generate-root -generate-otp)
nonce=$(vault operator generate-root -init -otp="$otp" -format=json | jq -r '.nonce')
encoded=$(vault operator generate-root -nonce="$nonce" -format=json "$key" | jq -r '.encoded_token')
unset key
[ -n "$encoded" ] && [ "$encoded" != null ] || {
  echo "root-regen: generate-root did not complete" >&2
  exit 1
}
token=$(vault operator generate-root -decode="$encoded" -otp="$otp")
unset otp encoded
: >"$out"
chmod 600 "$out"
printf '%s' "$token" >"$out"
VAULT_TOKEN=$token vault token lookup >/dev/null
unset token VAULT_TOKEN
echo "root-regen: $cluster root token written to ${out#"$VID_ROOT"/} (0600). Revoke it with make root-revoke CLUSTER=$cluster."
