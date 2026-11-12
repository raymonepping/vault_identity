#!/usr/bin/env bash
# scripts/data-up.sh (make data-up): PostgreSQL, then wait until it answers.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
./scripts/data-secrets.sh
./scripts/network.sh
./scripts/compose.sh data up -d >/dev/null
for _ in $(seq 1 60); do
  [ "$(podman inspect vid-postgres --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(podman inspect vid-postgres --format '{{.State.Health.Status}}')" = healthy ] ||
  die "data-up: vid-postgres is not healthy (podman logs vid-postgres)"
echo "data-up: postgres healthy (database finance; not published on the host)"
