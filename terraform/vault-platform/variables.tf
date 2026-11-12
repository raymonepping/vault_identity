variable "vault_addr" {
  description = "The cluster on a published loopback port (scripts/tf.sh)."
  type        = string
}

variable "vault_cacert" {
  description = "The lab CA chain (vault-tls/ca-chain.pem)."
  type        = string
}

variable "namespace" {
  description = "The namespace every object of the story lives in (D9)."
  type        = string
  default     = "observatory"
}

variable "issuer" {
  description = "The lab issuer's iss claim (D12, VID_ISSUER)."
  type        = string
}

variable "audience" {
  description = "The audience the lab issuer puts in aud (D12, VID_AUDIENCE)."
  type        = string
}

variable "issuer_public_key_file" {
  description = "The lab issuer's public key (.secrets/issuer/signing.pub.pem); not secret."
  type        = string
}

variable "pg_bootstrap_password" {
  description = "Postgres's bootstrap password (.secrets/data/pg-bootstrap), written once and never stored: Ansible rotates it away (D8)."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "pg_password_version" {
  description = "Bump to send pg_bootstrap_password again (after a database rebuild)."
  type        = number
  default     = 1
}
