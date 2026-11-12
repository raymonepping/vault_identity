#!/usr/bin/env bash
# scripts/stage-reset.sh (make stage-reset, D20): after a rehearsal or a show.
# Revokes every credential the runs issued, puts the KV labels back, and asks
# the API to clear its evidence store and ingest from now on (Vault's audit
# files are never edited). CONFIRM=yes skips the question.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
answer=${CONFIRM:-}
if [ "$answer" != yes ]; then
  printf 'This revokes the runs credentials and clears the evidence store. Type yes: '
  read -r answer
fi
[ "$answer" = yes ] || {
  echo "Aborted."
  exit 1
}
./scripts/ansible.sh stage-reset >/dev/null
./scripts/ansible.sh stage >/dev/null
if [ "$(vid_container_state vid-api)" = running ]; then
  podman exec vid-api node --disable-warning=ExperimentalWarning scripts/reset.js || die "stage-reset: the API could not clear its evidence store (podman logs vid-api)"
else
  echo "stage-reset: the API is not running, so its evidence store was NOT cleared: make up, then make stage-reset again"
fi
echo "stage-reset: credentials revoked, labels back, evidence store cleared"
