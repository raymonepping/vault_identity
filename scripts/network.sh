#!/bin/sh
# scripts/network.sh: create the shared network if it does not exist.
set -eu
podman network exists vid-internal || podman network create --label io.vid.project=vault_identity vid-internal >/dev/null
