#!/usr/bin/env bash
# scripts/people-password.sh <user> (make people-copy-password [U=noor]): put a
# person's password on the macOS clipboard for the sign-in form (D11). It is
# never printed; only its fingerprint is.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
user=${1:?Usage: people-password.sh <user>}
[[ "$user" =~ ^[a-z][a-z0-9-]{1,31}$ ]] || die "people-password: not a user name: $user"
file="$VID_ROOT/.secrets/people/$user"
[ -s "$file" ] || die "people-password: no password for $user (make people creates them)"
command -v pbcopy >/dev/null || die "people-password: pbcopy not found (macOS only)"
tr -d '\n' <"$file" | pbcopy
echo "people-password: $user's password is on the clipboard (fingerprint $(fingerprint "$(cat "$file")"))"
