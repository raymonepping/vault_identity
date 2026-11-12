import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromAudit, fromPg, identityFlow } from '../lib/normalize.js';
import * as F from './fixtures/evidence.js';

test('an OBO response: subject is auth.entity_id, the actor comes from metadata', () => {
  const { facts: [f] } = fromAudit(F.oboDbResponse, 'vault-2');
  assert.equal(f.kind, 'vault.response');
  assert.equal(f.flow, 'agent_obo');
  assert.equal(f.entity_id, F.NOOR);
  assert.equal(f.auth_metadata.actor_entity_name, 'finance-agent');
  assert.deepEqual(f.policy_results.granting, ['obs-noor', 'obs-finance-ceiling']);
  assert.equal(f.correlation_id, F.CORR);
  assert.equal(f.purpose, 'monthly-reconciliation');
  assert.equal(f.lease_id, F.LEASE);
  assert.equal(f.db_user, F.USER);
});

test('an HMAC value never becomes an identifier', () => {
  const e = structuredClone(F.oboDbResponse);
  e.response.data.username = 'hmac-sha256:abc';
  assert.equal(fromAudit(e, 'vault-1').facts[0].db_user, null);
});

test('a ceiling denial keeps the error verbatim and its code', () => {
  const { facts: [f] } = fromAudit(F.ceilingDenied, 'vault-1');
  assert.match(f.error, /CEILING_POLICY_DENIED: actor ceiling policy denied permission/);
  assert.equal(f.error_code, 'CEILING_POLICY_DENIED');
  assert.equal(f.policy_results.allowed, false);
});

test('the console token reading leases is not evidence', () => {
  assert.equal(fromAudit(F.consoleLookup, 'vault-1'), null);
});

test('another namespace is not evidence', () => {
  const e = structuredClone(F.oboDbRequest);
  e.request.namespace.path = 'probe-1/';
  assert.equal(fromAudit(e, 'vault-1'), null);
});

test('the flow comes from what Vault recorded, never a display name', () => {
  assert.equal(identityFlow({ display_name: 'JWT Token with Unique Identifier: x', metadata: {} }), 'unknown');
  assert.equal(identityFlow({ metadata: { username: 'noor' } }), 'human');
  assert.equal(identityFlow({ metadata: { role_name: 'payments-batch' } }), 'workload');
  assert.equal(identityFlow({ metadata: { jwt_issuer: 'https://i' } }), 'agent_autonomous');
});

test('jsonlog: the connect line names the application only in its message', () => {
  const { facts: [c] } = fromPg(F.pgConnect);
  assert.equal(c.kind, 'pg.connect');
  assert.equal(c.application_name, 'finance-agent:0a1b2c3d');
  assert.equal(c.at, '2026-11-12T08:00:01.000Z');
  const { facts: [d] } = fromPg(F.pgDisconnect);
  assert.equal(d.kind, 'pg.disconnect');
  assert.equal(d.session_seconds, 1.5);
});

test('the postgres OS user (healthcheck, schema) is not evidence', () => {
  assert.equal(fromPg(F.pgHealthcheck), null);
});
