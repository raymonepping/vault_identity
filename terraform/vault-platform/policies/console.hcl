# obs-console: the API's own token (D14). It reads identity and configuration
# to explain evidence, looks up leases, and revokes the finance-readonly
# credentials (case 10's responder, the stage reset). It never reads a secret
# value and never gets a credential.
path "identity/entity/id" { capabilities = ["list"] }
path "identity/entity/id/*" { capabilities = ["read"] }
path "identity/entity/name/*" { capabilities = ["read"] }
path "identity/entity-alias/id/*" { capabilities = ["read"] }
path "sys/auth" { capabilities = ["read"] }
# sudo: Vault requires it on this sys/config path, also to read (prompt 04).
path "sys/config/oauth-resource-server/*" { capabilities = ["read", "sudo"] }
path "agent-registry/registration/display-name" { capabilities = ["list"] }
path "agent-registry/registration/display-name/*" { capabilities = ["read"] }
path "agent-registry/registration/entity-id/*" { capabilities = ["read"] }
path "sys/policies/acl/obs-*" { capabilities = ["read"] }
path "kv/metadata/finance/*" { capabilities = ["read"] }
path "database/roles/finance-readonly" { capabilities = ["read"] }
path "auth/approle/role/payments-batch" { capabilities = ["read"] }
path "sys/leases/lookup" { capabilities = ["update"] }
path "sys/leases/revoke" {
  capabilities = ["update"]
  allowed_parameters = {
    "lease_id" = ["database/creds/finance-readonly/*"]
  }
}
path "auth/token/lookup-self" { capabilities = ["read"] }
path "auth/token/renew-self" { capabilities = ["update"] }

path "kv/data/*" { capabilities = ["deny"] }
path "database/creds/*" { capabilities = ["deny"] }
