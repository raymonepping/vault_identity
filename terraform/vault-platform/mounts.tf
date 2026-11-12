# The static secret: kv/finance/*. Ansible writes the values and their
# custom_metadata labels (D8); Terraform never holds them.
resource "vault_mount" "kv" {
  provider    = vault.observatory
  path        = "kv"
  type        = "kv"
  options     = { version = "2" }
  description = "Corvid Ledger static secrets"
}

# The dynamic secret. The generated username is an identifier, not a secret:
# it stays in clear in the audit log so issuance joins PostgreSQL's log (D10,
# probe P22). The password stays HMAC'd.
resource "vault_mount" "database" {
  provider                     = vault.observatory
  path                         = "database"
  type                         = "database"
  description                  = "PostgreSQL credentials for finance"
  audit_non_hmac_response_keys = ["username"]
}

resource "vault_database_secret_backend_connection" "finance" {
  provider      = vault.observatory
  backend       = vault_mount.database.path
  name          = "finance"
  allowed_roles = ["finance-readonly"]
  postgresql {
    # TLS, verified against the lab CA (the certificate names postgres).
    connection_url          = "postgresql://{{username}}:{{password}}@postgres:5432/finance?sslmode=verify-full&sslrootcert=/vault/config/tls/ca-chain.pem"
    username                = "postgres"
    password_wo             = var.pg_bootstrap_password
    password_wo_version     = var.pg_password_version
    password_authentication = "scram-sha-256"
  }
}

# REVOKE + DROP ROLE without terminating backends: an open session stays
# connected but loses its privileges (case 10, probe P25).
resource "vault_database_secret_backend_role" "finance_readonly" {
  provider              = vault.observatory
  backend               = vault_mount.database.path
  name                  = "finance-readonly"
  db_name               = vault_database_secret_backend_connection.finance.name
  creation_statements   = [trimspace(file("${path.module}/sql/finance-readonly-create.sql"))]
  revocation_statements = [trimspace(file("${path.module}/sql/finance-readonly-revoke.sql"))]
  default_ttl           = 600
  max_ttl               = 1800
}
