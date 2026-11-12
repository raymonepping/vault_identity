import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCases, safeSaid } from '../lib/cases.js';
import { openStore } from '../lib/store.js';

const cases = JSON.parse(readFileSync(new URL('../../config/cases.json', import.meta.url)));
const ns = (p) => `observatory/${p}`;
const PASSWORD = 'pw-synthetic-never-stored';
const issued = { ok: true, status: 200, errors: [], requestId: 'r1', node: 'vault-1', json: { lease_id: 'database/creds/finance-readonly/abc', lease_duration: 600, renewable: true, data: { username: 'v-x', password: PASSWORD } } };

function rig({ entity = 'e-noor', vault = async () => issued } = {}) {
  const calls = [];
  const store = openStore(':memory:');
  const pgOpts = [];
  const runner = createCases({
    cases, ns, store,
    call: async (tok, method, path, opts) => { calls.push({ tok, method, path, headers: opts?.headers }); return vault(tok, method, path); },
    consoleToken: () => 'console-token',
    issuer: { mint: (c) => `jwt:${c.sub}:${c.act || ''}` },
    entityIdOf: async (name) => (name === 'noor' ? 'e-noor' : null),
    newPgClient: (o) => { pgOpts.push(o); return { on() {}, connect: async () => {}, query: async () => ({ rows: [{ entries: 6 }] }), end: async () => {} }; },
    approleDir: '/nonexistent',
  });
  return { runner, store, calls, pgOpts, session: { token: 'noor-token', entity } };
}

test('a run never keeps the generated password', async () => {
  const { runner, store, session } = rig();
  await runner.run(session, 6);
  const dump = JSON.stringify(store.latestRuns().map((r) => store.run(r.id))) + JSON.stringify(store.factsWhere('1 = 1'));
  assert.equal(dump.includes(PASSWORD), false);
  assert.equal(dump.includes('jwt:'), false, 'no JWT in the store either');
});

test('every Vault call carries the run correlation id and the purpose code', async () => {
  const { runner, calls, session, pgOpts } = rig();
  const run = await runner.run(session, 6);
  const c = calls.find((x) => x.path.endsWith('database/creds/finance-readonly'));
  assert.equal(c.headers['X-Correlation-Id'], run.correlation_id);
  assert.equal(c.headers['X-Observatory-Purpose'], 'monthly-reconciliation');
  assert.equal(pgOpts[0].application_name, `finance-agent:${run.correlation_id.slice(-8)}`);
});

test('a delegation is minted for Noor only while Noor is signed in', async () => {
  const { runner, session } = rig({ entity: 'e-someone-else' });
  await assert.rejects(runner.run(session, 5), (e) => e.status === 403 && /only noor/.test(e.message));
});

test('the OBO token names the subject and the actor; autonomous only the agent', async () => {
  const { runner, calls, session } = rig();
  await runner.run(session, 5);
  await runner.run(session, 3);
  assert.equal(calls[0].tok, 'jwt:noor:agent:finance-agent');
  assert.equal(calls.at(-1).tok, 'jwt:agent:ledger-agent:');
});

test('a denied request stops the case: nothing is connected', async () => {
  const { runner, session, pgOpts } = rig({ vault: async () => ({ ok: false, status: 403, errors: ['RAR_NO_MATCH: x'], json: null }) });
  const run = await runner.run(session, 8);
  assert.equal(run.outcome, 'denied');
  assert.equal(pgOpts.length, 0);
});

test('KV step answers keep the metadata and drop the value', () => {
  const s = safeSaid('noor', 'GET', 'observatory/kv/data/finance/reconciliation-api', { ok: true, status: 200, errors: [], json: { data: { data: { api_key: 'corvid-recon-demo-key-0001' }, metadata: { version: 1 } } } });
  assert.deepEqual(s.data, { metadata: { version: 1 } });
});

test('an unknown case is a 404 and one run at a time', async () => {
  const { runner, session } = rig();
  await assert.rejects(runner.run(session, 99), (e) => e.status === 404);
  const slow = rig({ vault: () => new Promise((r) => setTimeout(() => r(issued), 50)) });
  const first = slow.runner.run(slow.session, 4);
  await assert.rejects(slow.runner.run(slow.session, 4), (e) => e.status === 409);
  await first;
});
