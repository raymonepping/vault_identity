# Agentic IAM (D12): the lab issuer's OAuth resource server profile, in static
# key mode, and the two Agent Registry records. The provider has no resources
# for them; vault_generic_endpoint writes are idempotent (probe P5, P7).
resource "vault_generic_endpoint" "profile" {
  provider             = vault.observatory
  path                 = "sys/config/oauth-resource-server/corvid-issuer"
  ignore_absent_fields = true
  write_fields         = ["mount_accessor", "config_id"]
  data_json = jsonencode({
    issuer_id            = var.issuer
    use_jwks             = false
    public_keys          = [{ key_id = "corvid-1", pem = file(var.issuer_public_key_file) }]
    audiences            = [var.audience]
    supported_algorithms = ["ES256"]
    user_claim           = "sub"
    actor_claim          = "act.sub"
  })
}

# Registration by display name creates when absent and updates when present
# (probe P7). A read adds default and default-ceiling to ceiling_policies, so
# they are written explicitly to keep the plan empty.
locals {
  agents = {
    "ledger-agent" = {
      description      = "Nightly reconciliation bot; acts only as itself (no OBO ceiling beyond the defaults)."
      ceiling_policies = ["default", "default-ceiling"]
    }
    "finance-agent" = {
      description      = "Noor's assistant; acts on behalf of people within obs-finance-ceiling."
      ceiling_policies = ["default", "default-ceiling", "obs-finance-ceiling"]
    }
  }
}

resource "vault_generic_endpoint" "agent" {
  for_each             = local.agents
  provider             = vault.observatory
  path                 = "agent-registry/registration/display-name/${each.key}"
  ignore_absent_fields = true
  data_json = jsonencode({
    entity_id        = vault_identity_entity.principal[each.key].id
    owner            = "finance-platform"
    description      = each.value.description
    ceiling_policies = each.value.ceiling_policies
  })
  depends_on = [vault_policy.obs]
}
