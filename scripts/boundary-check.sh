#!/usr/bin/env bash
# scripts/boundary-check.sh (make boundary): prove the Terraform/Ansible
# boundary Vault enforces (golden_ticket's format). Each scoped token asks
# sys/capabilities-self what it may do on paths it must and must not touch.
# Never prints a token. Rows: token|vault|path|allow:cap or deny:cap.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

checks=(
  # vault-s (prompt 02)
  "tf-seal|seal|sys/mounts/transit|allow:create"
  "tf-seal|seal|auth/token/roles/autounseal|allow:update"
  "tf-seal|seal|sys/audit/file|allow:sudo"
  "tf-seal|seal|auth/token/create/autounseal|deny:update"
  "tf-seal|seal|sys/policies/acl/vid-tf-seal|deny:update"
  "ansible-seal|seal|auth/token/create/autounseal|allow:update"
  "ansible-seal|seal|auth/token/roles/autounseal|deny:update"
  "ansible-seal|seal|sys/policies/acl/autounseal|deny:update"
  "ansible-seal|seal|sys/mounts/transit|deny:create"
  "ansible-seal|seal|sys/policies/acl/vid-ansible-seal|deny:update"
  # the cluster: tool tokens (prompt 02). A root-namespace token reaches
  # namespace observatory through observatory/ paths.
  "tf-platform|vault|sys/namespaces/observatory|allow:create"
  "tf-platform|vault|sys/audit/file|allow:sudo"
  "tf-platform|vault|sys/config/auditing/request-headers/x-observatory-purpose|allow:sudo"
  "tf-platform|vault|observatory/sys/mounts/database|allow:create"
  "tf-platform|vault|observatory/sys/auth/approle|allow:sudo"
  "tf-platform|vault|observatory/database/roles/finance-readonly|allow:update"
  "tf-platform|vault|observatory/sys/policies/acl/obs-noor|allow:update"
  "tf-platform|vault|observatory/sys/config/oauth-resource-server/corvid-issuer|allow:update"
  "tf-platform|vault|observatory/agent-registry/register|allow:update"
  "tf-platform|vault|observatory/identity/entity-alias|allow:update"
  "tf-platform|vault|observatory/kv/data/finance/reconciliation-api|deny:read"
  "tf-platform|vault|observatory/database/creds/finance-readonly|deny:read"
  "tf-platform|vault|observatory/database/rotate-root/finance|deny:update"
  "tf-platform|vault|observatory/auth/userpass/users/noor|deny:update"
  "tf-platform|vault|observatory/auth/approle/role/payments-batch/secret-id|deny:update"
  "tf-platform|vault|observatory/auth/token/create/obs-console|deny:update"
  "tf-platform|vault|sys/policies/acl/vid-tf-platform|deny:update"
  "ansible-platform|vault|observatory/database/rotate-root/finance|allow:update"
  "ansible-platform|vault|observatory/auth/userpass/users/noor|allow:update"
  "ansible-platform|vault|observatory/auth/approle/role/payments-batch/secret-id|allow:update"
  "ansible-platform|vault|observatory/auth/token/create/obs-console|allow:update"
  "ansible-platform|vault|observatory/kv/data/finance/reconciliation-api|allow:create"
  "ansible-platform|vault|observatory/kv/data/finance/reconciliation-api|deny:read"
  "ansible-platform|vault|observatory/kv/metadata/finance/reconciliation-api|allow:update"
  "ansible-platform|vault|observatory/database/creds/finance-readonly|deny:read"
  "ansible-platform|vault|observatory/sys/mounts/kv|deny:create"
  "ansible-platform|vault|observatory/sys/policies/acl/obs-noor|deny:update"
  "ansible-platform|vault|observatory/agent-registry/register|deny:update"
  "ansible-platform|vault|observatory/sys/config/oauth-resource-server/corvid-issuer|deny:update"
  "ansible-platform|vault|sys/policies/acl/vid-ansible-platform|deny:update"
)

