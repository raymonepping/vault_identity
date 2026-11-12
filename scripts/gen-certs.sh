#!/usr/bin/env bash
# scripts/gen-certs.sh: the lab CA and the Vault listener certificate.
#
#   .secrets/tls/ca.key, ca.crt   lab root CA (created once, never replaced silently)
#   vault-tls/vault.crt           leaf (every Vault node and the console share it)
#   vault-tls/vault.key           its key (gitignored)
#   vault-tls/ca-chain.pem        the CA certificate; what every client trusts
#   .secrets/issuer/signing.pem   the lab OAuth issuer's ES256 key (D12; created once)
#   .secrets/issuer/signing.pub.pem  its public key (Terraform gives it to Vault's profile)
#
# Usage: gen-certs.sh [--reissue | --status]
set -euo pipefail
umask 077

ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TLS_DIR="$ROOT/vault-tls"
CA_DIR="$ROOT/.secrets/tls"
SANS="DNS:vault-s,DNS:vault-1,DNS:vault-2,DNS:vault-3,DNS:postgres,DNS:web,DNS:api,DNS:observatory.localhost,DNS:localhost,IP:127.0.0.1"

status() {
  [ -f "$TLS_DIR/vault.crt" ] || {
    echo "vault-tls/vault.crt: missing (run make gen-certs)"
    return 1
  }
  openssl x509 -in "$TLS_DIR/vault.crt" -noout -subject -issuer -enddate
  openssl x509 -in "$TLS_DIR/vault.crt" -noout -ext subjectAltName | tail -1 | sed 's/^ */SANs: /'
  if openssl verify -CAfile "$TLS_DIR/ca-chain.pem" "$TLS_DIR/vault.crt" >/dev/null 2>&1; then
    echo "Chain: verifies against vault-tls/ca-chain.pem"
  else
    echo "Chain: DOES NOT VERIFY against vault-tls/ca-chain.pem"
    return 1
  fi
}

create_ca() {
  [ -s "$CA_DIR/ca.key" ] && [ -s "$CA_DIR/ca.crt" ] && return 0
  if [ -e "$CA_DIR/ca.key" ] || [ -e "$CA_DIR/ca.crt" ]; then
    echo "gen-certs: .secrets/tls has half a CA (key or certificate missing); refusing to replace it." >&2
    exit 1
  fi
  echo "gen-certs: creating the lab root CA"
  openssl ecparam -genkey -name secp384r1 -noout -out "$CA_DIR/ca.key"
  openssl req -new -x509 -sha384 -days 1825 -key "$CA_DIR/ca.key" \
    -subj "/O=Vault Identity Lab/CN=Vault Identity Lab CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$CA_DIR/ca.crt"
}

leaf_is_current() {
  [ -s "$TLS_DIR/vault.crt" ] && [ -s "$TLS_DIR/vault.key" ] &&
    openssl verify -CAfile "$CA_DIR/ca.crt" "$TLS_DIR/vault.crt" >/dev/null 2>&1 &&
    openssl x509 -in "$TLS_DIR/vault.crt" -noout -checkend 2592000 >/dev/null 2>&1
}

# ca-chain.pem is what every client trusts; it must be the lab CA itself.
chain_is_current() {
  cmp -s "$CA_DIR/ca.crt" "$TLS_DIR/ca-chain.pem"
}

restore_chain() {
  archive_current
  install -m 0644 "$CA_DIR/ca.crt" "$TLS_DIR/ca-chain.pem"
  echo "gen-certs: vault-tls/ca-chain.pem was not the lab CA: restored it from .secrets/tls/ca.crt"
}

