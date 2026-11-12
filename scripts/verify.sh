#!/usr/bin/env bash
# scripts/verify.sh [section...]: end-to-end checks of the running lab.
# Sections: podman vault units platform stage data app console boundary drift
# idempotency secrets rehearsal (default: all). Read-only except rehearsal,
# which runs every case and ends with make stage-reset. The browser-level checks are Playwright's: make test-ui.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"

pass=0
fail=0
ok() {
  printf '  \033[32m✓\033[0m %s\n' "$*"
  pass=$((pass + 1))
}
bad() {
  printf '  \033[31m✗\033[0m %s\n' "$*"
  fail=$((fail + 1))
}
check() {
  local msg=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$msg"; else bad "$msg"; fi
}
healthy() {
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(podman container inspect "$1" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && return 0
    sleep 3
  done
  return 1
}
native() { # <image>: pulled and the host's architecture, not emulated
  [ "$(podman image inspect "$1" --format '{{.Architecture}}' 2>/dev/null)" = "$(podman info --format '{{.Host.Arch}}')" ]
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

section_podman() {
  echo "podman"
  check "Podman machine answers" podman info
  check "network vid-internal exists" podman network exists vid-internal
  check "Vault Enterprise image is native arm64" native "$(vid_conf VAULT_ENT_IMAGE)"
  local skew=99 vm
  if vm=$(podman machine ssh date +%s 2>/dev/null | tr -d '\r' | tail -1) && [ -n "$vm" ]; then
    skew=$(($(date +%s) - vm))
    skew=${skew#-}
  fi
  check "VM clock within 5s of the Mac (${skew}s; fix: make clock-sync)" test "$skew" -le 5
}

section_vault() {
  echo "vault"
  check "listener certificate chains to the lab CA" openssl verify -CAfile vault-tls/ca-chain.pem vault-tls/vault.crt
  local node s
  for node in vault-s $VID_CLUSTER_NODES; do
    check "$(vault_container "$node") healthy" healthy "$(vault_container "$node")"
    vault_node "$node"
    s=$(vault_json 2>/dev/null || echo '{}')
    check "$node initialized and unsealed" jq -e '.initialized and (.sealed | not)' <<<"$s"
    check "$node runs 2.2.1+ent" jq -e '.version == "2.2.1+ent"' <<<"$s"
  done
  vault_node vault-s
  check "vault-s is Shamir-sealed" jq -e '.type == "shamir"' <<<"$(vault_json 2>/dev/null || echo '{}')"
  for node in $VID_CLUSTER_NODES; do
    vault_node "$node"
    check "$node is Transit-sealed" jq -e '.type == "transit"' <<<"$(vault_json 2>/dev/null || echo '{}')"
  done
  check "every node's own seal token is accepted by vault-s" ./scripts/seal-token-status.sh

  vault_cluster
  vault_token ansible-platform
  local peers leaders
  peers=$(vault operator raft list-peers -format=json 2>/dev/null || echo '{}')
  check "three Raft voters" jq -e '[.data.config.servers[] | select(.voter)] | length == 3' <<<"$peers"
  leaders=$(jq '[.data.config.servers[] | select(.leader)] | length' <<<"$peers" 2>/dev/null || echo 0)
  check "exactly one leader" test "$leaders" = 1
  check "licence autoloaded on the cluster" bash -c 'vault read -format=json sys/license/status | jq -e ".data.autoloaded.license_id != null"'
  unset VAULT_TOKEN

  check "no root token in the seal init file" jq -e 'has("root_token") | not' .secrets/vault/seal-init.json
  check "no root token in the cluster init file" jq -e 'has("root_token") | not' .secrets/vault/vault-init.json
  check "no regenerated root token lying around (make root-revoke)" bash -c '! compgen -G ".secrets/vault/root-*" >/dev/null'
  local t
  for t in tf-seal ansible-seal tf-platform ansible-platform; do
    check "scoped token $t is 0600" test "$(stat -f '%Lp' ".secrets/vault/tokens/$t")" = 600
  done
  check "Terraform state is 0600" bash -c '! find .secrets/terraform -name "*.tfstate*" ! -perm 600 | grep . >/dev/null'
}

ns=$(vid_conf VID_NAMESPACE)

section_platform() {
  echo "platform"
  vault_cluster
  vault_token ansible-platform
  check "namespace $ns exists" bash -c "vault read -format=json sys/namespaces/$ns | jq -e '.data.path == \"$ns/\"'"
  check "mounts kv/ (v2) and database/ in $ns" bash -c "vault read -format=json -namespace=$ns sys/mounts | jq -e '(.data[\"kv/\"].options.version == \"2\") and (.data | has(\"database/\"))'"
  check "the generated username is not HMAC'd, nothing else (D10)" bash -c "vault read -format=json -namespace=$ns sys/mounts | jq -e '.data[\"database/\"].config.audit_non_hmac_response_keys == [\"username\"]'"
  check "userpass/ and approle/ enabled in $ns" bash -c "vault read -format=json -namespace=$ns sys/auth | jq -e '.data | has(\"userpass/\") and has(\"approle/\")'"
  check "two audit devices, file/ and stdout/ (root namespace)" bash -c 'vault read -format=json sys/audit | jq -e ".data | has(\"file/\") and has(\"stdout/\")"'
  check "X-Observatory-Purpose is audited in clear" bash -c 'vault read -format=json sys/config/auditing/request-headers | jq -e "(.data.headers // .data) | to_entries | map(select(.key | ascii_downcase == \"x-observatory-purpose\")) | .[0].value.hmac == false"'
  check "the licence has Namespaces and Agentic IAM (make license-features)" ./scripts/license-features.sh
  unset VAULT_TOKEN
  check "phase validate passes (Noor, the registry, the profile, the labels, the workload)" ./scripts/ansible.sh validate
}

section_stage() {
  echo "stage"
  vault_cluster
  vault_token ansible-platform
  local k
  for k in reconciliation-api payroll-export; do
    check "kv/finance/$k staged with its labels (metadata only; Ansible cannot read it)" bash -c "vault read -format=json -namespace=$ns kv/metadata/finance/$k | jq -e '.data.current_version >= 1 and (.data.custom_metadata.classification | length > 0)'"
  done
  unset VAULT_TOKEN
}

section_data() {
  echo "data"
  check "vid-postgres healthy" healthy vid-postgres
  check "PostgreSQL image is native arm64" native "$(vid_conf POSTGRES_IMAGE)"
  check "the finance ledger has its synthetic rows" bash -c "test \"\$(podman exec -u postgres vid-postgres psql -d finance -Atc 'select count(*) from ledger_entries')\" -ge 6"
  check "Vault rotated the bootstrap password away (it no longer logs in)" bash -c "! podman exec -i vid-postgres sh -c 'IFS= read -r PGPASSWORD; export PGPASSWORD; psql \"host=postgres dbname=finance user=postgres\" -Atc \"select 1\"' <.secrets/data/pg-bootstrap >/dev/null 2>&1"
  check "connections are logged as jsonlog, readable by the API" podman exec vid-api test -r /pglog/postgresql.json
  check "TLS 1.3 on, with the lab certificate" bash -c "test \"\$(podman exec -u postgres vid-postgres psql -d finance -Atc 'show ssl')\" = on"
  check "a network connection without TLS is refused (pg_hba)" bash -c "podman exec vid-postgres psql 'host=postgres sslmode=disable dbname=finance user=postgres' -c 'select 1' 2>&1 | grep -F 'no encryption' >/dev/null"
  check "no statement logging (CREATE ROLE would carry a password)" bash -c "test \"\$(podman exec -u postgres vid-postgres psql -d finance -Atc 'show log_statement')\" = none"
}

section_app() {
  echo "app"
  check "vid-api healthy" healthy vid-api
  check "API healthz answers from the store (through the console)" bash -c "curl -sf --cacert vault-tls/ca-chain.pem https://localhost:$(vid_conf VID_PORT_WEB)/api/healthz | jq -e '.ok' >/dev/null"
  check "the API is not published on its own (only through the console's TLS)" bash -c "test -z \"\$(podman port vid-api)\""
  check "API image is native arm64" native "$(vid_conf VID_IMAGE_PREFIX)/api:$(vid_conf VID_IMAGE_TAG)"
  local n
  for n in 1 2 3; do
    check "the API reads vault-$n's audit file" podman exec vid-api test -r "/audit/vault-$n/audit.log"
  done
  check "the API holds no person's password (Noor types hers)" bash -c "! podman exec vid-api test -e /run/secrets/people"
  check "the API's mounts are read-only except the evidence store" bash -c "test \"\$(podman inspect vid-api --format '{{range .Mounts}}{{.Destination}}={{.RW}} {{end}}' | tr ' ' '\n' | grep -cx '.*=true')\" = 1 && podman inspect vid-api --format '{{range .Mounts}}{{.Destination}}={{.RW}} {{end}}' | tr ' ' '\n' | grep -x '/data=true' >/dev/null"
}

section_console() {
  echo "console"
  local web
  web="localhost:$(vid_conf VID_PORT_WEB)"
  check "vid-web healthy" healthy vid-web
  check "web image is native arm64" native "$(vid_conf VID_IMAGE_PREFIX)/web:$(vid_conf VID_IMAGE_TAG)"
  check "TLS 1.3, chain verifies against the lab CA" bash -c "openssl s_client -connect $web -tls1_3 -servername localhost -CAfile vault-tls/ca-chain.pem -verify_return_error </dev/null 2>/dev/null | grep -F 'Verify return code: 0' >/dev/null"
  check "TLS 1.2 refused" bash -c "! openssl s_client -connect $web -tls1_2 </dev/null >/dev/null 2>&1"
  check "Content-Security-Policy without unsafe-inline scripts" bash -c "curl -sI --cacert vault-tls/ca-chain.pem https://$web/ | grep -i '^content-security-policy:' | grep -F \"script-src 'self'\" | grep -vF unsafe-inline >/dev/null"
  check "the console page is served (200)" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --cacert vault-tls/ca-chain.pem 'https://$web/')\" = 200"
  check "the console proxies the API" bash -c "curl -sf --cacert vault-tls/ca-chain.pem https://$web/api/healthz | jq -e .ok >/dev/null"
  check "only noor may sign in to the console (403 for an agent)" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --cacert vault-tls/ca-chain.pem -H 'content-type: application/json' -d '{\"username\":\"ledger-agent\",\"password\":\"x\"}' https://$web/api/session)\" = 403"
  check "no one-shot init container left behind" bash -c "! podman ps -a --filter name=^vid-volume_init --format '{{.Names}}' | grep . >/dev/null"
}

section_units() {
  echo "units"
  check "the cases validate (make cases-check)" node scripts/cases-check.js
  check "script unit tests (node --test scripts/)" bash -c "node --test scripts/*.test.js"
  check "API unit tests (node --test api/test/)" bash -c "cd api && NODE_ENV=test node --test 'test/*.test.js'"
  check "static checks (make lint)" ./scripts/lint.sh
}

section_idempotency() {
  echo "idempotency"
  check "every Ansible phase changed=0 (make idempotency)" ./scripts/idempotency.sh
}

section_secrets() {
  echo "secrets"
  check "no known secret in state, .build/ or logs (make secret-scan)" ./scripts/secret-scan.sh
}

section_rehearsal() {
  echo "rehearsal"
  check "all ten cases through the console, every way it must fail (make rehearsal)" ./scripts/rehearsal.sh
}

section_boundary() {
  echo "boundary"
  check "each scoped token does its own job and nothing else (make boundary)" ./scripts/boundary-check.sh
}

section_drift() {
  echo "drift"
  check "Terraform: every root plans clean (make tf-plan-all)" make -s tf-plan-all
  check "Ansible: every phase changes nothing in check mode (make drift)" ./scripts/drift.sh
}

all="podman vault units platform stage data app console boundary drift idempotency secrets rehearsal"
sections=${*:-$all}
for s in $sections; do
  if declare -F "section_$s" >/dev/null; then
    "section_$s"
  else
    echo "$s"
    echo "  - not built yet"
  fi
done

echo
echo "verify: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
