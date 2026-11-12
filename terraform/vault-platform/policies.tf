# Every principal's policy (the brief's principals table) and the console's.
locals {
  policies = {
    "obs-noor"            = "noor.hcl"
    "obs-ledger-agent"    = "ledger-agent.hcl"
    "obs-finance-agent"   = "finance-agent.hcl"
    "obs-finance-ceiling" = "finance-ceiling.hcl"
    "obs-payments-batch"  = "payments-batch.hcl"
    "obs-console"         = "console.hcl"
  }
}

resource "vault_policy" "obs" {
  for_each = local.policies
  provider = vault.observatory
  name     = each.key
  policy   = file("${path.module}/policies/${each.value}")
}
