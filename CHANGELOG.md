# Changelog

## 0.1.0 (2026-11-12)

- A seal Vault and a three-node Vault Enterprise 2.2.1 Raft cluster with
  Transit auto-unseal, scoped tool tokens and no root token after bootstrap.
- Namespace `observatory`: userpass, AppRole, KV v2 with labels, the
  database engine for PostgreSQL 17 (`finance-readonly`, root rotated away);
  two audit devices; the username of an issued credential in clear by
  design.
- Agentic IAM: the lab's own OAuth issuer (ES256), the profile
  `corvid-issuer`, two agents in the Agent Registry, on-behalf-of delegation
  bounded by Noor's baseline, the finance agent's ceiling and the RAR.
- The Identity Observatory (Node 24 API with `pg` and `node:sqlite`, React
  19, Vault daylight glass): ten cases, the evidence chain with five states,
  the decision panel, identities, secrets, a timeline of every fact.
- `make probe` (59 cases), `make rehearsal` (55), `make verify` (76),
  `make boundary` (62), `make test-ui` (24 with axe), 53 unit tests.
- `make up` and `make down` work from the Lab Index (`RUNTIME=podman`); `make
  up` builds the lab on its first run.
