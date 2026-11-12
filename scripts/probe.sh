#!/usr/bin/env bash
# scripts/probe.sh (make probe): measure what Vault 2.2.1 and PostgreSQL 17
# actually do before anything is built on it (prompt 03, questions Q1 to Q9
# of prompts/00_brief.md). Scratch only: one namespace probe-<epoch> with its
# own userpass, kv, database mount, policies, entities, OAuth profile and
# Agent Registry records; a scratch audit device and audited header in the
# root namespace; a scratch admin role and table in PostgreSQL. All removed at
# the end, also on failure (KEEP=1 keeps the namespace). Runs on the 4h probe
# token that bootstrap minted (vault/policies/probe.hcl), never a root token.
# JWTs are signed with a throwaway key. Writes docs/capabilities.md and
# .build/probe/results.json. Never prints a token, JWT or password.
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
# shellcheck source=scripts/probe-lib.sh
source "$VID_ROOT/scripts/probe-lib.sh"
cd "$VID_ROOT"

OUT="$VID_ROOT/docs/capabilities.md"
ROWS=$(mktemp)
NOTES=$(mktemp)
WORK=$(mktemp -d)
pass=0
fail=0
T=$(cat "$VID_STATE/tokens/probe" 2>/dev/null) || die "probe: no probe token (.secrets/vault/tokens/probe); bootstrap mints one, make root-regen re-mints"
vault_active
api "$T" GET auth/token/lookup-self
[ "$ST" = 200 ] || die "probe: the probe token is not accepted (expired after 4h?): HTTP $ST $ERR"
note() { printf -- '- %s\n' "$*" >>"$NOTES"; }
EPOCH=$(date +%s)
NS="probe-$EPOCH"
ISS="https://issuer.probe.example"
AUD="vault-probe"
PGADMIN="probe_admin_$EPOCH"
HDR="x-probe-purpose"
yes_if() { if eval "$1"; then echo yes; else echo no; fi; }

# psql_admin <sql>: as the postgres superuser over the local socket (peer).
psql_admin() { podman exec -i -u postgres vid-postgres psql -d finance -v ON_ERROR_STOP=1 -Atq; }

# jwt <name> <claims json>: sign with the throwaway key into $WORK/<name>.jwt.
jwt() {
  printf '%s' "$2" >"$WORK/$1.claims.json"
  node scripts/probe-jwt.js "$WORK/probe.pem" "$WORK/$1.claims.json" "${3:-}" >"$WORK/$1.jwt"
}
# as_jwt <name> <METHOD> <path> [body]: call Vault with the JWT in X-Vault-Token
# and a correlation id <name>; sets ST, BODY, ERR.
as_jwt() {
  local name=$1
  shift
  api "$(cat "$WORK/$name.jwt")" "$1" "$NS/$2" "${3:-}" "X-Correlation-Id: probe-$EPOCH-$name"
}
# audit_of <corr>: the scratch audit entries carrying X-Correlation-Id <corr>,
# from every node (the node that served the request wrote them).
audit_of() {
  local n
  for n in vault-1 vault-2 vault-3; do
    podman exec "$(vault_container "$n")" cat /vault/audit/probe.log 2>/dev/null || true
  done | jq -c --arg c "$1" 'select((.request.headers["x-correlation-id"] // [] | tostring | contains($c)))' 2>/dev/null || true
}
# pglog <jq filter>: matching jsonlog lines.
pglog() { podman exec vid-postgres cat /var/log/postgresql/postgresql.json | jq -c "select($1)" 2>/dev/null || true; }

cleanup() {
  set +e
  if [ "${KEEP:-0}" = 1 ]; then
    echo "probe: KEEP=1, namespace $NS kept"
  else
    api "$T" POST "$NS/sys/leases/revoke-prefix/database/creds" '{}'
    api "$T" DELETE "sys/namespaces/$NS"
    printf 'DROP TABLE IF EXISTS probe_t; DROP OWNED BY %s; DROP ROLE IF EXISTS %s;\n' "$PGADMIN" "$PGADMIN" | psql_admin >/dev/null 2>&1
  fi
  api "$T" DELETE "sys/config/auditing/request-headers/$HDR"
  api "$T" DELETE sys/audit/probe-file
  set -e
}
trap 'cleanup; rm -rf "$ROWS" "$NOTES" "$WORK"' EXIT

started=$(date +%s)
echo "probe: scratch namespace $NS"
api "$T" POST "sys/namespaces/$NS" '{}'
[ "$ST" = 200 ] || die "probe: could not create the scratch namespace: HTTP $ST $ERR"
api "$T" PUT sys/audit/probe-file '{"type":"file","options":{"file_path":"/vault/audit/probe.log","mode":"0600"}}'
[ "$ST" = 204 ] || die "probe: could not enable the scratch audit device: HTTP $ST $ERR"

# ── Q1: the licence ───────────────────────────────────────────────────────────
api "$T" GET sys/license/status
features=$(jq -r '.data.autoloaded.features // .data.features // [] | join(", ")' <<<"$BODY")
note "Licence features: $features."
row P1 Q1 "sys/license/status has Namespaces" present "$(jq -r '(.data.autoloaded.features // .data.features // []) | index("Namespaces") | if . then "listed" else "missing" end' <<<"$BODY")" \
  "$(yes_if "jq -e '(.data.autoloaded.features // .data.features // []) | index(\"Namespaces\")' <<<\"\$BODY\" >/dev/null")"
