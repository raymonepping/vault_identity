# Architecture

> **Terraform builds the house. Ansible decorates it. Vault keeps the keys.
> Make is the front door.**

## Topology

```text
network vid-internal                              every Vault listener: TLS 1.3, lab CA
 ├─ seal:  vault-s (Shamir 1/1, Raft) ── Transit key for auto-unseal
 ├─ vault: vault-1..3 (Raft, seal "transit"), two audit devices per node:
 │         file /vault/audit/audit.log (a volume per node) and stdout
 │         namespace observatory/: userpass/, approle/, kv/, database/,
 │           OAuth profile corvid-issuer, Agent Registry (2 agents), obs-* policies
 ├─ data:  postgres 17.11 (database finance, TLS 1.3 only on the network),
 │         jsonlog connection log in vid-pg_log
 ├─ app:   api (Node 24, not published) │ web (nginx + React, TLS :14001, proxies /api)
 ├─ Terraform: vault-seal (tf-seal) │ vault-platform (tf-platform)
 └─ Ansible:   localhost → Vault HTTPS API (ansible-seal, ansible-platform);
               the schema through `podman exec` as the postgres OS user
```

## The evidence path

```text
 principal ──credential──▶ Vault ──audit──▶ /vault/audit/audit.log (3 nodes)
    │                        │                        │
    │                    issues a                     ▼
    │                    credential          api: collector ──▶ evidence store
    │                        │                  ▲     ▲            (node:sqlite)
    └──connects as v-...──▶ PostgreSQL ──jsonlog┘     │                 │
                                                lease lookups      correlate (R1..R5)
                                                                        │
                                                       console ◀── investigation
```

1. **The case runner** (`api/lib/cases.js`) acts with the principal's own
   credential: Noor's session token (userpass), a JWT from the lab issuer for
   an agent (`sub` the agent, or `sub` Noor and `act.sub` the agent), or an
   AppRole login for the workload. Every call carries `X-Correlation-Id`
   (`run-<case>-<8 hex>`) and the case's purpose code
   (`X-Observatory-Purpose`); every PostgreSQL session sets
   `application_name=<principal>:<8 hex>`.
2. **Vault decides** and writes request and response entries to both audit
   devices on the node that served the request.
3. **The collector** (`api/lib/collector.js`) reads the three audit files and
   PostgreSQL's jsonlog every second, keeps the raw record unchanged
   (`raw_event`) and normalized facts (`fact`), and looks up open leases every
   ten seconds.
4. **The chain** (`api/lib/correlate.js`) is derived from the facts on every
   read: Requested, Decided, Issued, Used, Ended, each with a state, the rule
   that joined it and the facts it rests on
   ([evidence-model.md](evidence-model.md)).

## Phases

`scripts/phases.txt` is the only list: seal-up, seal-init, vault-seal,
seal-tokens, vault-up, bootstrap, data-up, vault-platform, data, people,
stage, app-up, validate. `make lab` walks it, then the gates: idempotency,
drift, secret-scan, boundary.

## Identity

| Principal | Entity | Doors (aliases) | Policies on the entity | Registry |
| --- | --- | --- | --- | --- |
| Noor | `noor` | `userpass/noor`, profile `corvid-issuer` external id `noor` | `obs-noor` | none |
| Ledger agent | `ledger-agent` | profile, `agent:ledger-agent` | `obs-ledger-agent` | owner finance-platform, ceiling defaults only |
| Finance agent | `finance-agent` | profile, `agent:finance-agent` | `obs-finance-agent` (not evaluated for OBO) | ceiling `obs-finance-ceiling` |
| payments-batch | made by its AppRole login | `approle/<role id>` | none; `obs-payments-batch` on its token | none |

An OBO request is allowed only when Noor's baseline, the finance agent's
ceiling and the token's RAR all allow it.
