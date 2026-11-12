#!/usr/bin/env bash
# scripts/rehearsal.sh (make rehearsal, make api-test): all ten cases through
# the console (https, the lab CA, signed in as noor on the form's API), each
# checked against config/cases.json: Vault's answer, the evidence states of
# the chain, and what the case is about (both principals, the ceiling or RAR
# code, a credential nobody used, a session after a revoke). Then every way it
# must fail: no session, a run with parameters, a foreign origin, a sign-in as
# an agent, the console token on values and credentials, JWTs Vault must
# refuse, and no secret or JWT in any answer or log. Starts and ends with
# make stage-reset. Never prints a token, JWT or password.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
t_start=$(date +%s)
BASE="https://localhost:$(vid_conf VID_PORT_WEB)"
NS=$(vid_conf VID_NAMESPACE)
WINDOW=$(vid_conf VID_CONSUMPTION_WINDOW)
WORK=$(mktemp -d)
JAR="$WORK/jar"
trap 'rm -rf "$WORK"' EXIT
pass=0
fail=0
row() { # <case> <label> <yes|no> <detail>
  if [ "$3" = yes ]; then pass=$((pass + 1)); printf '  \033[32mPASS\033[0m %-4s %-64s %s\n' "$1" "$2" "$(cut -c1-90 <<<"$4")"
  else fail=$((fail + 1)); printf '  \033[31mFAIL\033[0m %-4s %-64s %s\n' "$1" "$2" "$(cut -c1-220 <<<"$4")"; fi
}
expect_jq() { # <case> <label> <file> <jq test> <detail jq>
  if jq -e "$4" "$3" >/dev/null 2>&1; then row "$1" "$2" yes "$(jq -r "$5" "$3" 2>/dev/null)"; else row "$1" "$2" no "$(jq -c "$5" "$3" 2>/dev/null || head -c 200 "$3")"; fi
}
api() { # <METHOD> <path> [body] -> body in $WORK/out, status echoed
  curl -sS -o "$WORK/out" -w '%{http_code}' -b "$JAR" -c "$JAR" --cacert vault-tls/ca-chain.pem -X "$1" \
    ${3:+-H 'content-type: application/json' -d "$3"} "$BASE$2" || echo 000
}
run_case() { # <id> -> run id
  api POST "/api/cases/$1/run" >/dev/null
  jq -r '.run.id // empty' "$WORK/out"
}
# settle <run id> [seconds]: poll the investigation until settled.
settle() {
  local i
  for ((i = 0; i < ${2:-30}; i++)); do
    api GET "/api/runs/$1" >/dev/null
    jq -e '.settled' "$WORK/out" >/dev/null 2>&1 && break
    sleep 1
  done
  cp "$WORK/out" "$WORK/$1.json"
}
link() { printf '.chain[] | select(.link == "%s") | .state' "$1"; }

echo "rehearsal: a fresh stage"
CONFIRM=yes ./scripts/stage-reset.sh >/dev/null

# ── Sign in through the console ───────────────────────────────────────────────
st=$(jq -n --rawfile p .secrets/people/noor '{username: "noor", password: ($p | rtrimstr("\n"))}' |
  curl -sS -o "$WORK/out" -w '%{http_code}' -c "$JAR" --cacert vault-tls/ca-chain.pem -H 'content-type: application/json' --data @- "$BASE/api/session")
row R0 "noor signs in through the console form's API" "$([ "$st" = 200 ] && echo yes || echo no)" "HTTP $st"

