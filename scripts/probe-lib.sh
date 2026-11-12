#!/usr/bin/env bash
# scripts/probe-lib.sh: helpers for scripts/probe.sh. Source, do not execute.
# api <token|-> <METHOD> <path> [json body] [extra header]: sets ST (HTTP
# status), BODY (response) and ERR (Vault's errors[0], verbatim).
# Never prints a token.

api() {
  local tok=$1 method=$2 path=$3 body=${4:-} hdr=${5:-} out args=()
  out=$(mktemp)
  args=(-sS -o "$out" -w '%{http_code}' --cacert "$VAULT_CACERT" -X "$method")
  [ -z "$hdr" ] || args+=(-H "$hdr")
  [ -z "$body" ] || args+=(-H 'Content-Type: application/json' -d "$body")
  ST=$(vcurl "$tok" "${args[@]}" "${PROBE_ADDR:-$VAULT_ADDR}/v1/$path" || echo 000)
  BODY=$(cat "$out")
  rm -f "$out"
  ERR=$(jq -r '.errors[0] // .data.error // empty' <<<"$BODY" 2>/dev/null | tr '\n\t' '  ' | tr -s ' ' | sed 's/ *$//' || true)
}

b64() { printf '%s' "$1" | base64; }

# A ciphertext shortened to its version prefix and 8 characters.
short() { sed -E 's/^(vault:v[0-9]+:)(.{8}).*/\1\2.../' <<<"$1"; }

row() { # <case> <act> <call> <expected> <answer> <yes|no>
  printf '| %s | %s | `%s` | %s | %s | %s |\n' "$1" "$2" "$3" "$4" "$(tr '|\n\t' '/  ' <<<"$5" | cut -c1-220)" "$6" >>"$ROWS"
  if [ "$6" = yes ]; then
    pass=$((pass + 1))
    printf '  \033[32mPASS\033[0m %-4s %s (%s)\n' "$1" "$3" "$(cut -c1-110 <<<"$5")"
  else
    fail=$((fail + 1))
    printf '  \033[31mFAIL\033[0m %-4s %s (%s)\n' "$1" "$3" "$(cut -c1-160 <<<"$5")"
  fi
}

# expect <case> <act> <call> <expected> <want status regex> [jq test on BODY]
expect() {
  local c=$1 a=$2 call=$3 want=$4 st=$5 test=${6:-} ans
  ans="HTTP $ST${ERR:+: $ERR}"
  if [[ "$ST" =~ ^($st)$ ]] && { [ -z "$test" ] || jq -e "$test" <<<"$BODY" >/dev/null 2>&1; }; then
    row "$c" "$a" "$call" "$want" "$ans" yes
  else
    row "$c" "$a" "$call" "$want" "$ans" no
  fi
}

# login <user>: sets TOK[user] and ENT[user] for a scratch persona (password
# from PW_DIR). Not in a subshell: the caller needs both.
# shellcheck disable=SC2034  # TOK and ENT are the caller's (probe.sh) arrays
login() {
  api - POST "auth/probe-userpass/login/$1" "$(jq -n --arg p "$(cat "$PW_DIR/$1")" '{password: $p}')"
  TOK[$1]=$(jq -r '.auth.client_token' <<<"$BODY")
  ENT[$1]=$(jq -r '.auth.entity_id' <<<"$BODY")
}

# audit <node> <jq filter>: matching entries of the scratch audit log on one node.
audit() {
  podman exec "$(vault_container "$1")" cat /vault/audit/probe.log 2>/dev/null | jq -c "select($2)" 2>/dev/null || true
}
