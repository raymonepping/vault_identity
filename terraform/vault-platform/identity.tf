# The principals' entities. Baselines sit on the entity, so every door (alias)
# of a principal carries them. payments-batch gets its entity from its AppRole
# login (an ordinary workload, not modelled here).
locals {
  entities = {
    "noor"          = { policies = ["obs-noor"], metadata = { team = "finance", kind = "human" } }
    "ledger-agent"  = { policies = ["obs-ledger-agent"], metadata = { team = "finance-platform", kind = "agent" } }
    "finance-agent" = { policies = ["obs-finance-agent"], metadata = { team = "finance-platform", kind = "agent" } }
  }
  # The JWT subject (or actor) each entity answers to on the OAuth profile.
  profile_subjects = {
    "noor"          = "noor"
    "ledger-agent"  = "agent:ledger-agent"
    "finance-agent" = "agent:finance-agent"
  }
}

resource "vault_identity_entity" "principal" {
  for_each   = local.entities
  provider   = vault.observatory
  name       = each.key
  policies   = each.value.policies
  metadata   = each.value.metadata
  depends_on = [vault_policy.obs]
}

# Noor's first door: her userpass login.
resource "vault_identity_entity_alias" "noor_userpass" {
  provider       = vault.observatory
  name           = "noor"
  mount_accessor = vault_auth_backend.userpass.accessor
  canonical_id   = vault_identity_entity.principal["noor"].id
}

# The second door for each: the OAuth profile. Bound by profile_name +
# external_id, not by the synthetic mount_accessor: an accessor-bound alias is
# accepted and reads back the same, but never authenticates a JWT (403, probe
# P6). The provider's vault_identity_entity_alias only sends mount_accessor,
# so this is a generic endpoint. identity/entity-alias has no read by name and
# an alias goes with its entity, so read and delete are off; changing one
# means deleting the entity (it would answer "already in use").
resource "vault_generic_endpoint" "profile_alias" {
  for_each       = local.profile_subjects
  provider       = vault.observatory
  path           = "identity/entity-alias"
  disable_read   = true
  disable_delete = true
  data_json = jsonencode({
    name         = each.value
    canonical_id = vault_identity_entity.principal[each.key].id
    profile_name = "corvid-issuer"
    external_id  = each.value
  })
  depends_on = [vault_generic_endpoint.profile]
}
