#!/usr/bin/env bash
# scripts/license-features.sh: which licensed features this lab needs, and
# whether the cluster's autoloaded licence has them. Read-only. Prints feature
# names and the expiry date, never the licence itself.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

vault_cluster
vault_token ansible-platform
status=$(vault read -format=json sys/license/status)
version=$(vault_json | jq -r .version)
unset VAULT_TOKEN
features=$(jq -r '.data.autoloaded.features[]' <<<"$status")

echo "cluster licence: expires $(jq -r '.data.autoloaded.expiration_time' <<<"$status" | cut -c1-10), Vault $version"
case "$version" in *+ent*) ;; *)
  echo "  NOT Enterprise: namespaces and Agentic IAM need it." >&2
  exit 1
  ;;
esac
missing=0
has() { grep -qxF "$1" <<<"$features"; }
row() { # <area> <needs> [feature]: "edition" rows need Enterprise only
  local got
  if [ -z "${3:-}" ]; then
    got="yes (Enterprise $version)"
  elif has "$3"; then
    got="yes"
  else
    got="NO"
    missing=1
  fi
  printf '  %-28s %-34s %s\n' "$1" "$2" "$got"
}
printf '  %-28s %-34s %s\n' AREA NEEDS LICENSED
row "The whole lab (namespace)" "Namespaces" "Namespaces"
row "Cases 3 to 8, 10 (agents)" "Agentic IAM" "Agentic IAM"
echo
echo "Feature names in the licence:"
sed 's/^/  - /' <<<"$features"
exit "$missing"
