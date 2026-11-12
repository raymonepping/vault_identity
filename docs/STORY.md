# Who Used the Secret?

Corvid Ledger is a small, fictional finance company that closes its books
every month. Four principals touch two kinds of secret, and the lab asks the
same question each time: who requested the secret, which identity acted,
what Vault decided and issued, and what evidence shows it was used.

## Principals

| Principal | Kind | How Vault knows them |
| --- | --- | --- |
| Noor Haddad, finance analyst | human | userpass login; the same entity is the JWT subject `noor` when she delegates |
| Ledger agent, nightly reconciliation bot | autonomous AI agent | JWT from the lab issuer, registered in the Agent Registry |
| Finance agent, Noor's assistant | agent acting on behalf of Noor | delegation JWT: subject Noor, actor the finance agent; registered with a ceiling |
| payments-batch, a settlement job | workload | AppRole with secret id metadata |

## Secrets

- `kv/finance/reconciliation-api`: a static API key (KV v2) with descriptive
  labels in `custom_metadata`.
- `kv/finance/payroll-export`: restricted; Noor may read it, the finance
  agent's ceiling does not allow it.
- `database/creds/finance-readonly`: a dynamic PostgreSQL credential with a
  lease.

## The ten cases

1. Noor reads the reconciliation API key.
2. Noor requests database credentials and runs a query.
3. The ledger agent reads the API key on its own.
4. The ledger agent requests database credentials and reconciles.
5. Noor delegates the API key read to the finance agent.
6. Noor delegates the monthly reconciliation to the finance agent.
7. Noor delegates the payroll export to the finance agent: the ceiling says no.
8. The finance agent asks for database credentials with a token scoped to
   the API key: the RAR says no.
9. payments-batch requests credentials and never connects.
10. A session outlives its revoked credential.

## What the lab proves, and what it only illustrates

Proves: Vault records who requested and what it decided, and for an agent
acting on behalf of a person it records both; PostgreSQL records who
connected; joining the two by stable identifiers shows who used a
credential, and the console says how strong each join is.

Illustrates only: the API runs every principal for one presenter; the lab's
own issuer stands in for an enterprise identity provider; Corvid Ledger is
fiction; one Mac is not production.