# ── The ten cases ─────────────────────────────────────────────────────────────
declare -A RUN
RUN[9]=$(run_case 9) # first: its consumption window runs while the others play
for c in 1 2 3 4 5 6 7 8 10; do RUN[$c]=$(run_case "$c"); done
for c in 1 2 3 4 5 6 7 8 9 10; do
  [ -n "${RUN[$c]}" ] || { row "C$c" "case $c ran" no "no run id"; continue; }
  settle "${RUN[$c]}"
  f="$WORK/${RUN[$c]}.json"
  want=$(jq -r --argjson c "$c" '.cases[] | select(.id == $c) | .expect.vault' config/cases.json)
  expect_jq "C$c" "case $c: Vault answered $want" "$f" ".decision.outcome == \"$want\"" '.decision.outcome + " " + (.decision.code // "")'
  expect_jq "C$c" "case $c: requested Confirmed (R1)" "$f" "$(link requested) == \"Confirmed\"" "$(link requested)"
done
f="$WORK/${RUN[1]}.json"
expect_jq C1 "Noor's KV read: issued a version, use Partial (KV has no lease)" "$f" "($(link issued) == \"Confirmed\") and ($(link used) == \"Partial\") and ($(link ended) == \"n/a\")" '[.chain[].state] | join(",")'
for c in 2 4 6; do
  f="$WORK/${RUN[$c]}.json"
  expect_jq "C$c" "case $c: the session is Correlated by username and run (R2+R3)" "$f" ".chain[] | select(.link == \"used\") | .state == \"Correlated\" and .rule == \"R2+R3\"" "$(link used)"
done
for c in 3 5; do
  f="$WORK/${RUN[$c]}.json"
  expect_jq "C$c" "case $c: the application's use is Correlated (R3)" "$f" ".chain[] | select(.link == \"used\") | .state == \"Correlated\" and .rule == \"R3\"" "$(link used)"
done
f="$WORK/${RUN[2]}.json"
expect_jq C2 "Noor's request: flow human, subject noor, no actor" "$f" '.principals.subject.name == "noor" and .principals.subject.flow == "human" and .principals.actor == null' '.principals.subject.name'
f="$WORK/${RUN[4]}.json"
expect_jq C4 "the ledger agent as itself: flow agent_autonomous, JWT recorded" "$f" '.principals.subject.name == "ledger-agent" and .principals.subject.flow == "agent_autonomous" and .decision.jwt.issuer != null' '.principals.subject.flow'
f="$WORK/${RUN[6]}.json"
expect_jq C6 "OBO: subject noor and actor finance-agent recorded separately" "$f" '.principals.subject.name == "noor" and .principals.actor.name == "finance-agent" and .principals.subject.flow == "agent_obo"' '.principals.subject.name + " / " + .principals.actor.name'
expect_jq C6 "OBO: granting policies name the baseline and the ceiling" "$f" '(.decision.granting_policies | index("obs-noor")) and (.decision.granting_policies | index("obs-finance-ceiling"))' '.decision.granting_policies | join(",")'
expect_jq C6 "OBO: the purpose code arrives as declared" "$f" '.decision.purpose == "monthly-reconciliation"' '.decision.purpose'
f="$WORK/${RUN[7]}.json"
expect_jq C7 "the ceiling refuses payroll (CEILING_POLICY_DENIED), nothing issued" "$f" ".decision.code == \"CEILING_POLICY_DENIED\" and ($(link issued) == \"n/a\")" '.decision.code'
expect_jq C7 "the agent's own payroll policy does not help it act for Noor" "$f" '.decision.granting_policies == []' '.decision.granting_policies | length'
f="$WORK/${RUN[8]}.json"
expect_jq C8 "the RAR refuses database credentials (RAR_NO_MATCH)" "$f" '.decision.code == "RAR_NO_MATCH"' '.decision.code'
f="$WORK/${RUN[10]}.json"
expect_jq C10 "after the revoke: a refused query and a refused login, observed" "$f" '([.afterRevoke[].kind] | index("pg.error")) and ([.afterRevoke[].kind] | index("pg.login_failed"))' '[.afterRevoke[].kind] | join(",")'
api GET "/api/runs/${RUN[10]}" >/dev/null
for _ in $(seq 1 25); do
  jq -e "$(link ended) == \"Confirmed\"" "$WORK/out" >/dev/null 2>&1 && break
  sleep 1
  api GET "/api/runs/${RUN[10]}" >/dev/null
