# State

What was built, deferred and learned per build prompt. Read this first.

## Prompt 01: Foundation (2026-11-12)

- Copied from `../vault_governor` git HEAD (`git archive`, not its working
  tree), renamed `vgov`→`vid`, ports 19400→19500 and 13900→14000. Removed
  what this lab does not use: SCIM (`roster.*`, `api/lib/scim.js`),
  Sentinel, control groups, Transit, the chapters and their pages and
  tests, `story-check`, `config/{roster,story}.json`, governor's docs and
  screenshots. Removed the scaffold's `main.tf`, `FOLDER_TREE.md`,
  `sanity_check.md`, `.dockerignore` (replaced by `.containerignore`).
- `config/cases.json`: the ten cases and four principals; validated by
  `scripts/cases-check.js` (5 unit tests).
- `make gen-certs` also creates the lab issuer's ES256 key pair in
  `.secrets/issuer/` (D12), once.
- Tool versions: Terraform 1.14.2, ansible-core 2.21.3, Node 25.2.1 on the
  host (containers run Node 24), Podman 6.1.4, jq 1.8.2, shellcheck 0.11.0,
  gitleaks 8.30.1.

## Prompt 02: Seal, cluster, data stack (2026-11-12)

- Phases seal-up 9 s, seal-init 16 s, vault-seal 4 s, seal-tokens 5 s,
  vault-up 4 s, bootstrap 30 s, data-up about 20 s. Restart (`vault-down`,
  `vault-up`) 29 s. `make boundary`: 40 tool checks pass.
- Bootstrap policies rewritten for namespace `observatory` (D7): tf-platform
  owns audit devices, audited headers, mounts, auth, policies `obs-*`,
  identity, the OAuth profile and the Agent Registry; ansible-platform owns
  rotate-root, Noor's user, the AppRole secret id, the console token, KV
  values and labels, and `revoke-prefix` for the stage reset.
- `compose/data`: `vid-postgres` (17.11), local socket peer auth, network
  scram, jsonlog to volume `vid-pg_log`. Learned: an init container with
  `cap_drop: ALL` did not prepare the log volume (the first start then died
  on `could not open log file ... Permission denied` and left a data volume
  without the `finance` database); the postgres entrypoint, still root, now
  chowns the log directory itself. The healthcheck runs `pg_isready` as the
  postgres OS user (`gosu`), else peer auth logs a FATAL every interval.

## Prompt 03: Probe (2026-11-12)

