# Security model

What protects what, and the check that proves it. Every boundary below is
enforced by Vault or by the operating system; the API never decides access.

## Trust boundaries

| Boundary | Enforced by | Proved by |
| --- | --- | --- |
| No root token after bootstrap | init root revoked by Ansible | `make verify` (vault section) |
| Each tool token does its own job only (`tf-*`, `ansible-*`) | bootstrap policies; none may rewrite its own `vid-*` policy | `make boundary` (tool rows) |
| Noor reads the two KV secrets and gets database credentials; not the metadata endpoint, not a revoke | `obs-noor` on her entity | `make boundary`, `ansible validate` |
| An agent acts as itself only when registered, with RAR in its token | Agent Registry, the profile (RAR required) | rehearsal C3, C4, J1, J4; probe P9, P10 |
| An agent acting for Noor gets at most her baseline ∩ its ceiling ∩ the RAR | Vault's OBO evaluation | rehearsal C6 to C8 (`CEILING_POLICY_DENIED`, `RAR_NO_MATCH`) |
| A JWT for another audience, expired, or without a matching alias is refused | the profile | rehearsal J1 to J3 |
| The console token reads identity and configuration, looks up leases, revokes `finance-readonly` leases only; never a value or a credential | `obs-console` (`allowed_parameters` on the revoke) | `make boundary`, rehearsal N6 to N8 |
| Only Noor signs in to the console; a run takes no parameters; writes from another site are refused | `api/lib/session.js`, `server.js` | rehearsal N1 to N5, `make test-ui` |
| The database root password is known only to Vault | `rotate-root` | `make verify` (data section) |
| Generated database passwords and every session travel over TLS 1.3 | PostgreSQL `ssl=on`, `pg_hba.conf` (`hostssl` only), Vault `sslmode=verify-full`, the API's verified TLS | `make verify` (a plain connection is refused), rehearsal C2 (the session's log line names TLSv1.3) |
| The API has no door of its own | not published; only nginx (TLS 1.3) reaches it | `make verify` (`podman port vid-api` is empty) |
| A copied AppRole secret id stops working | `secret_id_ttl` 30 days; `make people` mints a new one | `terraform/vault-platform/auth.tf` |

## The stage-hand shortcut (D11)

One presenter runs every principal from the console. Noor signs in with her
own password; the agents and the workload act inside the API with their own
credentials: the lab issuer's key for the agents' JWTs, the AppRole secret
id for payments-batch. Vault sees four distinct identities, and the console
labels whose credential made each call. In production each principal runs in
its own process with its own credential; nothing here suggests otherwise.

## The lab's issuer (D12)

`api/lib/issuer.js` signs ES256 access tokens (5 minutes, a random `jti`)
with `.secrets/issuer/signing.pem`; Vault's profile `corvid-issuer` trusts
the public key in static mode. It stands in for an enterprise identity
provider. It has no endpoint of its own: subjects, actors and RAR come only
from `config/cases.json`, and a delegation (`sub` Noor, `act.sub` the finance
agent) is minted only while Noor's own session is signed in, checked against
her entity id. Whoever holds the key can mint any of the configured
identities; it is 0600 and mounted read-only into the API only.

## The audit log keeps its HMAC (D10)

Every string in the audit log is HMAC'd except three deliberate exceptions:
the generated database username (`audit_non_hmac_response_keys`, an
identifier that joins issuance to PostgreSQL's log; the password stays
HMAC'd), and the headers `X-Correlation-Id` (audited by default) and
`X-Observatory-Purpose` (a short governed code, never free text). Lease ids
are in clear by Vault's design. KV labels stay HMAC'd in the audit log; the
console reads them from the metadata endpoint.

## What the evidence store holds

Source records as read (already HMAC'd by Vault, or PostgreSQL's connection
log lines), normalized facts, runs. Never a secret value, token, JWT,
password or private key: unit-tested (`api/test/cases.test.js`) and checked
against the live stack (rehearsal S1 to S3). PostgreSQL logs connections, not
statements, because `CREATE ROLE ... PASSWORD` would land in its log.

## What is synthetic

Corvid Ledger, Noor Haddad, the agents, the ledger rows, the API key
(`corvid-recon-demo-key-0001`) and the payroll file name are invented.
Passwords, the issuer key, the secret id and tokens are generated per lab in
`.secrets/` and never committed.
