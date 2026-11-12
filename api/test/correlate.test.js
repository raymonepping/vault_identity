import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investigate, secretResponse } from '../lib/correlate.js';
import { fromAudit, fromPg } from '../lib/normalize.js';
import * as F from './fixtures/evidence.js';

let id = 0;
const facts = (...recs) => recs.map((r) => ({ id: ++id, raw_id: id, ...(({ kind, at, correlation_id = null, vault_request_id = null, lease_id = null, db_user = null, ...data }) => ({ kind, at, correlation_id, vault_request_id, lease_id, db_user, data }))(r.facts[0]) }));
const run = { correlation_id: F.CORR, started_at: '2026-11-12T08:00:00.000Z' };
const db = { secret_kind: 'leased_dynamic' };
const state = (inv, name) => inv.chain.find((l) => l.link === name).state;
const audit = (e) => fromAudit(e, 'vault-1');
const T0 = Date.parse('2026-11-12T08:00:00Z');

test('request + response share request.id: Confirmed (R1)', () => {
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbRequest), audit(F.oboDbResponse)), now: T0 + 1000 });
  assert.equal(state(inv, 'requested'), 'Confirmed');
  assert.equal(inv.chain[0].rule, 'R1');
  assert.equal(state(inv, 'issued'), 'Confirmed');
});

test('only a response: Partial, never Confirmed', () => {
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbResponse)), now: T0 });
  assert.equal(state(inv, 'requested'), 'Partial');
});

test('a connection as the generated user: Correlated (R2), with the run in application_name (R3)', () => {
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbRequest), audit(F.oboDbResponse), fromPg(F.pgConnect)), now: T0 + 2000 });
  const used = inv.chain.find((l) => l.link === 'used');
  assert.equal(used.state, 'Correlated');
  assert.equal(used.rule, 'R2+R3');
});

test('no connection inside the window: Partial; after it: Unmatched (R5), worded precisely', () => {
  const f = facts(audit(F.oboDbRequest), audit(F.oboDbResponse));
  assert.equal(state(investigate({ run, kase: db, facts: f, windowSeconds: 60, now: T0 + 30_000 }), 'used'), 'Partial');
  const late = investigate({ run, kase: db, facts: f, windowSeconds: 60, now: T0 + 61_000 });
  assert.equal(state(late, 'used'), 'Unmatched');
  assert.match(late.chain.find((l) => l.link === 'used').detail, /no matching connection observed in this 60 s telemetry window/);
});

test('an unreadable PostgreSQL log is Unknown, not Unmatched', () => {
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbRequest), audit(F.oboDbResponse)), readable: { postgres: false }, now: T0 + 120_000 });
  assert.equal(state(inv, 'used'), 'Unknown');
});

test('a connection by someone else never matches', () => {
  const other = structuredClone(F.pgConnect);
  other.user = 'v-someone-else';
  other.message = other.message.replace(F.USER, 'v-someone-else');
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbRequest), audit(F.oboDbResponse), fromPg(other)), now: T0 + 120_000 });
  assert.equal(state(inv, 'used'), 'Unmatched');
});

test('a denial: decided Confirmed with the code, nothing issued or used', () => {
  const r7 = { correlation_id: 'run-7-11112222', started_at: '2026-11-12T08:01:00Z' };
  const inv = investigate({ run: r7, kase: { secret_kind: 'kv_v2' }, facts: facts(audit(F.ceilingDenied)), now: T0 });
  assert.equal(state(inv, 'decided'), 'Confirmed');
  assert.equal(inv.decision.code, 'CEILING_POLICY_DENIED');
  assert.equal(state(inv, 'issued'), 'n/a');
  assert.equal(state(inv, 'used'), 'n/a');
});

test('the decision shows what Vault recorded: subject, actor, granting policies', () => {
  const inv = investigate({ run, kase: db, facts: facts(audit(F.oboDbRequest), audit(F.oboDbResponse)), now: T0 });
  assert.equal(inv.principals.subject.entity_id, F.NOOR);
  assert.equal(inv.principals.actor.name, 'finance-agent');
  assert.deepEqual(inv.decision.granting_policies, ['obs-noor', 'obs-finance-ceiling']);
  assert.equal(inv.decision.purpose, 'monthly-reconciliation');
});

test('a lease lookup that answers invalid lease after a revoke: ended, Confirmed (R4)', () => {
  const f = facts(audit(F.oboDbRequest), audit(F.oboDbResponse), fromPg(F.pgConnect));
  f.push({ id: 900, kind: 'app.event', at: '2026-11-12T08:00:03Z', correlation_id: F.CORR, data: { action: 'revoked', actor: 'console (the responder)' } });
  f.push({ id: 901, kind: 'lease.ended', at: '2026-11-12T08:00:04Z', lease_id: F.LEASE, data: { answer: 'invalid lease' } });
  f.push({ id: 902, kind: 'pg.error', at: '2026-11-12T08:00:05Z', db_user: F.USER, data: { message: 'permission denied for table ledger_entries' } });
  const inv = investigate({ run, kase: db, facts: f, now: T0 + 10_000 });
  assert.equal(state(inv, 'ended'), 'Confirmed');
  assert.match(inv.chain.at(-1).detail, /revoked by console/);
  assert.equal(inv.afterRevoke.length, 1);
  assert.match(inv.afterRevoke[0].message, /permission denied/);
});

test('a KV read without application evidence stays Partial and says why', () => {
  const kv = structuredClone(F.oboDbResponse);
  kv.request.path = 'kv/data/finance/reconciliation-api';
  kv.response = { data: { metadata: { version: 1 } } };
  const kvReq = structuredClone(F.oboDbRequest);
  kvReq.request.path = 'kv/data/finance/reconciliation-api';
  const inv = investigate({ run, kase: { secret_kind: 'kv_v2' }, facts: facts(audit(kvReq), audit(kv)), now: T0 });
  assert.equal(state(inv, 'issued'), 'Confirmed');
  assert.equal(state(inv, 'used'), 'Partial');
  assert.equal(state(inv, 'ended'), 'n/a');
});

test("a run's later revoke response does not hide its credential response", () => {
  const f = facts(audit(F.oboDbRequest), audit(F.oboDbResponse));
  f.push({ id: 950, kind: 'vault.response', at: '2026-11-12T08:00:09Z', correlation_id: F.CORR, data: { path: 'sys/leases/revoke' } });
  assert.equal(secretResponse(f, F.CORR).db_user, F.USER);
});