fails=0
checked=0
skipped=0
for check in "${checks[@]}"; do
  IFS='|' read -r name cluster path expect <<<"$check"
  file="$VID_STATE/tokens/$name"
  if [ ! -s "$file" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$cluster" = seal ]; then vault_node vault-s; else vault_cluster; fi
  caps=$(vcurl "$(cat "$file")" -sS --cacert "$VAULT_CACERT" \
    -X POST -d "{\"paths\":[\"$path\"]}" "$VAULT_ADDR/v1/sys/capabilities-self" |
    jq -r --arg p "$path" 'if .errors then "ERROR" else ((.data // .)[$p] // [] | join(",")) end')
  mode=${expect%%:*}
  cap=${expect#*:}
  if [ "$caps" = ERROR ]; then
    # A refused question proves nothing, also not a deny.
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (capabilities-self refused)\n' "${who:-$name}" "$mode" "$cap" "$path"
    fails=$((fails + 1))
    checked=$((checked + 1))
    continue
  fi
  has=no
  [[ ",$caps," == *",$cap,"* || ",$caps," == *",root,"* ]] && has=yes
  if { [ "$mode" = allow ] && [ "$has" = yes ]; } || { [ "$mode" = deny ] && [ "$has" = no ]; }; then
    printf '  \033[32mok\033[0m   %-17s %-5s %-6s %s\n' "$name" "$mode" "$cap" "$path"
  else
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (has: %s)\n' "$name" "$mode" "$cap" "$path" "${caps:-none}"
    fails=$((fails + 1))
  fi
  checked=$((checked + 1))
done
# ── Principals in namespace observatory (prompt 04) ──────────────────────────
# who|path|allow:cap or deny:cap. Noor logs in with her own password
# (person_login), payments-batch with its AppRole secret id; console is a
# token file. Paths are relative to the namespace. Login tokens are revoked
# after the check. The agents present JWTs, not tokens: the rehearsal proves
# their bounds with real requests (RAR, ceiling).
ns=$(vid_conf VID_NAMESPACE)
people_checks=(
  "noor|kv/data/finance/reconciliation-api|allow:read"
  "noor|kv/data/finance/payroll-export|allow:read"
  "noor|database/creds/finance-readonly|allow:read"
  "noor|kv/metadata/finance/reconciliation-api|deny:read"
  "noor|kv/data/finance/reconciliation-api|deny:update"
  "noor|sys/leases/revoke|deny:update"
  "noor|agent-registry/register|deny:update"
  "payments-batch|database/creds/finance-readonly|allow:read"
  "payments-batch|kv/data/finance/reconciliation-api|deny:read"
  "payments-batch|kv/data/finance/payroll-export|deny:read"
  "console|identity/entity/name/noor|allow:read"
  "console|agent-registry/registration/display-name/finance-agent|allow:read"
  "console|sys/config/oauth-resource-server/corvid-issuer|allow:read"
  "console|kv/metadata/finance/reconciliation-api|allow:read"
  "console|sys/leases/lookup|allow:update"
  "console|sys/leases/revoke|allow:update"
  "console|kv/data/finance/reconciliation-api|deny:read"
  "console|kv/data/finance/payroll-export|deny:read"
  "console|database/creds/finance-readonly|deny:read"
  "console|kv/metadata/finance/reconciliation-api|deny:update"
  "console|agent-registry/register|deny:update"
  "console|sys/policies/acl/obs-console|deny:update"
)
vault_cluster
for check in "${people_checks[@]}"; do
  IFS='|' read -r who path expect <<<"$check"
  revoke=false
  case "$who" in
  console)
    file="$VID_STATE/tokens/$who"
    if [ ! -s "$file" ]; then skipped=$((skipped + 1)); continue; fi
    tok=$(cat "$file")
    ;;
  payments-batch)
    d="$VID_ROOT/.secrets/approle/$who"
    if [ ! -s "$d/secret_id" ]; then skipped=$((skipped + 1)); continue; fi
    tok=$(jq -n --rawfile r "$d/role_id" --rawfile s "$d/secret_id" '{role_id: $r, secret_id: $s}' |
      curl -sf --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $ns" "$VAULT_ADDR/v1/auth/approle/login" --data @- |
      jq -r '.auth.client_token') || { fails=$((fails + 1)); checked=$((checked + 1)); continue; }
    revoke=true
    ;;
  *)
    if [ ! -s "$VID_ROOT/.secrets/people/$who" ]; then skipped=$((skipped + 1)); continue; fi
    person_login "$who" || { fails=$((fails + 1)); checked=$((checked + 1)); continue; }
    tok=$VAULT_TOKEN
    unset VAULT_TOKEN
    revoke=true
    ;;
  esac
  caps=$(vcurl "$tok" -sS --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $ns" \
    -X POST -d "{\"paths\":[\"$path\"]}" "$VAULT_ADDR/v1/sys/capabilities-self" |
    jq -r --arg p "$path" 'if .errors then "ERROR" else ((.data // .)[$p] // [] | join(",")) end')
  [ "$revoke" = false ] || vcurl "$tok" -sS -o /dev/null --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $ns" \
    -X POST "$VAULT_ADDR/v1/auth/token/revoke-self" || true
  unset tok
  mode=${expect%%:*}
  cap=${expect#*:}
  if [ "$caps" = ERROR ]; then
    # A refused question proves nothing, also not a deny.
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (capabilities-self refused)\n' "${who:-$name}" "$mode" "$cap" "$path"
    fails=$((fails + 1))
    checked=$((checked + 1))
    continue
  fi
  has=no
  [[ ",$caps," == *",$cap,"* || ",$caps," == *",root,"* ]] && has=yes
  if { [ "$mode" = allow ] && [ "$has" = yes ]; } || { [ "$mode" = deny ] && [ "$has" = no ]; }; then
    printf '  \033[32mok\033[0m   %-17s %-5s %-6s %s\n' "$who" "$mode" "$cap" "$path"
  else
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (has: %s)\n' "$who" "$mode" "$cap" "$path" "${caps:-none}"
    fails=$((fails + 1))
  fi
  checked=$((checked + 1))
done
mkdir -p "$BUILD_DIR/gates"
jq -n --arg result "$([ "$fails" -eq 0 ] && echo pass || echo fail)" --argjson checked "$checked" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{gate: "boundary", result: $result, checks: $checked, at: $at}' >"$BUILD_DIR/gates/boundary.json"
[ "$fails" -eq 0 ] || die "$fails boundary check(s) failed."
[ "$checked" -gt 0 ] || die "no scoped token found: run make lab"
note=""
[ "$skipped" -eq 0 ] || note=", $skipped skipped: token not issued yet"
info "Token boundary holds ($checked checks$note)"
