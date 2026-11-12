# obs-noor: Noor's baseline (on her entity, so both her doors carry it: the
# userpass login and the JWT subject of a delegation). It is the first bound
# of every OBO request she makes through an agent.
path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "kv/data/finance/payroll-export" { capabilities = ["read"] }
path "database/creds/finance-readonly" { capabilities = ["read"] }
