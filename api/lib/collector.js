// lib/collector.js: reads the evidence sources into the store, once a second.
//   - three Vault audit files (one per node; the node that served a request
//     wrote it), read-only volumes
//   - PostgreSQL's jsonlog, read-only volume
//   - lease lookups for credentials the store saw issued and not yet ended
// Replay-safe: rows are UNIQUE by source id and each file's offset moves in the
// same transaction as the rows read from it. A file that shrank or changed
// inode is read again from 0. Half a line at the end waits for its newline.
// A source that cannot be read is reported as unreadable (the UI then says
// Unknown, never Unmatched).
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { fromAudit, fromPg } from './normalize.js';

const CHUNK = 1 << 20;

// readNew(file, cursor) -> { ino, offset, lines } with complete lines only.
export function readNew(file, cursor) {
  const fd = openSync(file, 'r');
  try {
    const st = fstatSync(fd);
    let offset = cursor && String(cursor.ino) === String(st.ino) && cursor.offset <= st.size ? cursor.offset : 0;
    const lines = [];
    while (offset < st.size) {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - offset));
      const n = readSync(fd, buf, 0, buf.length, offset);
      const end = buf.lastIndexOf(0x0a, n - 1);
      if (end < 0) {
        if (n === CHUNK) throw new Error(`${file}: a line longer than ${CHUNK} bytes`);
        break; // half a line: wait for the rest
      }
      for (const l of buf.subarray(0, end).toString('utf8').split('\n')) if (l.trim()) lines.push(l);
      offset += end + 1;
    }
    return { ino: st.ino, offset, lines };
  } finally {
    closeSync(fd);
  }
}

// createCollector({ store, audits: {node: file}, pgLog, namespace, lookupLease })
export function createCollector({ store, audits, pgLog, namespace, lookupLease, log = console }) {
  const status = {}; // source -> { readable, error, last_event, last_read }
  const since = () => store.meta('ingest_since') || '';

  function ingestFile(source, file, parse) {
    let got;
    try {
      got = readNew(file, store.cursor(source));
    } catch (e) {
      status[source] = { ...status[source], readable: false, error: e.code || e.message, last_read: new Date().toISOString() };
      return 0;
    }
    let added = 0;
    store.tx(() => {
      for (const line of got.lines) {
        let rec;
        try {
          rec = parse(JSON.parse(line));
        } catch {
          continue; // not JSON: not evidence
        }
        if (!rec || rec.at < since()) continue;
        if (store.add({ source, id: rec.id, at: rec.at, body: line, facts: rec.facts })) {
          added++;
          status[source] = { ...status[source], last_event: rec.at };
        }
      }
      store.setCursor(source, got.ino, got.offset);
    });
    status[source] = { ...status[source], readable: true, error: null, last_read: new Date().toISOString() };
    return added;
  }

  // Leases issued and not known to be ended: ask Vault (sys/leases/lookup).
  // Only a change of state becomes a new raw event.
  async function checkLeases(now = Date.now()) {
    const open = store.db.prepare(`
      SELECT f.lease_id, MAX(f.at) AS at FROM fact f
      WHERE f.kind = 'vault.response' AND f.lease_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fact e WHERE e.kind = 'lease.ended' AND e.lease_id = f.lease_id)
      GROUP BY f.lease_id`).all();
    for (const { lease_id } of open) {
      let r;
      try {
        r = await lookupLease(lease_id);
      } catch (e) {
        status.leases = { readable: false, error: e.message, last_read: new Date(now).toISOString() };
        return;
      }
      const at = new Date(now).toISOString();
      const ended = !r.ok && /invalid lease/.test(r.errors.join(' '));
      const kind = r.ok ? 'lease.active' : ended ? 'lease.ended' : null;
      if (!kind) continue;
      const d = r.json?.data || {};
      // One active record per lease (its issue and expiry do not change unless
      // renewed), one ended record.
      const id = r.ok ? `${lease_id}:active:${d.expire_time}` : `${lease_id}:ended`;
      store.add({
        source: 'vault-lease', id, at, body: { lease_id, status: r.status, errors: r.errors, data: d },
        facts: [{ kind, at, lease_id, issue_time: d.issue_time ?? null, expire_time: d.expire_time ?? null, ttl: d.ttl ?? null, renewable: d.renewable ?? null, answer: r.ok ? 'active' : r.errors[0] }],
      });
    }
    status.leases = { readable: true, error: null, last_read: new Date(now).toISOString() };
  }

  async function cycle({ leases = true } = {}) {
    let added = 0;
    for (const [node, file] of Object.entries(audits)) added += ingestFile(`vault-audit:${node}`, file, (e) => fromAudit(e, node, namespace));
    added += ingestFile('postgres', pgLog, fromPg);
    if (leases) await checkLeases();
    if (added) log.log(JSON.stringify({ at: new Date().toISOString(), collector: 'cycle', added }));
    return added;
  }

  return { cycle, status: () => status, readable: (source) => status[source]?.readable ?? null };
}
