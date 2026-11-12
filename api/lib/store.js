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
        q.insFact.run(r.id, kind, fat, correlation_id, vault_request_id, lease_id, db_user, JSON.stringify(data));
      }
      return true;
    },
    cursor: (source) => q.getCursor.get(source) || null,
    setCursor: (source, ino, offset) => q.setCursor.run(source, String(ino), offset),
    meta: (key) => q.getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => q.setMeta.run(key, String(value)),
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
    runs() {
      return db.prepare('SELECT * FROM run ORDER BY started_at DESC').all().map((r) => ({ ...r, steps: JSON.parse(r.steps) }));
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
