# obs-ledger-agent: the autonomous agent's baseline (its own entity). Used when
# it acts as itself (cases 3, 4, 10); its JWT's RAR narrows it further.
path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "database/creds/finance-readonly" { capabilities = ["read"] }