archive_current() {
  local dest
  # Exclude .gitkeep: the directory is effectively empty if only that remains.
  local real_files
  real_files=$(find "$TLS_DIR" -maxdepth 1 -type f ! -name '.gitkeep' 2>/dev/null || true)
  [ -n "$real_files" ] || return 0
  dest="$ROOT/.secrets/legacy/$(date +%Y-%m-%d)/vault-tls-$(date +%H%M%S)"
  mkdir -p "$dest"
  find "$TLS_DIR" -maxdepth 1 -type f ! -name '.gitkeep' -exec cp -p {} "$dest"/ \;
  echo "gen-certs: previous vault-tls/ files copied to ${dest#"$ROOT"/}"
}

issue_leaf() {
  local tmp
  tmp=$(mktemp -d "$CA_DIR/issue.XXXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  openssl ecparam -genkey -name prime256v1 -noout -out "$tmp/vault.key"
  openssl req -new -sha256 -key "$tmp/vault.key" -subj "/O=Vault Identity Lab/CN=vault" -out "$tmp/vault.csr"
  cat >"$tmp/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=$SANS
EOF
  openssl x509 -req -sha256 -days 825 -in "$tmp/vault.csr" \
    -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" \
    -set_serial "0x$(openssl rand -hex 16)" -extfile "$tmp/ext.cnf" -out "$tmp/vault.crt" 2>/dev/null
  openssl verify -CAfile "$CA_DIR/ca.crt" "$tmp/vault.crt" >/dev/null

  archive_current
  mkdir -p "$TLS_DIR"
  install -m 0644 "$tmp/vault.crt" "$TLS_DIR/vault.crt"
  install -m 0644 "$CA_DIR/ca.crt" "$TLS_DIR/ca-chain.pem"
  install -m 0600 "$tmp/vault.key" "$TLS_DIR/vault.key"
  chmod 755 "$TLS_DIR"
  echo "gen-certs: wrote vault-tls/{vault.crt,vault.key,ca-chain.pem}"
}

# The lab issuer's key (D12): created once, never replaced; a half pair stops.
issuer_key() {
  local dir="$ROOT/.secrets/issuer"
  mkdir -p "$dir" && chmod 700 "$dir"
  if [ -s "$dir/signing.pem" ] && [ -s "$dir/signing.pub.pem" ]; then return 0; fi
  if [ -e "$dir/signing.pem" ] || [ -e "$dir/signing.pub.pem" ]; then
    echo "gen-certs: .secrets/issuer has half a key pair; refusing to replace it." >&2
    exit 1
  fi
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$dir/signing.pem"
  openssl pkey -in "$dir/signing.pem" -pubout -out "$dir/signing.pub.pem"
  chmod 600 "$dir/signing.pem"
  chmod 644 "$dir/signing.pub.pem"
  echo "gen-certs: created the issuer key pair in .secrets/issuer/"
}

sighup_nodes() {
  local n
  for n in vid-vault_s vid-vault_1 vid-vault_2 vid-vault_3 vid-web; do
    if [ "$(podman container inspect "$n" --format '{{.State.Running}}' 2>/dev/null)" = true ]; then
      podman kill --signal HUP "$n" >/dev/null && echo "gen-certs: SIGHUP → $n"
    fi
  done
}

command -v openssl >/dev/null 2>&1 || {
  echo "openssl not found on PATH" >&2
  exit 127
}
mkdir -p "$CA_DIR"
chmod 700 "$ROOT/.secrets" "$CA_DIR"

case "${1:-}" in
--status)
  status
  [ -s "$ROOT/.secrets/issuer/signing.pub.pem" ] && echo "Issuer key: present (.secrets/issuer/)" || echo "Issuer key: missing (run make gen-certs)"
  ;;
--reissue)
  create_ca
  issuer_key
  issue_leaf
  sighup_nodes
  status
  ;;
"")
  create_ca
  issuer_key
  if leaf_is_current; then
    chain_is_current || restore_chain
    echo "gen-certs: vault-tls/vault.crt is current and chains to the lab CA: nothing to do"
  else
    issue_leaf
    sighup_nodes
  fi
  ;;
*)
  echo "Usage: $0 [--reissue | --status]" >&2
  exit 64
  ;;
esac
