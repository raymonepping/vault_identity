import { test } from 'node:test';
import assert from 'node:assert/strict';
import { said, scrub } from '../lib/said.js';

test('scrub drops tokens, passwords and secret ids at any depth', () => {
  const v = scrub({ a: { password: 'pw-synthetic', username: 'v-x', list: [{ client_token: 't', ok: 1 }] }, secret_id: 's' });
  assert.deepEqual(v, { a: { username: 'v-x', list: [{ ok: 1 }] } });
});

test("Vault's errors are kept verbatim, with who asked", () => {
  const v = said('finance-agent for noor', 'GET', 'observatory/kv/data/finance/payroll-export', {
    status: 403,
    errors: ['2 errors occurred: * CEILING_POLICY_DENIED: actor ceiling policy denied permission * permission denied'],
    json: null,
    requestId: null,
  });
  assert.equal(v.status, 403);
  assert.match(v.errors[0], /CEILING_POLICY_DENIED/);
  assert.equal(v.as, 'finance-agent for noor');
  assert.equal(v.data, null);
});
