#!/usr/bin/env bash
# scripts/backup.sh: Raft snapshots of vault-s and the cluster, the evidence
# store, plus .secrets, into backups/<timestamp>/ (0700). Scoped tokens only: ansible-seal and
# ansible-platform hold sys/storage/raft/snapshot read (bootstrap policies).
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VID_ROOT"

dest="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dest"
chmod 700 backups "$dest"
vault_node vault-s
vault_token ansible-seal
vault operator raft snapshot save "$dest/vault-s.snap"
unset VAULT_TOKEN
vault_active
vault_token ansible-platform
vault operator raft snapshot save "$dest/cluster.snap"
unset VAULT_TOKEN
# The evidence store: a consistent copy (VACUUM INTO) made inside the API.
if [ "$(vid_container_state vid-api)" = running ]; then
  podman exec vid-api node --disable-warning=ExperimentalWarning -e \
    "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(process.env.EVIDENCE_DB).exec(\"VACUUM INTO '/tmp/evidence.db'\")"
  podman cp vid-api:/tmp/evidence.db "$dest/evidence.db"
  podman exec vid-api rm -f /tmp/evidence.db
  chmod 600 "$dest/evidence.db"
fi
# Not .secrets/legacy (credentials of a cluster clean-slate removed) and not
# Terraform's provider cache (a re-downloadable binary).
tar -C "$VID_ROOT" --exclude '.secrets/legacy' --exclude '*/.terraform' -czf "$dest/secrets.tgz" .secrets
echo "backup: $dest (vault-s.snap, cluster.snap, evidence.db, secrets.tgz)"
du -sh "$dest" | awk '{print "backup: " $1}'
