#!/usr/bin/env bash
# scripts/ansible.sh <playbook> [--check] [ansible-playbook args...]
# scripts/ansible.sh --version-check
#
# The only supported way to run Ansible here. Runs from the repo root with
# ansible.cfg. Ansible refuses non-blocking stdio (agent shells, some CI), so
# stdin comes from /dev/null and output goes through cat. Passes token file
# PATHS (vid_tokens_dir), never a token, plus the non-secret lab settings in
# .build/ansible-vars.json. The vid_stats callback writes the play recap
# counts to .build/ansible-stats/<playbook>[.check].json.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
export ANSIBLE_CONFIG="$VID_ROOT/ansible.cfg"

if [ "${1:-}" = --version-check ]; then
  v=$(ansible-playbook --version </dev/null 2>&1 | cat | head -1)
  echo "$v"
  [[ "$v" == *"core 2.2"[1-9]* ]] || die "ansible-core 2.21 or later is required"
  exit 0
fi

playbook=${1:?Usage: ansible.sh <playbook> [--check] [args]}
shift
playbook=${playbook%.yml}
[ -f "ansible/$playbook.yml" ] || die "ansible: unknown playbook ansible/$playbook.yml"

mkdir -p "$BUILD_DIR/ansible-stats"
jq -n \
  --arg root "$VID_ROOT" \
  --arg tokens "$VID_STATE/tokens" \
  --arg state "$VID_STATE" \
  --arg ca "$VAULT_CACERT" \
  --arg seal "https://127.0.0.1:$(vid_conf VID_PORT_VAULT_S)" \
  --argjson nodes "$(for n in vault-1 vault-2 vault-3; do jq -n --arg n "$n" --arg a "https://127.0.0.1:$(vault_port_of "$n")" '{($n): $a}'; done | jq -s add)" \
  --arg web "https://localhost:$(vid_conf VID_PORT_WEB)" \
  --arg namespace "$(vid_conf VID_NAMESPACE)" \
  --argjson session_idle "$(vid_conf VID_SESSION_IDLE)" \
  '{vid_root: $root, vid_tokens_dir: $tokens, vid_state_dir: $state, vid_ca: $ca,
    vid_seal_addr: $seal, vid_node_addrs: $nodes, vid_cluster_addr: $nodes["vault-1"],
    vid_web_url: $web, vid_namespace: $namespace,
    vid_session_idle: $session_idle}' >"$BUILD_DIR/ansible-vars.json"

# A user-run make root-regen leaves a root token file; bootstrap phases may
# use it (never revoke it: make root-revoke does) to re-apply a policy change.
if [ -n "${VID_ROOT_FILE:-}" ]; then
  [ -s "$VID_ROOT_FILE" ] || die "VID_ROOT_FILE=$VID_ROOT_FILE is not a file"
  jq --arg f "$(cd "$(dirname "$VID_ROOT_FILE")" && pwd)/$(basename "$VID_ROOT_FILE")" '. + {vid_root_file: $f}' \
    "$BUILD_DIR/ansible-vars.json" >"$BUILD_DIR/ansible-vars.json.tmp" && mv "$BUILD_DIR/ansible-vars.json.tmp" "$BUILD_DIR/ansible-vars.json"
fi

export VID_PHASE="$playbook" VID_STATS_DIR="$BUILD_DIR/ansible-stats"
set -o pipefail
ansible-playbook "ansible/$playbook.yml" -e "@$BUILD_DIR/ansible-vars.json" "$@" </dev/null 2>&1 | cat
