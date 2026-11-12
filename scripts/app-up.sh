#!/usr/bin/env bash
# scripts/app-up.sh: phase 12 (make app-up). Build images if missing, start
# the app stack, wait until the API answers.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

prefix=$(vid_conf VID_IMAGE_PREFIX)
tag=$(vid_conf VID_IMAGE_TAG)
for t in api web; do
  [ -f "$VID_ROOT/$t/Containerfile" ] || continue
  if ! podman image exists "$prefix/$t:$tag"; then
    echo "app-up: $prefix/$t:$tag not found, building"
    "$VID_ROOT/scripts/app-build.sh" "$t"
  fi
done
"$VID_ROOT/scripts/compose.sh" app up -d
for _ in $(seq 1 40); do
  curl -sf --cacert "$VID_ROOT/vault-tls/ca-chain.pem" "https://localhost:$(vid_conf VID_PORT_WEB)/api/healthz" >/dev/null 2>&1 && break
  sleep 3
done
curl -sf --cacert "$VID_ROOT/vault-tls/ca-chain.pem" "https://localhost:$(vid_conf VID_PORT_WEB)/api/healthz" >/dev/null || die "app-up: the API is not healthy behind the console (make app-logs)"
# Only reached after a successful start: one-shot init containers go (compose
# recreates them on the next up). A failed start keeps them and their logs.
"$VID_ROOT/scripts/compose.sh" app rm -f volume-init >/dev/null 2>&1 || true
echo "app-up: stack started, the API answers; one-shot volume-init removed"
echo "  Console: https://localhost:$(vid_conf VID_PORT_WEB)/   (lab CA; make trust-root to trust it)"
echo "  API:     https://localhost:$(vid_conf VID_PORT_WEB)/api/healthz (behind the console; not published on its own)"
