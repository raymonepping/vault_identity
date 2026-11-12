# Operations

Every operation is a `make` target; `make help` lists them all.

## Start, stop, check

| Situation | Command |
| --- | --- |
| First run | `make env-init`, put `VAULT_LICENSE` in `.env`, `make license && make lab` |
| Daily start, or the Lab Index's Start | `make up` (`RUNTIME=podman` is accepted; anything else stops) |
| Stop, or the Lab Index's Stop | `make down` (containers stop, volumes stay) |
| Five minutes before a talk | `make show-ready` |
| After a rehearsal or a show | `make stage-reset CONFIRM=yes` |
| Something looks wrong | `make doctor` (read-only; names the fix) |
| Full check | `make verify` (includes `make rehearsal`), `make test-ui` |

`make up` installs the licence from `.env` when it is missing (or stops with
the instruction), runs `make lab` on a lab that was never built, and
otherwise brings back vault-s, vault-1..3, PostgreSQL, the credentials
(re-minted only when invalid) and the app. It never asks a question: the Lab
Index runs it with stdin closed. Measured 2026-11-12: `make down` 8 s,
`make up` from stopped 26 s.

## Reset what a show changes

`make stage-reset CONFIRM=yes`: every `finance-readonly` lease is revoked
(the generated roles are dropped), the KV labels go back to
`config/cases.json`, and the API clears its evidence store and ingests from
that moment on. Vault's audit files and PostgreSQL's log are never edited.

## Tokens, keys and passwords

| What | File (0600) | Renewal |
| --- | --- | --- |
| Tool tokens `tf-*`, `ansible-*` | `.secrets/vault/tokens/` | periodic, renewed on every use |
| Seal tokens | `.secrets/vault/seal/vault-N` | `make seal-token-status`, `make seal-token-rotate NODE=` |
| Console token (`obs-console`) | `.secrets/vault/tokens/console` | periodic 24h, the API renews it hourly; `make people` re-mints an invalid one |
| Noor's password | `.secrets/people/noor` | created once; `make people-copy-password` copies, never prints |
| The workload's AppRole role id and secret id | `.secrets/approle/payments-batch/` | the secret id lives 30 days; `make people` (every `make up`) re-mints an invalid one |
| The lab issuer's key pair | `.secrets/issuer/` | created once by `make gen-certs`; the public key is in Vault's profile |
| PostgreSQL's bootstrap password | `.secrets/data/pg-bootstrap` | used once by Terraform, then rotated away (`make data`) |

## Bootstrap policies

`vault/policies/bootstrap/*.hcl` are written with the init root token, which
is then revoked. To change one: `make root-regen CLUSTER=vault`, then
`VID_ROOT_FILE=.secrets/vault/root-vault scripts/ansible.sh bootstrap`, then
`make root-revoke CLUSTER=vault`, and record the use in `docs/STATE.md`. On a
young lab with nothing to keep, `make clean-slate` and `make lab` do the
same without a root token.

## Backup and starting over

- `make backup`: Raft snapshots of vault-s and the cluster, a consistent copy
  of the evidence store, and the secrets, into `backups/<time>/`.
- `make clean-slate` (type DELETE): removes every `vid-` container and
  volume, moves credentials to `.secrets/legacy/<time>/`; keeps the CA, the
  issuer key, the licence and the images. Then `make lab`.

## Measuring Vault again

`make probe` runs 59 cases in a scratch namespace on the 4h probe token that
bootstrap mints, and rewrites `docs/capabilities.md`. After four hours the
probe token is gone: re-mint it with the root-regen cycle above.
