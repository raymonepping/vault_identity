# vid-ansible-platform: Ansible on the cluster (D7). Order and moment: rotate
# the database root away, Noor's password, the AppRole secret id, the console
# token, the KV values and their labels, the stage reset, Raft health and
# snapshots, step-down, and the read-only checks of validate and verify.
# It may NOT create a mount, write a policy, read a secret value or request
# database credentials (D8).
# Written complete in prompt 02: after root revocation nothing can widen it.

# ── Database: rotate the bootstrap password away (once) ──────────────────────
path "observatory/database/rotate-root/finance" { capabilities = ["update"] }
path "observatory/database/config/finance" { capabilities = ["read"] }

# ── People: Noor's userpass user (password, token TTLs) ──────────────────────
path "observatory/auth/userpass/users" { capabilities = ["list"] }
path "observatory/auth/userpass/users/noor" { capabilities = ["create", "read", "update"] }

# ── The workload: AppRole role id and secret ids (runtime) ───────────────────
path "observatory/auth/approle/role/payments-batch/role-id" { capabilities = ["read"] }
path "observatory/auth/approle/role/payments-batch/secret-id" { capabilities = ["update", "list"] }
path "observatory/auth/approle/role/payments-batch/secret-id/lookup" { capabilities = ["update"] }
path "observatory/auth/approle/role/payments-batch/secret-id/destroy" { capabilities = ["update"] }
path "observatory/auth/approle/role/payments-batch/secret-id-accessor/*" { capabilities = ["update"] }
path "observatory/auth/approle/login" { capabilities = ["update"] }

# ── The console token from Terraform's role (D14); sudo: minting in a child
#    namespace from a root-namespace token needs it (measured in vault_governor) ────
path "observatory/auth/token/create/obs-console" { capabilities = ["update", "sudo"] }
path "observatory/auth/token/lookup" { capabilities = ["update"] }
path "observatory/auth/token/lookup-accessor" { capabilities = ["update"] }
path "observatory/auth/token/revoke-accessor" { capabilities = ["update"] }
path "observatory/auth/token/roles/*" { capabilities = ["read"] }

# ── Stage (D8): values written, labels written and read, values never read ──
path "observatory/kv/data/finance/*" { capabilities = ["create", "update"] }
path "observatory/kv/metadata/finance/*" { capabilities = ["create", "read", "update"] }

# ── Stage reset (D20): revoke every credential the runs issued ──────────────
path "observatory/sys/leases/revoke-prefix/database/creds/finance-readonly" { capabilities = ["update", "sudo"] }
path "observatory/sys/leases/lookup" { capabilities = ["update"] }

# ── Cluster operations ───────────────────────────────────────────────────────
path "sys/storage/raft/configuration" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
path "sys/step-down" { capabilities = ["update", "sudo"] }
path "sys/license/status" { capabilities = ["read"] }
path "sys/health" { capabilities = ["read"] }
path "auth/token/lookup" { capabilities = ["update"] }

# ── Read-only checks (validate, verify, doctor) ──────────────────────────────
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/config/auditing/request-headers" { capabilities = ["read", "sudo"] }
path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/observatory" { capabilities = ["read"] }
path "observatory/sys/mounts" { capabilities = ["read"] }
path "observatory/sys/auth" { capabilities = ["read"] }
path "observatory/sys/policies/acl/obs-*" { capabilities = ["read"] }
path "observatory/identity/entity/name/*" { capabilities = ["read"] }
path "observatory/identity/entity/id/*" { capabilities = ["read"] }
path "observatory/sys/config/oauth-resource-server/*" { capabilities = ["read", "sudo"] }
path "observatory/agent-registry/registration/*" { capabilities = ["read", "list"] }
path "observatory/database/roles/finance-readonly" { capabilities = ["read"] }

# Break glass (make root-regen): Vault 2.0 requires a token as well as the
# key share for sys/generate-root (HCSEC-2026-08). root-regen.sh sends this token.
path "sys/generate-root/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── Never ────────────────────────────────────────────────────────────────────
path "observatory/database/creds/*" { capabilities = ["deny"] }
path "observatory/sys/mounts/*" { capabilities = ["deny"] }
path "sys/mounts/*" { capabilities = ["deny"] }
path "sys/policies/acl/vid-*" { capabilities = ["deny"] }