done
expect_jq C10 "the lease lookup confirms the revoke (R4)" "$WORK/out" "$(link ended) == \"Confirmed\"" '.chain[] | select(.link == "ended") | .detail'

# A lease issued to a JWT caller ends with the JWT (measured 2026-11-12).
api GET /api/secrets >/dev/null
expect_jq L1 "a JWT caller's lease is capped at the JWT's 5 minutes" "$WORK/out" \
  "[.credentials[] | select(.correlation_id == \"${RUN[6]}\" and .expire_time) | ((.expire_time | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdateiso8601) - (.at | sub(\"\\\\.[0-9]+Z$\"; \"Z\") | fromdateiso8601))] | .[0] <= 305" \
  "[.credentials[] | select(.correlation_id == \"${RUN[6]}\") | .expire_time] | .[0]"

# Case 9 last: its window must pass.
echo "rehearsal: waiting for case 9's ${WINDOW} s window"
for _ in $(seq 1 $((WINDOW + 30))); do
  api GET "/api/runs/${RUN[9]}" >/dev/null
  jq -e "$(link used) == \"Unmatched\"" "$WORK/out" >/dev/null 2>&1 && break
  sleep 2
done
expect_jq C9 "an unused credential is Unmatched after the window, worded precisely" "$WORK/out" \
  ".chain[] | select(.link == \"used\") | .state == \"Unmatched\" and (.detail | test(\"no matching connection observed in this\"))" '.chain[] | select(.link == "used") | .detail'
expect_jq C9 "the workload is named by its AppRole role" "$WORK/out" '.principals.subject.name == "payments-batch (AppRole)" and .principals.subject.flow == "workload"' '.principals.subject.name'

# ── Refusals ──────────────────────────────────────────────────────────────────
st=$(curl -sS -o /dev/null -w '%{http_code}' --cacert vault-tls/ca-chain.pem -X POST "$BASE/api/cases/1/run")
row N1 "a run without a session is refused (401)" "$([ "$st" = 401 ] && echo yes || echo no)" "HTTP $st"
st=$(api POST /api/cases/1/run '{"path":"kv/data/finance/payroll-export"}')
row N2 "a run that tries to set a path is refused (400)" "$([ "$st" = 400 ] && echo yes || echo no)" "HTTP $st $(jq -r .error "$WORK/out")"
st=$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" --cacert vault-tls/ca-chain.pem -X POST -H 'Origin: https://localhost:13701' "$BASE/api/cases/1/run")
row N3 "a write from another origin is refused (403)" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st"
st=$(curl -sS -o "$WORK/out" -w '%{http_code}' --cacert vault-tls/ca-chain.pem -H 'content-type: application/json' -d '{"username":"ledger-agent","password":"x"}' "$BASE/api/session")
row N4 "an agent cannot sign in to the console (403)" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st"
st=$(api POST /api/cases/99/run)
row N5 "an unknown case is a 404" "$([ "$st" = 404 ] && echo yes || echo no)" "HTTP $st"

vault_cluster
CON=$(cat .secrets/vault/tokens/console)
vreq() { # <token> <METHOD> <path in ns> [body] -> status; Vault's error in $WORK/err
  vcurl "$1" -sS -o "$WORK/vout" -w '%{http_code}' --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $NS" -X "$2" \
    ${4:+-H 'content-type: application/json' -d "$4"} "$VAULT_ADDR/v1/$3" || echo 000
}
verr() { jq -r '.errors[0] // empty' "$WORK/vout" 2>/dev/null | tr '\n\t' '  ' | tr -s ' '; }
st=$(vreq "$CON" GET kv/data/finance/reconciliation-api)
row N6 "the console token cannot read a KV value (403)" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st $(verr)"
st=$(vreq "$CON" GET database/creds/finance-readonly)
row N7 "the console token cannot get database credentials (403)" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st $(verr)"
st=$(vreq "$CON" POST sys/leases/revoke '{"lease_id":"kv/finance/not-a-database-lease"}')
row N8 "the console token revokes only finance-readonly leases (403)" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st $(verr)"
unset CON

