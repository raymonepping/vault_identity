output "namespace" {
  value = vault_namespace.observatory.path_fq
}

output "userpass_accessor" {
  value = vault_auth_backend.userpass.accessor
}

output "approle_accessor" {
  value = vault_auth_backend.approle.accessor
}

output "profile_mount_accessor" {
  value = vault_generic_endpoint.profile.write_data["mount_accessor"]
}

output "entity_ids" {
  value = { for k, e in vault_identity_entity.principal : k => e.id }
}

output "policies" {
  value = sort(keys(local.policies))
}
