# Evidence model

The contract of `input/03.md` as built: what each source proves, how two
sources are joined, and how strong each join is. A Vault decision is never
simulated, and missing evidence never becomes a match.

## Sources

| Source | Read from | Proves | Does not prove |
| --- | --- | --- | --- |
| Vault audit (request and response) | `/vault/audit/audit.log` on each node | who Vault resolved (entity, flow, for OBO the actor), what was asked, what Vault decided and issued | that the caller is the person a display name suggests; that a secret was used |
| PostgreSQL jsonlog | `vid-pg_log` | that a generated user connected, was refused, disconnected | which Vault request produced the user, on its own |
| Application events | written by the case runner | that the application says it used a value (declared) | that the downstream call happened as described |
| Lease lookups | `sys/leases/lookup` with the console token | that Vault still holds the lease, or no longer does | why it ended, on its own; Vault writes no audit entry for an expiry |
| KV labels | `kv/metadata`, `custom_metadata` | what the owner declared about the secret | who used it or why |

## Fields used for joins (measured, docs/capabilities.md)

- `request.id`: shared by an audit request and its response (R1).
- `auth.entity_id` is the subject; `auth.metadata.actor_entity_id` and
  `actor_entity_name` the agent in an OBO request (P18).
- `request.headers["x-correlation-id"]`: the run (audited by default, P20).
- `response.data.username`: the generated database user, in clear by
  `audit_non_hmac_response_keys` (P22); PostgreSQL's `user` field.
- `response.secret.lease_id`: in clear (P22).
- PostgreSQL's `connection authorized` line has no `application_name` field;
  the collector reads it from the message. The `disconnection` line has it
  (P23).

## Rules

| Rule | Join | State it gives |
| --- | --- | --- |
| R1 | audit request and response share `request.id` | Confirmed |
| R2 | the generated username equals the PostgreSQL user, connection after issuance (5 s skew allowed) | Correlated |
| R3 | the run's correlation id in the audit entry, the application event, or `application_name` | Correlated |
| R4 | `sys/leases/lookup` for the lease id | Confirmed (ended or active) |
| R5 | no PostgreSQL connection for the username within `VID_CONSUMPTION_WINDOW` (60 s) | Unmatched |

## States

| State | Meaning |
| --- | --- |
| Confirmed | a direct, tested join |
| Correlated | independent sources match on a stable identifier; the rule is shown |
| Partial | a relevant event exists but a link is missing, or the window is still open |
| Unmatched | the window passed and no source shows a match: "no matching connection observed in this 60 s telemetry window", never "never used" |
| Unknown | the source could not be read |
| not applicable | the secret kind has no such link (a KV read issues no lease) |

## Declared and observed

Purpose codes, KV labels, entity metadata and application events are
**declared**. Audit entries, PostgreSQL log lines and lease lookups are
**observed**. Only a separately governed approval record could show that a
declared purpose was approved; this lab has none and says so.

## Gaps the lab shows instead of filling

- A KV read has no downstream proof of use unless an application reports it
  (case 1 stays Partial).
- Vault writes no audit entry when a lease expires; the end is inferred from
  `expire_time` and a lookup that answers `invalid lease`.
- A revoke drops the role and its privileges; an open session stays
  connected until it disconnects (case 10).
- A lease issued to a JWT caller ends with the JWT (5 minutes), not the
  role's TTL.