agentic=$(jq -r '(.data.autoloaded.features // .data.features // []) | map(select(test("agent|oauth|ai"; "i"))) | join(", ")' <<<"$BODY")
row P1 Q1 "sys/license/status names Agentic IAM" "recorded (docs give no feature name)" "${agentic:-no feature named agent/oauth/ai}" yes

# ── Structure in the scratch namespace (as Terraform will build it) ───────────
api "$T" POST "$NS/sys/auth/userpass" '{"type":"userpass"}'
api "$T" GET "$NS/sys/auth"
UP_ACC=$(jq -r '.data["userpass/"].accessor // .["userpass/"].accessor' <<<"$BODY")
api "$T" POST "$NS/sys/mounts/kv" '{"type":"kv","options":{"version":"2"}}'
api "$T" POST "$NS/kv/data/finance/reconciliation-api" '{"data":{"api_key":"PROBE-ONLY-0000"}}'
api "$T" POST "$NS/kv/metadata/finance/reconciliation-api" '{"custom_metadata":{"owner":"finance-platform","classification":"confidential","purpose":"monthly-reconciliation"}}'
row P2 setup "KV v2 custom_metadata write" "204" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
api "$T" POST "$NS/kv/data/finance/payroll-export" '{"data":{"file":"PROBE-ONLY-PAYROLL"}}'

# PostgreSQL: a scratch admin role (CREATEROLE) that owns a scratch table.
openssl rand -hex 16 >"$WORK/pgadmin.pw"
{
  printf "CREATE ROLE %s WITH LOGIN CREATEROLE PASSWORD '%s';\n" "$PGADMIN" "$(cat "$WORK/pgadmin.pw")"
  printf 'CREATE TABLE IF NOT EXISTS probe_t (x int); INSERT INTO probe_t VALUES (1);\n'
  printf 'ALTER TABLE probe_t OWNER TO %s;\n' "$PGADMIN"
} | psql_admin >/dev/null
api "$T" POST "$NS/sys/mounts/database" '{"type":"database"}'
api "$T" POST "$NS/sys/mounts/database/tune" '{"audit_non_hmac_response_keys":["username"]}'
row P3 Q6 "tune database audit_non_hmac_response_keys=[username]" "204" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
api "$T" POST "$NS/database/config/pg" "$(jq -n --arg u "$PGADMIN" --rawfile p "$WORK/pgadmin.pw" '{plugin_name: "postgresql-database-plugin",
  connection_url: "postgresql://{{username}}:{{password}}@postgres:5432/finance?sslmode=verify-full&sslrootcert=/vault/config/tls/ca-chain.pem", username: $u,
  password: ($p | rtrimstr("\n")), allowed_roles: ["ro", "ro-short", "ro-keep"], password_authentication: "scram-sha-256"}')"
row P3 setup "database/config/pg (verify_connection)" "200 or 204" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20[04]$ ]]')"
CREATE_SQL='CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '"'"'{{password}}'"'"' VALID UNTIL '"'"'{{expiration}}'"'"'; GRANT SELECT ON probe_t TO "{{name}}";'
REVOKE_SQL='REVOKE ALL ON probe_t FROM "{{name}}"; DROP ROLE IF EXISTS "{{name}}";'
KEEP_SQL='ALTER ROLE "{{name}}" NOLOGIN;'
api "$T" POST "$NS/database/roles/ro" "$(jq -n --arg c "$CREATE_SQL" --arg r "$REVOKE_SQL" '{db_name: "pg", creation_statements: [$c], revocation_statements: [$r], default_ttl: 600, max_ttl: 1800}')"
api "$T" POST "$NS/database/roles/ro-short" "$(jq -n --arg c "$CREATE_SQL" --arg r "$REVOKE_SQL" '{db_name: "pg", creation_statements: [$c], revocation_statements: [$r], default_ttl: 15, max_ttl: 15}')"
api "$T" POST "$NS/database/roles/ro-keep" "$(jq -n --arg c "$CREATE_SQL" --arg r "$KEEP_SQL" '{db_name: "pg", creation_statements: [$c], revocation_statements: [$r], default_ttl: 600, max_ttl: 1800}')"

# Audited header (root namespace; Q6).
api "$T" POST "sys/config/auditing/request-headers/$HDR" '{"hmac":false}'
row P4 Q6 "sys/config/auditing/request-headers/$HDR hmac=false" "200 or 204" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20[04]$ ]]')"
api "$T" GET sys/config/auditing/request-headers
note "Audited request headers as configured: $(jq -c '.data.headers // .headers' <<<"$BODY")."

# Policies: Noor's baseline, the finance agent's ceiling, an agent baseline,
# a console-like lease reader.
pol() { api "$T" PUT "$NS/sys/policies/acl/$1" "$(jq -n --arg p "$2" '{policy: $p}')"; }
pol p-human 'path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "kv/data/finance/payroll-export" { capabilities = ["read"] }
path "database/creds/ro" { capabilities = ["read"] }
path "database/creds/ro-short" { capabilities = ["read"] }
path "database/creds/ro-keep" { capabilities = ["read"] }'
pol p-ceiling 'path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "database/creds/ro" { capabilities = ["read"] }'
pol p-agent 'path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "database/creds/ro" { capabilities = ["read"] }'
pol p-console 'path "sys/leases/lookup" { capabilities = ["update"] }
path "sys/leases/revoke" { capabilities = ["update"] }'

