#!/usr/bin/env bash
# scripts/show-ready.sh (make show-ready): five minutes before the talk.
# clock-sync, up, a fresh stage, verify, the console. One green line, or the
# first failing check with its fix. verify ends with a rehearsal and a fresh
# stage, so the evidence store is empty when the talk starts.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
t0=$(date +%s)
run() { # <label> <fix> <command...>
  local label=$1 fix=$2
  shift 2
  if ! "$@" >"$BUILD_DIR/show-ready.log" 2>&1; then
    grep -E '✗|FAIL|failed|error' "$BUILD_DIR/show-ready.log" | head -5 >&2 || tail -5 "$BUILD_DIR/show-ready.log" >&2
    die "show-ready: $label failed. Fix: $fix"
  fi
}
mkdir -p "$BUILD_DIR"
run "clock-sync" "make clock-sync (podman machine ssh must work)" ./scripts/clock-sync.sh
run "up" "make doctor" ./scripts/up.sh
run "stage-reset" "make stage-reset CONFIRM=yes, then make doctor" env CONFIRM=yes ./scripts/stage-reset.sh
run "verify" "make verify, then the command it names" ./scripts/verify.sh
url="https://localhost:$(vid_conf VID_PORT_WEB)/#/overview"
[ "$(uname -s)" = Darwin ] && [ -z "${NO_OPEN:-}" ] && open "$url" || true
printf '\033[32mshow-ready: green in %ss. The console is at %s. Break a leg.\033[0m\n' "$(($(date +%s) - t0))" "$url"
