terraform {
  required_version = ">= 1.14"
  # State lives in .secrets/terraform/vault-seal/ (scripts/tf.sh sets the path).
  backend "local" {}
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "5.13.0"
    }
  }
}

# Address, CA and the tf-seal token come from scripts/tf.sh (VAULT_TOKEN for
# this process only). The provider's child token is a subset of vid-tf-seal.
provider "vault" {
  address      = var.vault_addr
  ca_cert_file = var.vault_cacert
}
