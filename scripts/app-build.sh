#!/usr/bin/env bash
# scripts/app-build.sh [api|web ...]: build the app images (arm64). The build
# context is staged to $TMPDIR: macOS TCC can refuse Podman reads under
# ~/Documents, and xattrs break builds. The API image carries
# config/cases.json without the KV values.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
export COPYFILE_DISABLE=1

targets=${*:-api web}
prefix=$(vid_conf VID_IMAGE_PREFIX)
tag=$(vid_conf VID_IMAGE_TAG)

for t in $targets; do
  ctx=$(mktemp -d "${TMPDIR:-/tmp}/vid-$t.XXXXXX")
  case "$t" in
  api)
    rsync -a --exclude node_modules --exclude test --exclude '._*' --exclude .DS_Store "$VID_ROOT/api/" "$ctx/"
    mkdir -p "$ctx/config"
    node "$VID_ROOT/scripts/cases-check.js" >/dev/null
    # The API never needs the KV values: they stay out of the image.
    jq 'del(.secrets[].value)' "$VID_ROOT/config/cases.json" >"$ctx/config/cases.json"
    while IFS= read -r v; do
      ! grep -rqF -- "$v" "$ctx" || die "app-build: a KV value reached the API image"
    done < <(jq -r '.secrets[].value // {} | .[]' "$VID_ROOT/config/cases.json")
    ;;
  web)
    rsync -a --exclude node_modules --exclude dist --exclude test --exclude '._*' --exclude .DS_Store "$VID_ROOT/web/" "$ctx/"
    ;;
  *)
    echo "app-build: unknown target '$t'" >&2
    exit 64
    ;;
  esac
  xattr -rc "$ctx" 2>/dev/null || true
  # common.sh sets umask 077; the images run as non-root users that must read
  # these files.
  chmod -R a+rX "$ctx"
  echo "app-build: building $prefix/$t:$tag"
  podman build -q --format docker --platform linux/arm64 \
    --build-arg NODE_IMAGE="$(vid_conf NODE_IMAGE)" \
    --build-arg NGINX_IMAGE="$(vid_conf NGINX_IMAGE)" \
    -t "$prefix/$t:$tag" -f "$ctx/Containerfile" "$ctx" >/dev/null
  rm -rf "$ctx"
  arch=$(podman image inspect "$prefix/$t:$tag" --format '{{.Architecture}}')
  [ "$arch" = arm64 ] || {
    echo "app-build: $t is $arch, not arm64" >&2
    exit 1
  }
done