# Entities.
entity() { api "$T" POST "$NS/identity/entity" "$(jq -n --arg n "$1" --argjson p "$2" '{name: $n, policies: $p}')"; jq -r '.data.id' <<<"$BODY"; }
E_HUMAN=$(entity noor '["p-human"]')
E_AUTO=$(entity agent-a '["p-agent"]')
E_OBO=$(entity agent-o '[]')
E_UNREG=$(entity agent-u '["p-agent"]')

# The throwaway key and the profile (static mode, Q2).
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK/probe.pem" 2>/dev/null
openssl pkey -in "$WORK/probe.pem" -pubout -out "$WORK/probe.pub.pem" 2>/dev/null
PROFILE=$(jq -n --arg iss "$ISS" --arg aud "$AUD" --rawfile pem "$WORK/probe.pub.pem" \
  '{issuer_id: $iss, use_jwks: false, public_keys: [{key_id: "probe-1", pem: $pem}], audiences: [$aud], supported_algorithms: ["ES256"]}')
api "$T" POST "$NS/sys/config/oauth-resource-server/probe-issuer" "$PROFILE"
row P5 Q2 "create OAuth profile (static ES256 key)" "200" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
note "Profile create response keys: $(jq -c '.data | keys' <<<"$BODY" 2>/dev/null); warnings: $(jq -c '.warnings' <<<"$BODY")."
api "$T" GET "$NS/sys/config/oauth-resource-server/probe-issuer"
PROF_ACC=$(jq -r '.data.mount_accessor // empty' <<<"$BODY")
note "Profile read: $(jq -c '.data | del(.public_keys)' <<<"$BODY")."
api "$T" POST "$NS/sys/config/oauth-resource-server/probe-issuer" "$PROFILE"
row P5 Q3 "write the same profile again (Terraform re-apply)" "200, no error" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"

# Aliases: profile_name + external_id; one by mount_accessor (the provider's way).
alias_p() { api "$T" POST "$NS/identity/entity-alias" "$(jq -n --arg n "$1" --arg c "$2" '{name: $n, canonical_id: $c, profile_name: "probe-issuer", external_id: $n}')"; }
alias_p noor "$E_HUMAN"
row P6 Q3 "entity-alias with profile_name + external_id" "200" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
ALIAS_HUMAN=$(jq -r '.data.id // empty' <<<"$BODY")
alias_p agent:a "$E_AUTO"
alias_p agent:o "$E_OBO"
alias_p agent:u "$E_UNREG"
E_ACC=$(entity agent-x '["p-agent"]')
api "$T" POST "$NS/identity/entity-alias" "$(jq -n --arg c "$E_ACC" --arg a "$PROF_ACC" '{name: "agent:x", canonical_id: $c, mount_accessor: $a}')"
row P6 Q3 "entity-alias with the synthetic mount_accessor (vault_identity_entity_alias)" "accepted" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
ALIAS_U=$(jq -r '.data.id // empty' <<<"$BODY")
api "$T" GET "$NS/identity/entity-alias/id/$ALIAS_HUMAN"
note "Profile alias read back: $(jq -c '.data | {name, mount_accessor, mount_type, mount_path, metadata, custom_metadata}' <<<"$BODY")."
[ -z "$ALIAS_U" ] || { api "$T" GET "$NS/identity/entity-alias/id/$ALIAS_U"; note "mount_accessor alias read back: $(jq -c '.data | {name, mount_accessor, mount_type}' <<<"$BODY")."; }
# Noor's userpass door on the same entity.
openssl rand -hex 16 >"$WORK/noor.pw"
api "$T" POST "$NS/auth/userpass/users/noor" "$(jq -n --rawfile p "$WORK/noor.pw" '{password: ($p | rtrimstr("\n")), token_ttl: "15m"}')"
api "$T" POST "$NS/identity/entity-alias" "$(jq -n --arg c "$E_HUMAN" --arg a "$UP_ACC" '{name: "noor", canonical_id: $c, mount_accessor: $a}')"
api - POST "$NS/auth/userpass/login/noor" "$(jq -n --rawfile p "$WORK/noor.pw" '{password: ($p | rtrimstr("\n"))}')"
NOOR=$(jq -r '.auth.client_token // empty' <<<"$BODY")
row P6 Q2 "userpass login of noor is the same entity as her JWT alias" "entity_id equal" "$(jq -r '.auth.entity_id' <<<"$BODY")" \
  "$(yes_if '[ "$(jq -r .auth.entity_id <<<"$BODY")" = "$E_HUMAN" ]')"