- `make probe`: 58 of 58 in 65 s, `docs/capabilities.md`. Signer
  `api/lib/jwt.js` (shared with the API's issuer), `scripts/probe-jwt.js`.
- Design changes from the answers (brief updated): case 10 shows a session
  that stays connected without privileges (REVOKE + DROP ROLE), not one that
  keeps working; the decision panel shows `granting_policies` as recorded
  evidence; the collector reads `application_name` from the
  `connection authorized` message (no field) and from the `disconnection`
  line; expiry is inferred from the lease's `expire_time` and lookup, never
  from an audit event (there is none).

## Prompt 04: Platform, data, people, stage, `make lab` (2026-11-12)

- Terraform `vault-platform`: two audit devices (file + stdout), audited
  header `X-Observatory-Purpose`, namespace, userpass, AppRole role
  `payments-batch`, token role `obs-console`, KV v2, database (connection
  `finance` with `password_wo`, role `finance-readonly`, username not
  HMAC'd), six `obs-*` policies, three entities, Noor's userpass alias,
  three profile aliases (synthetic accessor), profile `corvid-issuer`
  (static ES256 key), two Agent Registry records. Plan empty after apply.
- Learned: `sys/config/oauth-resource-server/*` needs `sudo`, also to read
  (403 without it; measured in a scratch namespace). The bootstrap policy
  could not be widened after root revocation, so the lab was rebuilt from
  nothing (`make clean-slate`, no root-regen): 83 s to vault-platform.
- Ansible: `data` (rotate-root once, marker file; schema and six synthetic
  rows via peer auth), `people` (Noor's password, AppRole role id and a
  secret id with metadata, console token), `stage` (KV values once, labels
  from `config/cases.json`), `validate` (15 checks), `stage-reset` (revoke
  every finance-readonly lease). All second runs `changed=0`.
- `make boundary` 62 checks (tool, Noor, payments-batch, console).
  `make lab` on a built lab: 61 s, gates green. Removed governor's Layers
  (`scripts/layers.sh`): this console has no Layers page.

## Prompt 05: API (2026-11-12)

- Node 24, one dependency `pg` 8.23.1. `lib/store.js` (`node:sqlite`, WAL,
  raw_event insert-only and UNIQUE by source id, facts point at their raw
  row, runs, cursors), `lib/normalize.js` (audit entry or jsonlog line to
  facts; only probe-found fields; the flow from what Vault recorded, never a
  display name), `lib/collector.js` (three audit files and the jsonlog every
  second, replay-safe offsets, truncation, half lines; lease lookups every
  tenth cycle, one record per state), `lib/correlate.js` (the chain, rules
  R1 to R5, five states plus n/a, pure), `lib/issuer.js` + `lib/jwt.js`
  (ES256 with node:crypto), `lib/cases.js` (each principal's own
  credential, one run at a time, correlation id and purpose on every call,
  passwords in memory only), `server.js` (13 routes, all but healthz behind
  Noor's session; a run takes no body). 48 unit tests.
- Correlations are derived on read, not stored (deviation from the brief's
  `link` table): a rule change never leaves stale links. The reset is
  `podman exec vid-api node scripts/reset.js`, not an HTTP route.
- Learned: an entity alias bound to the profile by `mount_accessor` is
  accepted but never authenticates a JWT (403, no auth in the audit entry);
  bound by `profile_name` + `external_id` it works. Terraform now writes
  profile aliases with `vault_generic_endpoint` (probe P10 added). Revoking
  an AppRole token revokes the leases it created, so the runner lets the
  workload's token expire (case 9 shows an unused credential). A lease issued
  to a JWT caller is capped at the JWT's expiry (5 min, not the role's 600 s).
  A run's last response may be its revoke: the chain picks the response on
  the secret path (`secretResponse`, tested).

## Prompt 06: Console (2026-11-12)

- Six pages (Overview, Cases, Investigation, Identities, Secrets, Timeline)
  on governor's shell and glass CSS; `evidence.css` holds the chain, lanes,
  chips. DESIGN.md rewritten. `make test-ui`: 24 passed (axe 0 on every page,
  desktop and phone, and signed out; cases 1, 6, 7, 9 from the UI).
  Screenshots in `docs/screenshots/` reviewed: brand shortened to
  "Observatory", the after-revoke notice amber, the responder named in the
  story, the verdict mentions a revoke.

## Prompt 07: Rehearsal and daily operations (2026-11-12)

- `make rehearsal`: 55 checks in 69 s: all ten cases with their Vault answer
  and chain states, both principals of an OBO request and the granting
  policies, the ceiling and RAR codes, the after-revoke refusals, the unused
  credential going Unmatched after its 60 s window, the JWT lease cap; the
  refusals (no session, a run with parameters, a foreign origin, an agent
  signing in, the console token on values, credentials and other leases,
  four JWTs Vault must refuse, signed with the lab key); no password, JWT or
  KV value in any answer, log or image.
- `make verify`: 76 passed, 0 failed in 151 s (sections podman, vault,
  units, platform, stage, data, app, console, boundary, drift, idempotency,
  secrets, rehearsal).
- `make down` 8 s (0 running, volumes kept), `make up RUNTIME=podman` 26 s
  from stopped (clock, vault, data, credentials kept, app). `make doctor`
  rewritten for this lab: nothing wrong. `make backup` adds the evidence
  store (VACUUM INTO inside the API).

## Prompt 08: The Lab Index, end to end (2026-11-12)

`../vault_lab_index` unchanged; its portal `vlix-ui` was running. A refresh
lists vault_identity as **eligible**, prefix `vid-` (source `lab`, from
`.claude/CLAUDE.md`), status `running`; the card shows the README's title
"vault_identity: Who Used the Secret?" and its first paragraph. Through the
dashboard's own buttons (Playwright): **Stop** with its confirmation, then
`stopped` after **8 s** (0 running, 12 `vid-` volumes kept); **Start** ran
`make up RUNTIME=podman`, `running` after **30 s**, operation `up`
`succeeded`, exit 0. A run made before a `make down && make up` is still in
the evidence store afterwards (its chain intact). Screenshots:
`docs/screenshots/lab-index-running.png`, `-stopped.png`, `-started.png`.
No other lab was started or stopped.

## Prompt 09: Docs, public readiness and the final run (2026-11-12)

- README (the Lab Index card now reads "vault_identity: Who Used the
  Secret?"), `docs/architecture.md`, `docs/operations.md`,
  `docs/security-model.md`, `docs/evidence-model.md` (input/03's contract as
  built: sources, join fields, rules R1 to R5, states, gaps),
  `docs/ownership.md`, `CHANGELOG.md`, `CONTRIBUTING.md`; CI runs
  `cases-check` and installs the API's `pg`; Dependabot covers `api/` too.
  markdownlint clean (the generated `capabilities.md` disables the rules its
  verbatim quotes break; tabs in quotes become spaces).
- Removed governor's unused CSS (19 rules). The probe now also measures an
  unregistered subject with a correct alias: 400 "OAuth credentials require
  the entity to have an agent registration" (59 cases).
- Public readiness: the private set is ignored (`git check-ignore`), gitleaks
  finds nothing in the files to commit (one false positive allowlisted as in
  vault_pipeline: `password_authentication = "scram-sha-256"`), no private
  path or e-mail.
- Final runs: from a stopped stack `make down` 18 s, `make up` 31 s,
  `make verify` 76/0 (162 s), `make test-ui` 24/0 (92 s). From nothing
  (`make clean-slate`, no root token): `make lab` 140 s, `make verify` 76/0
  (154 s).

## Prompt 99: clean round 1 (2026-11-12)

Committed the build first (`a1b193f`). Reviews: ponytail audit (whole repo),
the performance pass the user asked for (measured), ponytail review (the
build commit), backend audit (`api/`), security pass. 22 findings, all
fixed:

- 1: AppRole secret id never expired: `secret_id_ttl` 30 days.
- 2: The console at `https://127.0.0.1:14001` refused every write: both loopback
  origins accepted (`CONSOLE_URL` list; tested).
- 3: The run-facts join had no unit test: moved to `store.runFacts`, tested.
- 4: Dead `StatePill`. 5. Stale rate-limiter comment and default.
- 6: Mixed timestamp precision sorted wrong: facts keep milliseconds (tested).
- 7: The investigation page fetched `/api/session` with no run: split into
  `RunView`. 8. Reset printed node:sqlite's warning. 9. Internal exports.
- 10 to 13: Measured with a scratch store: 3 queries per credential took 655
  ms at 10,000 runs; now `store.credentials()` (4 queries),
  `latestRuns()`, an index on `fact(kind, at)`, the last login by `LIMIT 1`,
  secret responses filtered in SQL. Limit stated in a `shortcut:` comment.
- 14: A KV investigation said "version 21" (digits of "v2" and "1"): parsed
  with `/version (\d+)/`; the e2e test now checks the hero text.
- 15: A hung PostgreSQL query would block every later run: `query_timeout`.
- 16: Unused `write_fields`. 17. "after null s" in the story.
- 18: A run cut off by a restart said "running" forever: marked
  `interrupted` at startup (tested).
- 19: Refused console-token reads vanished: logged once per path and status.
- 20: The run id is in the API's log line.
- 21: Vault sent generated passwords to PostgreSQL in clear: TLS 1.3 with the
  lab certificate, `pg_hba.conf` accepts the network only over TLS, Vault
  `sslmode=verify-full`, the API verifies; the connect line's protocol is
  evidence ("over TLSv1.3"). Rebuilt from nothing (the connection holds the
  rotated root password): `make lab` 142 s.
- 22: The API answered on plain HTTP: no longer published; health checks go
  through the console's TLS.

Results: unit tests 52 (API) + 5, `make probe` 59/59, `make verify` 79/0
(165 s), `make test-ui` 24/0, rehearsal 56 (inside verify).

## Prompt 99: clean round 2 (2026-11-12)

Committed round 1 (`c9c2c1c`). The four reviews on the round-1 state found
three, all fixed:

- 23: The e2e setup took any answer from `/api/healthz` as healthy; with the
  API stopped, nginx answers 502 (measured). `served()` returns the status;
  setup requires 200.
- 24: `Date.parse(since() || 0)` parsed `0` as the year 2000; now no ingest
  boundary means nothing is skipped.
- 25: `npm run dev` could not run a case: the dev server's own origin is
  refused by the API's cross-site check. No make target used it: the dev
  server config and the `dev` and `preview` scripts are gone.

Results: `make verify` 79/0 (162 s), `make test-ui` 24/0, unit tests 52 + 5.