# JWTs Vault must refuse, signed with the lab issuer's own key.
now=$(date +%s)
claims() { # <sub> <aud> <iat> <exp>
  jq -n --arg iss "$(vid_conf VID_ISSUER)" --arg aud "$2" --arg sub "$1" --argjson iat "$3" --argjson exp "$4" --arg jti "$(uuidgen)" \
    '{iss: $iss, aud: $aud, sub: $sub, jti: $jti, iat: $iat, exp: $exp,
      authorization_details: [{type: "vault:path_access", path: "kv/data/finance/reconciliation-api", capabilities: ["read"]}]}'
}
jwt_case() { # <case> <label> <claims json>
  printf '%s' "$3" >"$WORK/claims.json"
  local tok st
  tok=$(node scripts/probe-jwt.js .secrets/issuer/signing.pem "$WORK/claims.json" at+jwt corvid-1)
  st=$(vreq "$tok" GET kv/data/finance/reconciliation-api)
  row "$1" "$2" "$([ "$st" = 403 ] && echo yes || echo no)" "HTTP $st $(verr)"
}
AUD=$(vid_conf VID_AUDIENCE)
jwt_case J1 "a JWT for a subject with no alias is refused" "$(claims agent:unknown "$AUD" "$now" $((now + 300)))"
jwt_case J2 "a JWT for another audience is refused" "$(claims agent:ledger-agent https://elsewhere.example "$now" $((now + 300)))"
jwt_case J3 "an expired JWT is refused" "$(claims agent:ledger-agent "$AUD" $((now - 900)) $((now - 600)))"
printf '%s' "$(claims agent:ledger-agent "$AUD" "$now" $((now + 300)) | jq -c 'del(.authorization_details)')" >"$WORK/claims.json"
tok=$(node scripts/probe-jwt.js .secrets/issuer/signing.pem "$WORK/claims.json" at+jwt corvid-1)
st=$(vreq "$tok" GET kv/data/finance/reconciliation-api)
row J4 "a JWT without RAR is refused (RAR_MISSING)" "$([ "$st" = 403 ] && grep -q RAR_MISSING "$WORK/vout" && echo yes || echo no)" "HTTP $st $(verr)"
unset tok

# ── Nothing secret leaves the API ─────────────────────────────────────────────
leak=0
for r in "${RUN[@]}"; do
  [ -s "$WORK/$r.json" ] || continue
  grep -qE '"password"|eyJ[A-Za-z0-9_-]{10,}\.' "$WORK/$r.json" && leak=1
done
row S1 "no password field and no JWT in any investigation" "$([ "$leak" = 0 ] && echo yes || echo no)" "$leak"
leak=0
# No grep -q after a pipe under pipefail: capture, then search.
apilog=$(podman logs --since 30m vid-api 2>&1)
grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.|password' <<<"$apilog" && leak=1
row S2 "no JWT and no password in the API log" "$([ "$leak" = 0 ] && echo yes || echo no)" "$leak"
imgcases=$(podman exec vid-api cat /app/config/cases.json)
while IFS= read -r v; do
  if grep -qF -- "$v" <<<"$imgcases"; then leak=1; fi
done < <(jq -r '.secrets[].value // {} | .[]' config/cases.json)
row S3 "no KV value in the API image's cases.json" "$([ "$leak" = 0 ] && echo yes || echo no)" "$leak"

echo "rehearsal: back to a fresh stage"
CONFIRM=yes ./scripts/stage-reset.sh >/dev/null
echo
echo "rehearsal: $pass passed, $fail failed in $(($(date +%s) - t_start))s"
[ "$fail" -eq 0 ]