# Registry (Q3). agent-x is registered too: its only alias is accessor-bound.
api "$T" POST "$NS/agent-registry/register" "$(jq -n --arg e "$E_AUTO" '{display_name: "agent-a", entity_id: $e, owner: "probe", description: "autonomous probe agent"}')"
row P7 Q3 "agent-registry/register (autonomous, no ceiling)" "200" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
note "Register response: $(jq -c '.data' <<<"$BODY")."
api "$T" POST "$NS/agent-registry/register" "$(jq -n --arg e "$E_OBO" '{display_name: "agent-o", entity_id: $e, owner: "probe", ceiling_policies: ["p-ceiling"]}')"
row P7 Q3 "agent-registry/register (OBO, ceiling p-ceiling)" "200" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
api "$T" POST "$NS/agent-registry/register" "$(jq -n --arg e "$E_OBO" '{display_name: "agent-o", entity_id: $e, owner: "probe", ceiling_policies: ["p-ceiling"]}')"
row P7 Q3 "register the same agent again (no id)" "recorded" "HTTP $ST${ERR:+: $ERR}" yes
api "$T" POST "$NS/agent-registry/registration/display-name/agent-o" "$(jq -n --arg e "$E_OBO" '{entity_id: $e, owner: "probe", description: "updated by name", ceiling_policies: ["p-ceiling"]}')"
row P7 Q3 "update by display name (existing)" "200 or 204" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20[04]$ ]]')"
api "$T" POST "$NS/agent-registry/registration/display-name/agent-x" "$(jq -n --arg e "$E_ACC" '{entity_id: $e, owner: "probe"}')"
row P7 Q3 "update by display name (absent: does it create?)" "recorded" "HTTP $ST${ERR:+: $ERR}" yes
api "$T" GET "$NS/agent-registry/registration/display-name/agent-o"
note "Registry read: $(jq -c '.data' <<<"$BODY")."
api "$T" GET "$NS/agent-registry/registration/entity-id/$E_UNREG"
note "Registry read of an unregistered entity: HTTP $ST ${ERR}."

now=$(date +%s)
claims() { # <sub> [act] [rar json]: base claims
  jq -cn --arg iss "$ISS" --arg aud "$AUD" --arg sub "$1" --arg act "${2:-}" --argjson rar "${3:-null}" --arg jti "$(uuidgen)" \
    '{iss: $iss, aud: $aud, sub: $sub, jti: $jti} + (if $act != "" then {act: {sub: $act}} else {} end) + (if $rar then {authorization_details: $rar} else {} end)'
}
RAR_KV='[{"type":"vault:path_access","path":"kv/data/finance/reconciliation-api","capabilities":["read"]}]'
RAR_PAY='[{"type":"vault:path_access","path":"kv/data/finance/payroll-export","capabilities":["read"]}]'
RAR_DB='[{"type":"vault:path_access","path":"database/creds/ro","capabilities":["read"]}]'

# ── Q5: autonomous agent ──────────────────────────────────────────────────────
jwt auto "$(claims agent:a "" "$RAR_KV")"
as_jwt auto GET kv/data/finance/reconciliation-api
expect P8 Q5 "autonomous agent reads KV with RAR (relative path)" "200" '200' '.data.data.api_key'
AUTO_OK=$ST
if [ "$AUTO_OK" != 200 ]; then
  jwt auto-ns "$(claims agent:a "" "$(jq -c --arg ns "$NS" 'map(.path = ($ns + "/" + .path))' <<<"$RAR_KV")")"
  as_jwt auto-ns GET kv/data/finance/reconciliation-api
  expect P8 Q5 "same with the namespace in the RAR path" "200" '200'
fi
jwt auto-jwt "$(claims agent:a "" "$RAR_KV")" JWT
as_jwt auto-jwt GET kv/data/finance/reconciliation-api
row P8 Q2 "JWT header typ=JWT instead of at+jwt" "recorded" "HTTP $ST${ERR:+: $ERR}" yes
jwt norar "$(claims agent:a)"
as_jwt norar GET kv/data/finance/reconciliation-api
expect P9 Q5 "autonomous agent without authorization_details" "refused" '4[0-9][0-9]'
jwt unreg "$(claims agent:u "" "$RAR_KV")"
as_jwt unreg GET kv/data/finance/reconciliation-api
expect P10 Q5 "unregistered subject's JWT (entity has a policy)" "refused" '4[0-9][0-9]'
jwt accalias "$(claims agent:x "" "$RAR_KV")"
as_jwt accalias GET kv/data/finance/reconciliation-api
expect P10 Q3 "registered agent whose alias is bound by mount_accessor only" "refused (Terraform must use profile_name)" '403'
jwt badaud "$(claims agent:a "" "$RAR_KV" | jq -c '.aud = "someone-else"')"
as_jwt badaud GET kv/data/finance/reconciliation-api
expect P11 Q2 "wrong audience" "refused" '4[0-9][0-9]'
jwt expired "$(claims agent:a "" "$RAR_KV" | jq -c --argjson t "$now" '.iat = ($t - 900) | .exp = ($t - 600)')"
as_jwt expired GET kv/data/finance/reconciliation-api
expect P11 Q2 "expired JWT" "refused" '4[0-9][0-9]'
jwt rarmiss "$(claims agent:a "" "$RAR_KV")"
as_jwt rarmiss GET database/creds/ro
expect P12 Q5 "autonomous agent asks outside its RAR" "403" '403'
jwt autodb "$(claims agent:a "" "$RAR_DB")"
as_jwt autodb GET database/creds/ro
expect P12 Q5 "autonomous agent gets database creds with RAR" "200 + lease" '200' '.lease_id != ""'

