terraform {
  required_version = ">= 1.14"
  # State lives in .secrets/terraform/vault-platform/ (scripts/tf.sh sets the path).
  backend "local" {}
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "5.13.0"
    }
  }
}

# Address, CA and the tf-platform token come from scripts/tf.sh (VAULT_TOKEN for
# this process only). The provider's child token is a subset of vid-tf-platform.
provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
}

# The story's namespace (D9). The token is the same root-namespace token: Vault
# checks its policy against the observatory/ prefix of each path.
provider "vault" {
  alias        = "observatory"
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
  namespace    = vault_namespace.observatory.path
}
