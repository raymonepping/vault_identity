# obs-finance-agent: the finance agent's own policy. Vault does not evaluate an
# agent's own policies for on-behalf-of requests (Agent Registry docs): it may
# read the payroll export here, and case 7 still ends in CEILING_POLICY_DENIED.
path "kv/data/finance/payroll-export" { capabilities = ["read"] }
