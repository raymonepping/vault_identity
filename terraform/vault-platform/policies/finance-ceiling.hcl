# obs-finance-ceiling: the most the finance agent may do on anyone's behalf
# (its Agent Registry ceiling). No payroll export.
path "kv/data/finance/reconciliation-api" { capabilities = ["read"] }
path "database/creds/finance-readonly" { capabilities = ["read"] }
