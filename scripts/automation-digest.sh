#!/usr/bin/env bash
# scripts/automation-digest.sh: sha256 over everything that decides what the
# lab builds (phases, Ansible, Terraform, policies, the cases).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"
find scripts/phases.txt ansible terraform vault/policies config/cases.json -type f \
  ! -path '*/.terraform/*' ! -name '*.tfstate*' ! -name '.terraform.lock.hcl' -print0 |
  sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1
