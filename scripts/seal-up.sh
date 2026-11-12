#!/usr/bin/env bash
# scripts/seal-up.sh: phase 1 (make seal-up). The network, then vault-s
# (Shamir, Raft). Sealed or uninitialised is fine here: phase seal-init
# initialises and unseals it.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
openssl verify -CAfile vault-tls/ca-chain.pem vault-tls/vault.crt >/dev/null 2>&1 || die "seal-up: vault-tls/vault.crt does not verify: run make gen-certs"
[ -s .secrets/vault/vault.hclic ] || die "seal-up: no licence at .secrets/vault/vault.hclic: run make license"
"$VID_ROOT/scripts/network.sh"
"$VID_ROOT/scripts/compose.sh" seal up -d vault-s >/dev/null
vault_node vault-s
vault_wait reachable 45
state=$(vault_json)
echo "seal-up: vault-s answers (initialized=$(jq -r .initialized <<<"$state"), sealed=$(jq -r .sealed <<<"$state"))"