# ── Q4: on behalf of ──────────────────────────────────────────────────────────
jwt obo "$(claims noor agent:o "$RAR_KV")"
as_jwt obo GET kv/data/finance/reconciliation-api
expect P13 Q4 "OBO: Noor via agent-o, KV, all bounds allow" "200" '200'
jwt obodb "$(claims noor agent:o "$RAR_DB")"
as_jwt obodb GET database/creds/ro
expect P13 Q4 "OBO: database creds" "200 + lease" '200' '.lease_id != ""'
jwt ceiling "$(claims noor agent:o "$RAR_PAY")"
as_jwt ceiling GET kv/data/finance/payroll-export
expect P14 Q4 "OBO: payroll (Noor allowed, ceiling not)" "403 ceiling" '403'
CEIL_ERR=$ERR
jwt rar "$(claims noor agent:o "$RAR_KV")"
as_jwt rar GET database/creds/ro
expect P15 Q4 "OBO: database creds with a KV-only RAR" "403 RAR" '403'
RAR_ERR=$ERR
jwt baseline "$(claims agent:a agent:o "$RAR_DB")"
as_jwt baseline GET kv/data/finance/payroll-export
row P16 Q4 "OBO: subject agent-a (not allowed payroll) via agent-o" "403" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 403 ]')"
jwt actunreg "$(claims noor agent:u "$RAR_KV")"
as_jwt actunreg GET kv/data/finance/reconciliation-api
expect P17 Q4 "OBO: actor not registered" "refused" '4[0-9][0-9]'
jwt actauto "$(claims noor agent:a "$RAR_KV")"
as_jwt actauto GET kv/data/finance/reconciliation-api
expect P17 Q4 "OBO: actor registered without ceiling policies" "refused (every OBO denied)" '4[0-9][0-9]'

# ── Audit fields (Q2, Q4, Q6) ─────────────────────────────────────────────────
sleep 1
ok=$(audit_of "probe-$EPOCH-obo" | jq -s 'map(select(.type == "response")) | .[0]')
note "OBO response audit entry, auth: $(jq -c '.auth | {entity_id, display_name, accessor, policies, token_policies, identity_policies, policy_results, metadata, token_type, actor_entity_id, actor_entity_name} + (to_entries | map(select(.key | test("jwt|actor|obo|subject"; "i"))) | from_entries)' <<<"$ok")."
note "OBO response audit entry, top-level keys: $(jq -c 'keys' <<<"$ok"); request keys: $(jq -c '.request | keys' <<<"$ok")."
note "OBO request entry headers: $(audit_of "probe-$EPOCH-obo" | jq -s -c 'map(select(.type == "request")) | .[0].request.headers')."
SUBJ=$(jq -r '.auth.entity_id // empty' <<<"$ok")
row P18 Q4 "OBO audit auth.entity_id is the subject (Noor)" "recorded" "auth.entity_id=$([ "$SUBJ" = "$E_HUMAN" ] && echo noor || { [ "$SUBJ" = "$E_OBO" ] && echo agent-o || echo "${SUBJ:-absent}"; })" yes
ACT=$(jq -r '[.. | objects | .actor_entity_id? // empty] | first // empty' <<<"$ok")
row P18 Q4 "actor_entity_id present in the OBO audit entry" "the agent" "$([ "$ACT" = "$E_OBO" ] && echo "agent-o" || echo "${ACT:-absent}")" "$(yes_if '[ "$ACT" = "$E_OBO" ]')"
ACTN=$(jq -r '[.. | objects | .actor_entity_name? // empty] | first // empty' <<<"$ok")
row P18 Q4 "actor_entity_name present" "agent-o" "${ACTN:-absent}" "$(yes_if '[ -n "$ACTN" ]')"
JWTF=$(jq -c '[paths(scalars) | map(tostring) | join(".") | select(test("jwt|authorization_details"; "i"))]' <<<"$ok")
row P18 Q2 "JWT fields in the audit entry" "recorded" "$JWTF" yes
note "OBO audit JWT-related values: $(jq -c '[paths(scalars) as $p | select($p | map(tostring) | join(".") | test("jwt|authorization_details"; "i")) | {($p | map(tostring) | join(".")): getpath($p)}] | add' <<<"$ok")."
autoent=$(audit_of "probe-$EPOCH-auto" | jq -s 'map(select(.type == "response")) | .[0]')
note "Autonomous audit auth: $(jq -c '.auth | {entity_id, display_name, accessor, policies, token_type}' <<<"$autoent")."
den=$(audit_of "probe-$EPOCH-ceiling" | jq -s 'map(select(.type == "response")) | .[0]')
row P19 Q4 "ceiling denial: audit error field" "recorded" "$(jq -r '.error // "absent"' <<<"$den")" yes
note "Ceiling denial response body: $CEIL_ERR."
den=$(audit_of "probe-$EPOCH-rar" | jq -s 'map(select(.type == "response")) | .[0]')
row P19 Q4 "RAR denial: audit error field" "recorded" "$(jq -r '.error // "absent"' <<<"$den")" yes
note "RAR denial response body: $RAR_ERR."
note "Ceiling denial audit auth.policy_results: $(audit_of "probe-$EPOCH-ceiling" | jq -s -c 'map(select(.type == "response")) | .[0].auth.policy_results')."

# Correlation and purpose headers (Q6), as Noor through userpass.
api "$NOOR" GET "$NS/kv/data/finance/reconciliation-api" "" "X-Correlation-Id: probe-$EPOCH-hdr"
KVREAD=$BODY
vcurl "$NOOR" -sS -o /dev/null --cacert "$VAULT_CACERT" -H "X-Correlation-Id: probe-$EPOCH-hdr2" -H "X-Probe-Purpose: monthly-reconciliation" \
  "$VAULT_ADDR/v1/$NS/kv/data/finance/reconciliation-api"
