# vid-tf-platform: Terraform root vault-platform on the cluster (D7, prompt 04).
# Declared, plannable structure: two audit devices and the audited headers
# (root namespace), the namespace observatory and, inside it, the userpass,
# approle, kv and database mounts, the database connection and role, the obs-*
# ACL policies, the entities and their aliases, the OAuth resource server
# profile and the Agent Registry records.
# It may NOT use any of it: no secret read, no credentials, no password, no
# secret id, no token, no rotate-root (D8).
# Written complete in prompt 02: after root revocation nothing can widen it
# (make root-regen CLUSTER=vault is the user's deliberate act).
# A root-namespace token reaches namespace observatory through paths prefixed
# observatory/ (the provider sends X-Vault-Namespace; Vault checks the prefix).

# ── Audit, root namespace (sudo: Vault requires it) ──────────────────────────
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/audit/file" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/audit/stdout" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/config/auditing/request-headers" { capabilities = ["read", "sudo"] }
path "sys/config/auditing/request-headers/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── The namespace ────────────────────────────────────────────────────────────
path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/observatory" { capabilities = ["create", "read", "update", "delete"] }

# ── Mounts in observatory ────────────────────────────────────────────────────
path "observatory/sys/mounts" { capabilities = ["read"] }
path "observatory/sys/mounts/kv" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/sys/mounts/database" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/sys/mounts/kv/tune" { capabilities = ["read", "update"] }
path "observatory/sys/mounts/database/tune" { capabilities = ["read", "update"] }
path "observatory/kv/config" { capabilities = ["create", "read", "update"] }
path "observatory/database/config/finance" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/database/roles/finance-readonly" { capabilities = ["create", "read", "update", "delete"] }

# ── Auth in observatory (enable, read and tune need sudo; the provider reads
#    sys/mounts/auth/<path>) ──────────────────────────────────────────────────
path "observatory/sys/auth" { capabilities = ["read"] }
path "observatory/sys/auth/userpass" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "observatory/sys/auth/approle" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "observatory/sys/auth/+/tune" { capabilities = ["read", "update", "sudo"] }
path "observatory/sys/mounts/auth/userpass" { capabilities = ["read"] }
path "observatory/sys/mounts/auth/approle" { capabilities = ["read"] }
path "observatory/sys/mounts/auth/token" { capabilities = ["read"] }
path "observatory/sys/mounts/auth/+/tune" { capabilities = ["read", "update", "sudo"] }
path "observatory/sys/auth/token" { capabilities = ["read"] }
# The AppRole role is structure; its secret ids are runtime (Ansible).
path "observatory/auth/approle/role/payments-batch" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/auth/approle/role/payments-batch/role-id" { capabilities = ["read"] }

# ── The console's token role (D14) ───────────────────────────────────────────
path "observatory/auth/token/roles" { capabilities = ["list"] }
path "observatory/auth/token/roles/obs-console" { capabilities = ["create", "read", "update", "delete"] }

# ── Identity: entities and their aliases (userpass and the OAuth profile) ────
path "observatory/identity/entity" { capabilities = ["create", "update"] }
path "observatory/identity/entity/id/*" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/identity/entity/name/*" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/identity/entity-alias" { capabilities = ["create", "update"] }
path "observatory/identity/entity-alias/id/*" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/identity/lookup/entity" { capabilities = ["update"] }

# ── Agentic IAM: the OAuth resource server profile and the Agent Registry ───
# The profile is a sys/config path: Vault requires sudo (measured, prompt 04).
path "observatory/sys/config/oauth-resource-server" { capabilities = ["read", "list", "sudo"] }
path "observatory/sys/config/oauth-resource-server/*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "observatory/agent-registry/register" { capabilities = ["create", "update"] }
path "observatory/agent-registry/registration/*" { capabilities = ["create", "read", "update", "delete", "list"] }

# ── Policies: the story's obs-* ACLs only ────────────────────────────────────
path "observatory/sys/policies/acl" { capabilities = ["list"] }
path "observatory/sys/policies/acl/obs-*" { capabilities = ["create", "read", "update", "delete"] }
path "observatory/sys/policy/obs-*" { capabilities = ["create", "read", "update", "delete"] }

# ── The provider ─────────────────────────────────────────────────────────────
path "auth/token/create" { capabilities = ["update"] }
path "auth/token/lookup-self" { capabilities = ["read"] }
path "sys/license/status" { capabilities = ["read"] }

# ── Never ────────────────────────────────────────────────────────────────────
path "observatory/kv/data/*" { capabilities = ["deny"] }
path "observatory/kv/metadata/*" { capabilities = ["deny"] }
path "observatory/database/creds/*" { capabilities = ["deny"] }
path "observatory/database/rotate-root/*" { capabilities = ["deny"] }
path "observatory/auth/userpass/users/*" { capabilities = ["deny"] }
path "observatory/auth/approle/role/payments-batch/secret-id" { capabilities = ["deny"] }
path "observatory/auth/token/create/*" { capabilities = ["deny"] }
path "observatory/sys/leases/*" { capabilities = ["deny"] }
path "sys/policies/acl/vid-*" { capabilities = ["deny"] }
