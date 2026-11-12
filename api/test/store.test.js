import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.js';
import { createCollector, readNew } from '../lib/collector.js';
import * as F from './fixtures/evidence.js';

const dir = () => mkdtempSync(join(tmpdir(), 'vid-store-'));
const line = (o) => `${JSON.stringify(o)}\n`;
const quietLog = { log() {} };
const noLeases = async () => ({ ok: true, json: { data: {} }, errors: [] });

test('a replayed source record is stored once', () => {
  const s = openStore(':memory:');
  const rec = { source: 'vault-audit:vault-1', id: 'a', at: 't', body: '{}', facts: [{ kind: 'vault.request', at: 't' }] };
  assert.equal(s.add(rec), true);
  assert.equal(s.add(rec), false);
  assert.equal(s.factsWhere('1 = 1').length, 1);
});

test('half a line waits for its newline; offsets survive a restart', () => {
  const d = dir();
  const f = join(d, 'audit.log');
  writeFileSync(f, line(F.oboDbRequest) + JSON.stringify(F.oboDbResponse).slice(0, 40));
  const first = readNew(f, null);
  assert.equal(first.lines.length, 1);
  appendFileSync(f, `${JSON.stringify(F.oboDbResponse).slice(40)}\n`);
  const second = readNew(f, { ino: first.ino, offset: first.offset });
  assert.equal(second.lines.length, 1);
  assert.equal(JSON.parse(second.lines[0]).type, 'response');
  rmSync(d, { recursive: true });
});

test('a truncated file is read again from 0', () => {
  const d = dir();
  const f = join(d, 'audit.log');
  writeFileSync(f, line(F.oboDbRequest) + line(F.oboDbResponse));
  const a = readNew(f, null);
  writeFileSync(f, line(F.oboDbRequest));
  const b = readNew(f, { ino: a.ino, offset: a.offset });
  assert.equal(b.lines.length, 1);
  rmSync(d, { recursive: true });
});

test('the collector ingests audit and jsonlog, skips noise, and is replay-safe', async () => {
  const d = dir();
  const audit = join(d, 'audit.log');
  const pgl = join(d, 'postgresql.json');
  writeFileSync(audit, line(F.oboDbRequest) + line(F.consoleLookup) + line(F.oboDbResponse) + 'not json\n');
  writeFileSync(pgl, line(F.pgHealthcheck) + line(F.pgConnect));
  const store = openStore(join(d, 'e.db'));
  const c = createCollector({ store, audits: { 'vault-1': audit }, pgLog: pgl, namespace: 'observatory', lookupLease: noLeases, log: quietLog });
  assert.equal(await c.cycle({ leases: false }), 3);
  assert.equal(await c.cycle({ leases: false }), 0);
  store.close();
  const again = openStore(join(d, 'e.db'));
  const c2 = createCollector({ store: again, audits: { 'vault-1': audit }, pgLog: pgl, namespace: 'observatory', lookupLease: noLeases, log: quietLog });
  assert.equal(await c2.cycle({ leases: false }), 0, 'a restart reads nothing twice');
  assert.equal(again.factsWhere("kind = 'pg.connect'").length, 1);
  again.close();
  rmSync(d, { recursive: true });
});

test('a missing source is unreadable, not empty', async () => {
  const store = openStore(':memory:');
  const c = createCollector({ store, audits: { 'vault-1': '/nonexistent/audit.log' }, pgLog: '/nonexistent/pg.json', lookupLease: noLeases, log: quietLog });
  await c.cycle({ leases: false });
  assert.equal(c.readable('vault-audit:vault-1'), false);
  assert.equal(c.readable('postgres'), false);
});

test('a lease lookup records active once and ended once', async () => {
  const store = openStore(':memory:');
  store.add({ source: 'vault-audit:vault-1', id: 'x', at: 't', body: '{}', facts: [{ kind: 'vault.response', at: 't', lease_id: F.LEASE, db_user: F.USER }] });
  let answer = { ok: true, status: 200, errors: [], json: { data: { expire_time: '2026-11-12T08:10:00Z', ttl: 600 } } };
  const c = createCollector({ store, audits: {}, pgLog: '/nonexistent', lookupLease: async () => answer, log: quietLog });
  await c.cycle();
  await c.cycle();
  assert.equal(store.factsWhere("kind = 'lease.active'").length, 1);
  answer = { ok: false, status: 400, errors: ['invalid lease'], json: null };
  await c.cycle();
  await c.cycle();
  assert.equal(store.factsWhere("kind = 'lease.ended'").length, 1);
});

test('reset forgets the evidence and ingests from now on', async () => {
  const d = dir();
  const audit = join(d, 'audit.log');
  writeFileSync(audit, line(F.oboDbRequest));
  const store = openStore(join(d, 'e.db'));
  const c = createCollector({ store, audits: { 'vault-1': audit }, pgLog: '/nonexistent', lookupLease: noLeases, log: quietLog });
  await c.cycle({ leases: false });
  store.reset('2026-11-12T09:00:00Z');
  assert.equal(store.factsWhere('1 = 1').length, 0);
  appendFileSync(audit, line(F.oboDbResponse)); // older than the reset
  await c.cycle({ leases: false });
  assert.equal(store.factsWhere('1 = 1').length, 0);
  store.close();
  rmSync(d, { recursive: true });
});