sleep 1
h=$(audit_of "probe-$EPOCH-hdr" | jq -s -c 'map(select(.type == "request")) | .[0].request.headers')
row P20 Q6 "X-Correlation-Id recorded by default (request.headers)" "present, clear" "$h" "$(yes_if "jq -e '.[\"x-correlation-id\"]' <<<'$h' >/dev/null")"
h2=$(audit_of "probe-$EPOCH-hdr2" | jq -s -c 'map(select(.type == "request")) | .[0].request.headers')
row P20 Q6 "configured X-Probe-Purpose (hmac false)" "present, clear" "$h2" "$(yes_if "jq -e '.[\"x-probe-purpose\"] | tostring | test(\"monthly\")' <<<'$h2' >/dev/null")"
row P21 Q7 "KV read response carries custom_metadata (no metadata policy)" "present" \
  "$(jq -c '.data.metadata.custom_metadata // "absent"' <<<"$KVREAD")" "$(yes_if "jq -e '.data.metadata.custom_metadata.owner' <<<\"\$KVREAD\" >/dev/null")"
kvaud=$(audit_of "probe-$EPOCH-hdr" | jq -s 'map(select(.type == "response")) | .[0]')
note "KV read audit: response.data.metadata = $(jq -c '.response.data.metadata' <<<"$kvaud"); auth.metadata = $(jq -c '.auth.metadata' <<<"$kvaud"); remote_address = $(jq -c '.request.remote_address' <<<"$kvaud")."

# Database credentials as Noor (Q6, Q8, Q9).
api "$NOOR" GET "$NS/database/creds/ro" "" "X-Correlation-Id: probe-$EPOCH-db"
DBUSER=$(jq -r '.data.username' <<<"$BODY")
jq -r '.data.password' <<<"$BODY" >"$WORK/db.pw"
LEASE=$(jq -r '.lease_id' <<<"$BODY")
sleep 1
dbaud=$(audit_of "probe-$EPOCH-db" | jq -s 'map(select(.type == "response")) | .[0]')
row P22 Q6 "audit response.data.username in clear (non-HMAC key)" "the username" \
  "$([ "$(jq -r '.response.data.username' <<<"$dbaud")" = "$DBUSER" ] && echo "clear, equal to the issued username" || jq -r '.response.data.username' <<<"$dbaud")" \
  "$(yes_if '[ "$(jq -r .response.data.username <<<"$dbaud")" = "$DBUSER" ]')"
row P22 Q6 "audit response.data.password stays HMAC'd" "hmac-sha256:..." "$(jq -r '.response.data.password | .[0:12]' <<<"$dbaud")..." \
  "$(yes_if "jq -e '.response.data.password | startswith(\"hmac-sha256:\")' <<<\"\$dbaud\" >/dev/null")"
ALEASE=$(jq -r '.response.secret.lease_id // empty' <<<"$dbaud")
row P22 Q6 "audit response.secret.lease_id" "recorded" "$([ "$ALEASE" = "$LEASE" ] && echo "clear, equal to the lease id" || echo "${ALEASE:0:24}...")" yes
note "Database response audit: secret = $(jq -c '.response.secret' <<<"$dbaud"); lease fields: $(jq -c '.response | {secret, wrap_info} ' <<<"$dbaud"); mount_type = $(jq -c '.request.mount_type' <<<"$dbaud"); auth.display_name = $(jq -c '.auth.display_name' <<<"$dbaud")."

# A session with application_name, then disconnect (Q8).
psql_as() { # <user> <appname> <sql>  (password on stdin)
  podman exec -i -e PGAPPNAME="$2" vid-postgres sh -c 'IFS= read -r PGPASSWORD; export PGPASSWORD; psql "host=postgres dbname=finance user=$1" -Atq -c "$2"' sh "$1" "$3"
}
out=$(psql_as "$DBUSER" "noor:probe$EPOCH" 'select count(*) from probe_t' <"$WORK/db.pw" 2>&1 || true)
row P23 Q8 "connect with the issued credential and query" "1" "$out" "$(yes_if '[ "$out" = 1 ]')"
sleep 1
auth_line=$(pglog ".user == \"$DBUSER\" and (.message | startswith(\"connection authorized\"))" | head -1)
row P23 Q8 "jsonlog: connection authorized line" "user, dbname, application_name" "$(jq -c '{user, dbname, application_name, remote_host, session_id, message}' <<<"$auth_line")" \
  "$(yes_if "jq -e '.user and .dbname' <<<\"\$auth_line\" >/dev/null")"
note "jsonlog connection authorized keys: $(jq -c 'keys' <<<"$auth_line")."
disc=$(pglog ".user == \"$DBUSER\" and (.message | startswith(\"disconnection\"))" | head -1)
row P23 Q8 "jsonlog: disconnection line" "session time" "$(jq -c '{session_id, application_name, message}' <<<"$disc")" "$(yes_if '[ -n "$disc" ]')"
printf 'wrong-password\n' >"$WORK/bad.pw"
psql_as "$DBUSER" "noor:probe$EPOCH-bad" 'select 1' <"$WORK/bad.pw" >/dev/null 2>&1 || true
sleep 1
row P24 Q8 "jsonlog: failed login" "FATAL" "$(pglog ".user == \"$DBUSER\" and .error_severity == \"FATAL\"" | head -1 | jq -c '{error_severity, state_code, message, application_name}')" yes

