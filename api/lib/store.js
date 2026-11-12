// lib/store.js: the evidence store (D15), node:sqlite, one file on the
// vid-evidence volume. raw_event is insert-only: the source record exactly as
// read, with its source id and times. fact holds the normalized fields
// (lib/normalize.js) and always points at its raw event. Correlations are not
// stored: lib/correlate.js derives them from facts on every read, so a rule
// change never leaves stale links behind. No column ever holds a secret value,
// token, JWT, password or private key (test/redaction.test.js).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw_event (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (source, source_event_id)
);
CREATE TABLE IF NOT EXISTS fact (
  id INTEGER PRIMARY KEY,
  raw_id INTEGER NOT NULL REFERENCES raw_event(id),
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  correlation_id TEXT,
  vault_request_id TEXT,
  lease_id TEXT,
  db_user TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fact_corr ON fact (correlation_id);
CREATE INDEX IF NOT EXISTS fact_lease ON fact (lease_id);
CREATE INDEX IF NOT EXISTS fact_user ON fact (db_user);
CREATE INDEX IF NOT EXISTS fact_req ON fact (vault_request_id);
CREATE INDEX IF NOT EXISTS fact_kind ON fact (kind, at);
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY,
  case_id INTEGER NOT NULL,
  principal TEXT NOT NULL,
  correlation_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  steps TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS cursor (
  source TEXT PRIMARY KEY,
  ino TEXT NOT NULL,
  offset INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// shortcut: one SQLite file on the event loop, sized for one presenter; every
// query stays under 30 ms up to 10,000 runs (measured 2026-11-12, clean round
// 1). The store is reset per show; past that size, archive runs first.
export function openStore(file = process.env.EVIDENCE_DB || '/data/evidence.db') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const q = {
    insRaw: db.prepare(`INSERT OR IGNORE INTO raw_event (source, source_event_id, source_timestamp, ingested_at, body)
      VALUES (?, ?, ?, ?, ?) RETURNING id`),
    insFact: db.prepare(`INSERT INTO fact (raw_id, kind, at, correlation_id, vault_request_id, lease_id, db_user, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getCursor: db.prepare('SELECT ino, offset FROM cursor WHERE source = ?'),
    setCursor: db.prepare(`INSERT INTO cursor (source, ino, offset) VALUES (?, ?, ?)
      ON CONFLICT (source) DO UPDATE SET ino = excluded.ino, offset = excluded.offset`),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
  };
  const row = (f) => (f ? { ...f, data: JSON.parse(f.data) } : f);
  // Vault writes 9 fraction digits, PostgreSQL 3: facts keep milliseconds, so
  // text order is time order (equal times fall back to the insert order, id).
  const ms = (t) => new Date(t).toISOString();
  const SECRET_PATH = "(json_extract(data, '$.path') LIKE 'kv/data/%' OR json_extract(data, '$.path') LIKE 'database/creds/%')";

  // Run fn inside one transaction (the cursor moves with the rows it read).
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return {
    db,
    tx,
    // add({source, id, at, body, facts: [{kind, at, correlation_id, ...data}]}) -> true when new
    add({ source, id, at, body, facts = [] }) {
      const r = q.insRaw.get(source, id, at, new Date().toISOString(), typeof body === 'string' ? body : JSON.stringify(body));
      if (!r) return false; // seen before: replay-safe
      for (const f of facts) {
        const { kind, at: fat = at, correlation_id = null, vault_request_id = null, lease_id = null, db_user = null, ...data } = f;
        q.insFact.run(r.id, kind, ms(fat), correlation_id, vault_request_id, lease_id, db_user, JSON.stringify(data));
      }
      return true;
    },
    cursor: (source) => q.getCursor.get(source) || null,
    setCursor: (source, ino, offset) => q.setCursor.run(source, String(ino), offset),
    meta: (key) => q.getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => q.setMeta.run(key, String(value)),
    // sql is always a constant from this codebase; values go in args.
    factsWhere(sql, ...args) {
      return db.prepare(`SELECT * FROM fact WHERE ${sql} ORDER BY at, id`).all(...args).map(row);
    },
    raw: (id) => db.prepare('SELECT id, source, source_event_id, source_timestamp, ingested_at, body FROM raw_event WHERE id = ?').get(id) || null,
    timeline({ before = null, kinds = null, limit = 100 } = {}) {
      const where = [];
      const args = [];
      if (before) { where.push('id < ?'); args.push(before); }
      if (kinds?.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
      const sql = `SELECT * FROM fact ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
      return db.prepare(sql).all(...args, limit).map(row);
    },
    saveRun(r) {
      db.prepare(`INSERT INTO run (id, case_id, principal, correlation_id, started_at, finished_at, outcome, steps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET finished_at = excluded.finished_at,
        outcome = excluded.outcome, steps = excluded.steps`).run(r.id, r.case_id, r.principal, r.correlation_id,
        r.started_at, r.finished_at ?? null, r.outcome ?? null, JSON.stringify(r.steps ?? []));
    },
    run(id) {
      const r = db.prepare('SELECT * FROM run WHERE id = ?').get(id);
      return r ? { ...r, steps: JSON.parse(r.steps) } : null;
    },
    // The latest run of each case, without its steps (the Cases page).
    latestRuns() {
      return db.prepare(`SELECT id, case_id, principal, correlation_id, started_at, finished_at, outcome FROM run r
        WHERE started_at = (SELECT MAX(started_at) FROM run x WHERE x.case_id = r.case_id)`).all();
    },
    // A run the API did not finish (it stopped mid-run) must not say "running".
    markInterrupted(now = new Date().toISOString()) {
      return db.prepare("UPDATE run SET finished_at = ?, outcome = 'interrupted' WHERE finished_at IS NULL").run(now).changes;
    },
    // Facts that belong to one run: its own (correlation id), then the
    // PostgreSQL lines of the user it was issued and its lease lookups, then
    // the subject's last login before the run ended (a person or workload).
    runFacts(run, secretResponse) {
      const own = this.factsWhere('correlation_id = ?', run.correlation_id);
      const resp = secretResponse(own, run.correlation_id);
      const more = [];
      if (resp?.db_user) more.push(...this.factsWhere("kind LIKE 'pg.%' AND db_user = ?", resp.db_user));
      if (resp?.lease_id) more.push(...this.factsWhere("kind LIKE 'lease.%' AND lease_id = ?", resp.lease_id));
      if (resp?.data.entity_id && ['human', 'workload'].includes(resp.data.flow)) {
        const login = db.prepare(`SELECT * FROM fact WHERE kind = 'vault.response' AND at <= ?
          AND json_extract(data, '$.login_entity') = ? ORDER BY at DESC, id DESC LIMIT 1`).get(ms(run.finished_at || Date.now()), resp.data.entity_id);
        if (login) more.push(row(login));
      }
      const seen = new Set();
      return [...own, ...more].filter((f) => !seen.has(f.id) && seen.add(f.id)).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    },
    // Responses to secret requests (not logins, not revokes), oldest first.
    secretResponses() {
      return this.factsWhere(`kind = 'vault.response' AND ${SECRET_PATH}`);
    },
    // Every credential issued, with its lease state and sessions: four
    // queries, not three per credential (measured: 655 ms at 10,000 runs before).
    credentials() {
      const ended = new Set(db.prepare("SELECT lease_id FROM fact WHERE kind = 'lease.ended'").all().map((r) => r.lease_id));
      const active = new Map(db.prepare("SELECT lease_id, data FROM fact WHERE kind = 'lease.active' ORDER BY at, id").all().map((r) => [r.lease_id, JSON.parse(r.data)]));
      const sessions = new Map(db.prepare("SELECT db_user, COUNT(*) AS n FROM fact WHERE kind = 'pg.connect' GROUP BY db_user").all().map((r) => [r.db_user, r.n]));
      return this.factsWhere(`kind = 'vault.response' AND lease_id IS NOT NULL AND ${SECRET_PATH}`).map((f) => ({
        fact: f, ended: ended.has(f.lease_id), active: active.get(f.lease_id) || null, sessions: sessions.get(f.db_user) || 0,
      }));
    },
    // The stage reset (D20): forget everything, ingest from now on. The
    // cursors stay, so old audit lines are not read again.
    reset(now = new Date().toISOString()) {
      tx(() => {
        db.exec('DELETE FROM fact; DELETE FROM raw_event; DELETE FROM run;');
        q.setMeta.run('ingest_since', now);
      });
    },
    close: () => db.close(),
  };
}
