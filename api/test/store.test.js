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
  const rec = { source: 'vault-audit:vault-1', id: 'a', at: '2026-11-12T08:00:00Z', body: '{}', facts: [{ kind: 'vault.request', at: '2026-11-12T08:00:00Z' }] };
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
  store.add({ source: 'vault-audit:vault-1', id: 'x', at: '2026-11-12T08:00:00Z', body: '{}', facts: [{ kind: 'vault.response', at: '2026-11-12T08:00:00Z', lease_id: F.LEASE, db_user: F.USER }] });
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

import { secretResponse } from '../lib/correlate.js';

// One run as the collector stores it: its request and response, a later revoke
// response, its session, someone else's session, two logins of the subject.
function seededRun() {
  const s = openStore(':memory:');
  const corr = 'run-2-0a1b2c3d';
  const add = (id, at, fact) => s.add({ source: 'test', id, at, body: '{}', facts: [{ at, ...fact }] });
  add('l1', '2026-11-12T07:00:00Z', { kind: 'vault.response', path: 'auth/userpass/login/noor', login_entity: 'e-noor' });
  add('l2', '2026-11-12T07:59:00Z', { kind: 'vault.response', path: 'auth/userpass/login/noor', login_entity: 'e-noor' });
  add('l3', '2026-11-12T09:00:00Z', { kind: 'vault.response', path: 'auth/userpass/login/noor', login_entity: 'e-noor' });
  add('rq', '2026-11-12T08:00:00.100000000Z', { kind: 'vault.request', correlation_id: corr, path: 'database/creds/finance-readonly' });
  add('rs', '2026-11-12T08:00:00.200000000Z', { kind: 'vault.response', correlation_id: corr, path: 'database/creds/finance-readonly', lease_id: 'L1', db_user: 'v-noor-1', entity_id: 'e-noor', flow: 'human' });
  add('rv', '2026-11-12T08:00:05Z', { kind: 'vault.response', correlation_id: corr, path: 'sys/leases/revoke' });
  add('pc', '2026-11-12T08:00:00.200500000Z', { kind: 'pg.connect', db_user: 'v-noor-1' });
  add('px', '2026-11-12T08:00:01Z', { kind: 'pg.connect', db_user: 'v-someone-else' });
  add('la', '2026-11-12T08:00:02Z', { kind: 'lease.active', lease_id: 'L1', expire_time: '2026-11-12T08:10:00Z' });
  return { s, run: { correlation_id: corr, finished_at: '2026-11-12T08:00:06Z' } };
}

test("runFacts: the credential's user and lease, the last login before the run, nobody else's session", () => {
  const { s, run } = seededRun();
  const kinds = s.runFacts(run, secretResponse).map((f) => `${f.kind}:${f.db_user || f.lease_id || f.data.path}`);
  assert.ok(kinds.includes('pg.connect:v-noor-1'));
  assert.ok(!kinds.includes('pg.connect:v-someone-else'));
  assert.ok(kinds.includes('lease.active:L1'));
  const logins = s.runFacts(run, secretResponse).filter((f) => f.data.login_entity);
  assert.equal(logins.length, 1);
  assert.equal(logins[0].at, '2026-11-12T07:59:00.000Z', 'the last login before the run ended, not the one after');
});

test('times of different precision sort by time (Vault 9 digits, PostgreSQL 3)', () => {
  const { s, run } = seededRun();
  const order = s.runFacts(run, secretResponse).map((f) => f.kind);
  assert.ok(order.indexOf('vault.response') < order.indexOf('pg.connect'), 'the response at .200 comes before the connect at .2005');
});

test('credentials: lease state and sessions per issued credential, in a few queries', () => {
  const { s } = seededRun();
  s.add({ source: 'test', id: 'le', at: '2026-11-12T08:10:01Z', body: '{}', facts: [{ kind: 'lease.ended', at: '2026-11-12T08:10:01Z', lease_id: 'L1' }] });
  const [c] = s.credentials();
  assert.equal(c.fact.db_user, 'v-noor-1');
  assert.equal(c.sessions, 1);
  assert.equal(c.ended, true);
  assert.equal(c.active.expire_time, '2026-11-12T08:10:00Z');
});

test('the latest run per case, and a run the API never finished is marked interrupted', () => {
  const s = openStore(':memory:');
  s.saveRun({ id: 'run-1-00000001', case_id: 1, principal: 'noor', correlation_id: 'run-1-00000001', started_at: '2026-11-12T08:00:00Z', finished_at: '2026-11-12T08:00:01Z', outcome: 'allowed' });
  s.saveRun({ id: 'run-1-00000002', case_id: 1, principal: 'noor', correlation_id: 'run-1-00000002', started_at: '2026-11-12T08:05:00Z' });
  assert.deepEqual(s.latestRuns().map((r) => r.id), ['run-1-00000002']);
  assert.equal(s.markInterrupted('2026-11-12T09:00:00Z'), 1);
  assert.equal(s.run('run-1-00000002').outcome, 'interrupted');
  assert.equal(s.run('run-1-00000001').outcome, 'allowed');
});