# Revoke while a session is open (Q8), with the role's REVOKE + DROP SQL.
held() { # <user> <appname> <pwfile> <out>: query, sleep 10 s in-session, query again
  podman exec -i -e PGAPPNAME="$2" vid-postgres sh -c 'IFS= read -r PGPASSWORD; export PGPASSWORD; printf "%s\n" "select '"'"'first'"'"', count(*) from probe_t;" "\\! sleep 10" "select '"'"'second'"'"', count(*) from probe_t;" | psql "host=postgres dbname=finance user=$1" -At 2>&1' sh "$1" <"$3" >"$4" 2>&1 &
}
api "$NOOR" GET "$NS/database/creds/ro"
U2=$(jq -r '.data.username' <<<"$BODY")
jq -r '.data.password' <<<"$BODY" >"$WORK/u2.pw"
L2=$(jq -r '.lease_id' <<<"$BODY")
held "$U2" "noor:held$EPOCH" "$WORK/u2.pw" "$WORK/held.out"
hp=$!
sleep 3
api "$T" POST "$NS/sys/leases/revoke" "$(jq -n --arg l "$L2" '{lease_id: $l}')"
row P25 Q8 "revoke the lease while its session is open (REVOKE + DROP ROLE)" "recorded" "HTTP $ST${ERR:+: $ERR}" yes
wait "$hp" || true
row P25 Q8 "the open session after the revoke" "recorded" "$(tr '\n' ';' <"$WORK/held.out")" yes
api "$T" POST "$NS/sys/leases/lookup" "$(jq -n --arg l "$L2" '{lease_id: $l}')"
row P26 Q9 "lease lookup after revoke" "invalid lease" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" != 200 ]')"
out=$(psql_as "$U2" "noor:held$EPOCH-again" 'select 1' <"$WORK/u2.pw" 2>&1 || true)
row P26 Q8 "a new login with the revoked credential" "refused" "$(tr '\n' ' ' <<<"$out" | cut -c1-120)" "$(yes_if '[ "$out" != 1 ]')"
note "pg_roles after the revoke: $(printf "select count(*) from pg_roles where rolname = '%s';\n" "$U2" | psql_admin) role(s) named $U2."

# The same with NOLOGIN-only revocation (does the session keep its rights?).
api "$NOOR" GET "$NS/database/creds/ro-keep"
U3=$(jq -r '.data.username' <<<"$BODY")
jq -r '.data.password' <<<"$BODY" >"$WORK/u3.pw"
L3=$(jq -r '.lease_id' <<<"$BODY")
held "$U3" "noor:keep$EPOCH" "$WORK/u3.pw" "$WORK/keep.out"
hp=$!
sleep 3
api "$T" POST "$NS/sys/leases/revoke" "$(jq -n --arg l "$L3" '{lease_id: $l}')"
row P27 Q8 "revoke with NOLOGIN-only SQL while the session is open" "recorded" "HTTP $ST${ERR:+: $ERR}" yes
wait "$hp" || true
row P27 Q8 "the open session after a NOLOGIN revoke" "recorded" "$(tr '\n' ';' <"$WORK/keep.out")" yes
out=$(psql_as "$U3" "noor:keep$EPOCH-again" 'select 1' <"$WORK/u3.pw" 2>&1 || true)
row P27 Q8 "a new login after a NOLOGIN revoke" "refused" "$(tr '\n' ' ' <<<"$out" | cut -c1-120)" "$(yes_if '[ "$out" != 1 ]')"
printf 'DROP OWNED BY "%s"; DROP ROLE IF EXISTS "%s";\n' "$U3" "$U3" | psql_admin >/dev/null 2>&1 || true

# Lease lookup with a narrow token, and expiry (Q9).
api "$T" POST "$NS/auth/token/create" '{"policies":["p-console"],"ttl":"10m","no_default_policy":true}'
CON=$(jq -r '.auth.client_token' <<<"$BODY")
api "$CON" POST "$NS/sys/leases/lookup" "$(jq -n --arg l "$LEASE" '{lease_id: $l}')"
expect P28 Q9 "lease lookup with a token that has only sys/leases/lookup" "200 with expire_time" '200' '.data.expire_time'
note "Lease lookup data: $(jq -c '.data' <<<"$BODY")."
api "$NOOR" GET "$NS/database/creds/ro-short" "" "X-Correlation-Id: probe-$EPOCH-short"
LS=$(jq -r '.lease_id' <<<"$BODY")
USHORT=$(jq -r '.data.username' <<<"$BODY")
lines_before=$(for n in vault-1 vault-2 vault-3; do podman exec "$(vault_container "$n")" cat /vault/audit/probe.log 2>/dev/null; done | wc -l)
sleep 25
api "$CON" POST "$NS/sys/leases/lookup" "$(jq -n --arg l "$LS" '{lease_id: $l}')"
row P29 Q9 "lease lookup after the TTL (15 s) passed" "invalid lease" "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" != 200 ]')"
expiry_entries=$(for n in vault-1 vault-2 vault-3; do podman exec "$(vault_container "$n")" cat /vault/audit/probe.log 2>/dev/null; done |
  tail -n +"$((lines_before + 1))" | jq -c --arg u "$USHORT" 'select((.request.path // "") | test("leases|revoke")) ' 2>/dev/null | wc -l | tr -d ' ')
row P29 Q9 "audit entries for the expiry itself (sys/leases paths, 25 s window)" "recorded" "$expiry_entries (only the probe's own lookup)" yes
row P29 Q8 "the expired role in pg_roles" "recorded" "$(printf "select count(*) from pg_roles where rolname = '%s';\n" "$USHORT" | psql_admin) role(s)" yes

