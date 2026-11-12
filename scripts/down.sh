#!/usr/bin/env bash
# scripts/down.sh (make down, and the Lab Index's Stop): stop the app,
# PostgreSQL, the cluster, then vault-s. Containers and volumes are kept. It says it stopped
# only when podman shows no running vid- container; otherwise it names what
# still runs and fails (the Lab Index then shows a failed stop, not a false one).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
podman info >/dev/null 2>&1 || die "down: Podman does not answer (is the machine running?); nothing was stopped"
for stack in app data vault seal; do
  "$VID_ROOT/scripts/compose.sh" "$stack" stop >/dev/null 2>&1 || true
done
left=$(podman ps --filter name=^vid- --filter status=running --format '{{.Names}}' | paste -sd' ' -)
[ -z "$left" ] || die "down: still running: $left (podman logs <name>, then make down again)"
echo "down: api, web, postgres, vault-1..3 and vault-s stopped; every vid- volume kept (make up starts it again)"
