# vault-3: one of three Raft voters. Auto-unseals through vault-s's Transit
# key with its own seal token (scripts/vault-server.sh reads it from
# /run/secrets/transit-token; it is not in this file). Writes its own audit
# log (/vault/audit, one volume per node): the Epilogue merges all three.
ui            = true
disable_mlock = true

api_addr     = "https://vault-3:8200"
cluster_addr = "https://vault-3:8201"

default_lease_ttl = "1h"
max_lease_ttl     = "2160h"

seal "transit" {
  address     = "https://vault-s:8200"
  key_name    = "autounseal"
  mount_path  = "transit/"
  tls_ca_cert = "/vault/config/tls/ca-chain.pem"
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_cert_file   = "/vault/config/tls/vault.crt"
  tls_key_file    = "/vault/config/tls/vault.key"
  tls_min_version = "tls13"
}

storage "raft" {
  path    = "/vault/file"
  node_id = "vault-3"

  retry_join {
    leader_api_addr     = "https://vault-1:8200"
    leader_ca_cert_file = "/vault/config/tls/ca-chain.pem"
  }
  retry_join {
    leader_api_addr     = "https://vault-2:8200"
    leader_ca_cert_file = "/vault/config/tls/ca-chain.pem"
  }
}

log_level = "warn"

# Userpass lockout, bounded: Vault's default (5 failures, 15 minutes) would
# lock a person out for the rest of a talk after a typo (D11).
user_lockout "userpass" {
  lockout_threshold     = 5
  lockout_duration      = "60s"
  lockout_counter_reset = "60s"
}