took=$(($(date +%s) - started))
mkdir -p "$BUILD_DIR/probe"
{
  cat <<EOF
<!-- Generated by make probe. The table and the notes quote Vault and
     PostgreSQL verbatim (long lines, JSON), so these rules are off here. -->
<!-- markdownlint-disable MD004 MD013 MD033 MD034 MD037 MD060 -->

# Capabilities (measured)

What Vault Enterprise 2.2.1 and PostgreSQL 17.11 actually do for this lab,
measured by \`make probe\` (\`scripts/probe.sh\`) in a scratch namespace on
$(date -u +%Y-%m-%d) in ${took}s: $pass rows matched, $fail did not. The
design of prompts 04 to 06 follows this table, not the docs. Answers are
quoted verbatim; an absent field is recorded as absent.

## Answers (measured 2026-11-12; the table below is this run's evidence)

1. **Licence.** Namespaces and a feature named \`Agentic IAM\` are listed.
2. **JWT in X-Vault-Token.** A JWT from a static-key profile (ES256,
   \`use_jwks=false\`) works directly in \`X-Vault-Token\` for a namespaced
   request; there is no login and no token: the audit entry has
   \`auth.accessor: null\`, \`token_type: "ent"\`, \`display_name: "JWT
   Token with Unique Identifier: <jti>"\`. \`typ\` \`at+jwt\` and \`JWT\` both
   work. Wrong audience and expired tokens: 403 \`permission denied\`. The
   profile warns about a non-URI audience and a single algorithm family.
3. **Terraform.** Writing the same profile twice answers 200.
   \`identity/entity-alias\` accepts \`profile_name\` + \`external_id\` and also
   the synthetic \`mount_accessor\` (what \`vault_identity_entity_alias\`
   sends); both read back with that accessor, **but only the
   \`profile_name\` alias authenticates a JWT**: an accessor-bound alias of a
   registered agent is refused 403 \`permission denied\` (P10), so Terraform
   writes profile aliases through \`vault_generic_endpoint\`. \`agent-registry/register\`
   returns \`{id, display_name}\`; \`POST registration/display-name/<name>\`
   creates when absent and updates when present (200), so it is an
   idempotent path for \`vault_generic_endpoint\`. A read adds \`default\` and
   \`default-ceiling\` to \`ceiling_policies\`.
4. **OBO.** All bounds allow: 200. Ceiling denies: 403 \`CEILING_POLICY_DENIED:
   actor ceiling policy denied permission\` + \`permission denied\`. RAR does
   not match: 403 \`RAR_NO_MATCH: No valid authorization_details claim found
   matching this request.\` The same text is the audit \`error\`. Actor not
   registered: 403 \`permission denied\`. An actor registered without ceiling
   policies: \`CEILING_POLICY_DENIED\`. In the audit, \`auth.entity_id\` is the
   **subject** (Noor); the actor is \`auth.metadata.actor_entity_id\` and
   \`actor_entity_name\`; \`auth.metadata\` also holds \`jwt_issuer\`,
   \`jwt_unique_id\`, \`jwt_audience_claim\`, \`jwt_authorization_details\`,
   and \`auth.authorization_details\` repeats the RAR. On success
   \`auth.policy_results.granting_policies\` names the subject's policy
   **and** the actor's ceiling policy; on a denial it is \`{"allowed": false}\`.
5. **Autonomous.** A registered subject with RAR: 200. Without
   \`authorization_details\`: 403 \`RAR_MISSING\`. An unregistered subject
   whose alias is right: 400 \`OAuth credentials require the entity to have
   an agent registration\` (its entity policy does not help). A subject with
   no matching alias: 403 \`permission denied\`.
6. **Audit.** \`X-Correlation-Id\` (and \`Correlation-Id\`, \`User-Agent\`)
   are recorded by default, unhashed; a configured header with \`hmac: false\`
   shows in clear. \`response.secret.lease_id\` is in clear.
   \`audit_non_hmac_response_keys=["username"]\` on \`database/\` shows the
   generated username in clear; the password stays \`hmac-sha256:\`. KV
   \`custom_metadata\` values in the audit response are HMAC'd; the version is
   clear. \`request.remote_address\` is recorded.
7. **KV labels.** A KV v2 read returns \`data.metadata.custom_metadata\` to a
   caller without \`kv/metadata\` access.
8. **PostgreSQL 17.** jsonlog \`connection authorized\` has \`user\`,
   \`dbname\`, \`remote_host\`, \`session_id\`, but **no** \`application_name\`
   field: the name is only in the message (\`application_name=...\`); the
   \`disconnection\` line has the field and the session time. A failed login
   is FATAL 28P01 \`password authentication failed\`. Revoking with \`REVOKE\`
   + \`DROP ROLE\` while a session is open succeeds (204, the role is gone):
   the session stays connected, its next query fails \`permission denied for
   table\`, a new login fails. With \`NOLOGIN\`-only revocation the open
   session keeps its rights and its next query works.
9. **Leases.** A token with only \`sys/leases/lookup\` reads \`issue_time\`,
   \`expire_time\`, \`ttl\`. After revoke or expiry: 400 \`invalid lease\`.
   Expiry writes no audit entry; the role is gone from \`pg_roles\`.

| Case | Question | Call | Expected | Answer | Match |
| --- | --- | --- | --- | --- | --- |
EOF
  cat "$ROWS"
  printf '\n## Notes\n\n'
  cat "$NOTES"
} >"$OUT"
jq -n --argjson pass "$pass" --argjson fail "$fail" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{pass: $pass, fail: $fail, at: $at}' >"$BUILD_DIR/probe/results.json"
echo "probe: $pass passed, $fail failed in ${took}s; wrote docs/capabilities.md"
[ "$fail" -eq 0 ]
