# Noor signs in here (D11). Her entity also has an alias on the OAuth profile
# (identity.tf): one person, two doors.
resource "vault_auth_backend" "userpass" {
  provider    = vault.observatory
  type        = "userpass"
  path        = "userpass"
  description = "Corvid Ledger people"
}

# The workload (payments-batch). Ansible mints its secret id with metadata
# (application, team), which lands in the token's metadata (D8).
resource "vault_auth_backend" "approle" {
  provider    = vault.observatory
  type        = "approle"
  path        = "approle"
  description = "Corvid Ledger workloads"
}

resource "vault_approle_auth_backend_role" "payments_batch" {
  provider       = vault.observatory
  backend        = vault_auth_backend.approle.path
  role_name      = "payments-batch"
  token_policies = ["obs-payments-batch"]
  token_ttl      = 300
  token_max_ttl  = 600
}

# The console's own token (D14): periodic, orphan, renewed by the API.
resource "vault_token_auth_backend_role" "console" {
  provider         = vault.observatory
  role_name        = "obs-console"
  allowed_policies = ["obs-console"]
  orphan           = true
  renewable        = true
  token_period     = 86400
}
