#!/usr/bin/env bash
# scripts/data-secrets.sh: the data plane's one secret, Postgres's bootstrap
# password, generated once into .secrets/data/pg-bootstrap (0600), never
# overwritten, never printed. Terraform hands it to Vault (password_wo) and
# Ansible's data phase rotates it away (D8).
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
d="$VID_ROOT/.secrets/data"
mkdir -p "$d" && chmod 700 "$d"
if [ -s "$d/pg-bootstrap" ]; then
  echo "data-secrets: kept .secrets/data/pg-bootstrap"
  exit 0
fi
openssl rand -hex 24 >"$d/pg-bootstrap"
chmod 600 "$d/pg-bootstrap"
echo "data-secrets: generated .secrets/data/pg-bootstrap"
