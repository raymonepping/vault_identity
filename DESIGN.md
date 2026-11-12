# DESIGN.md: vault_identity console

The Identity Observatory follows **Vault daylight glass**, the house system for
every Vault project (canonical implementation: Arcanium; contract: the
`vault-ui-design` skill). Light frosted panes, black ink, one dark ink hero per
page, strong status colours that hold WCAG AA. This file states only what
vault_identity adds or decides on top of it.

## Stack

- React 19 + Vite 8 + Tailwind v4 (`web/`), served by nginx over TLS 1.3 with
  the lab CA's listener certificate (`make gen-certs`).
- `web/src/styles/vault-glass.css` is the skill's file, unchanged;
  `shell.css` is vault_codex's copy. Shared layout in `app.css`; this
  console's own pieces (the chain, lanes, chips, cases, the access story) in
  `evidence.css`, tokens only.
- Fonts: Hanken Grotesk Variable and JetBrains Mono Variable via
  `@fontsource-variable`, bundled, no external requests. Mono only for
  identifiers: entity ids, paths, lease ids, database users, policy names.
- Icons: `lucide-react`. No emoji.
- CSP `style-src 'self'` and `script-src 'self'`: no inline styles or scripts.

## Observatory

- **An investigation, not a dashboard.** The memorable element is the
  **evidence chain**: five panes (Requested, Decided, Issued, Used, Ended),
  each with its evidence state and its source, joined by a line whose style
  says how strong the join is: solid green Confirmed, dashed blue
  Correlated, dotted amber Partial, a short red dash Unmatched, dotted grey
  Unknown, no line for a link the secret kind does not have.
- **Evidence states on the system's pills** (text on its own tint is AA):
  Confirmed healthy, Correlated approved, Partial pending, Unmatched
  rejected, Unknown manual. "Not applicable" is dim text, not a pill.
- **The hero carries the principals.** On an investigation the ink pane
  holds three lanes: who initiated, who executed (only when an agent acted for
  a person), and the target. Entity ids in mono under each name.
- **Configured beside recorded, never merged.** The decision panel lists what
  Vault recorded (outcome, error verbatim, granting policies, RAR, JWT id,
  purpose) above what was configured (baseline, ceiling, the RAR the issuer
  put in). A configured ceiling is not shown as evaluated unless Vault named
  it.
- **Declared and observed are labels.** Application events and labels carry an
  amber "declared" tag; facts from Vault and PostgreSQL say "observed".
- **Every fact opens its record.** The access story is a numbered sequence;
  each line opens the raw source record in a drawer, exactly as read.
- **Copy.** Plain verbs, sentence case, no all-caps eyebrows written by hand,
  no arrows on buttons. Negatives are exact ("no matching connection observed
  in this 60 s telemetry window"), never "never used".

## Pages

| Page | Route | Shows |
| --- | --- | --- |
| Overview | `#/overview` | The guiding question; the four questions of input/01.md (requesters, consumers, active credentials, what deserves a look) |
| Cases | `#/cases` | The ten cases grouped by how the caller proves who it is; Run sends only the case number |
| Investigation | `#/run/<id>` | Lanes, the chain, the decision panel, the access story, the raw record drawer; polls every 3 s until settled |
| Identities | `#/identities` | Entities, their doors (aliases), Agent Registry owner and ceiling, the AppRole role |
| Secrets | `#/secrets` | KV labels (declared), the database role, every credential issued with its sessions and lease state |
| Timeline | `#/timeline` | Every fact, newest first, filter by source, cursor paging |

## Verification

`make test-ui` (Playwright, 24 tests): axe WCAG 2.1 AA with zero violations
on every page at 1440x900 and 390x844 and on the signed-out form, TLS and
CSP, no KV value in any bundle or in `/api/cases`, a foreign-origin write and
a run with parameters refused, and cases 1, 6, 7 and 9 run from the UI with
the states the brief expects (case 9 waits out its window).
`make screenshots` refreshes `docs/screenshots/`.
