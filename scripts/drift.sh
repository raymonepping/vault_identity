#!/usr/bin/env bash
# scripts/drift.sh (make drift): read-only. `terraform plan
# -detailed-exitcode` on every Terraform root and `--check` on every Ansible
# phase; one table. TF_ONLY=1: Terraform only (make lab, after idempotency).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
mkdir -p "$BUILD_DIR/logs" "$BUILD_DIR/gates"
rows=()
fails=0
while read -r tool name; do
  log="$BUILD_DIR/logs/drift-$name.log"
  if [ "$tool" = tf ]; then
    rc=0
    ./scripts/tf.sh "$name" plan -no-color >"$log" 2>&1 </dev/null || rc=$?
    case $rc in
    0) rows+=("$name|terraform|clean|plan empty") ;;
    2)
      rows+=("$name|terraform|DRIFT|$(grep -E '^Plan:' "$log" | head -1)")
      fails=$((fails + 1))
      ;;
    *)
      rows+=("$name|terraform|ERROR|see ${log#"$VID_ROOT"/}")
      fails=$((fails + 1))
      ;;
    esac
  elif [ "$tool" = ansible ] && [ "${TF_ONLY:-0}" != 1 ]; then
    if ./scripts/ansible.sh "$name" --check >"$log" 2>&1; then
      changed=$(jq -r '.changed_total' "$BUILD_DIR/ansible-stats/$name.check.json")
      if [ "$changed" = 0 ]; then rows+=("$name|ansible|clean|check mode changed=0")
      else
        rows+=("$name|ansible|DRIFT|check mode would change $changed")
        fails=$((fails + 1))
      fi
    else
      rows+=("$name|ansible|ERROR|see ${log#"$VID_ROOT"/}")
      fails=$((fails + 1))
    fi
  fi
done < <(phases)
printf '\n%-16s %-10s %-7s %s\n' LAYER TOOL RESULT DETAIL
for row in "${rows[@]}"; do
  IFS='|' read -r l t r d <<<"$row"
  printf '%-16s %-10s %-7s %s\n' "$l" "$t" "$r" "$d"
done
jq -n --arg result "$([ "$fails" -eq 0 ] && echo pass || echo fail)" --arg scope "$([ "${TF_ONLY:-0}" = 1 ] && echo terraform || echo all)" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{gate: "drift", scope: $scope, result: $result, at: $at}' >"$BUILD_DIR/gates/drift.json"
[ "$fails" -eq 0 ] || die "$fails layer(s) drifted."
info "No drift"
