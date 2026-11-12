import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIssuer } from '../lib/issuer.js';
import { decodeJwt, verifyJwt } from '../lib/jwt.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const d = mkdtempSync(join(tmpdir(), 'vid-iss-'));
const keyFile = join(d, 'signing.pem');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const rar = [{ type: 'vault:path_access', path: 'database/creds/finance-readonly', capabilities: ['read'] }];
const iss = createIssuer({ keyFile, issuer: 'https://issuer.corvid.example', audience: 'https://vault.observatory.example', now: () => 1_800_000_000_000 });

test('a delegation token: subject, actor, RAR, 5 minutes, verifiable', () => {
  const jwt = iss.mint({ sub: 'noor', act: 'agent:finance-agent', rar });
  assert.equal(verifyJwt(jwt, pub), true);
  const { header, claims } = decodeJwt(jwt);
  assert.deepEqual([header.alg, header.kid], ['ES256', 'corvid-1']);
  assert.equal(claims.sub, 'noor');
  assert.deepEqual(claims.act, { sub: 'agent:finance-agent' });
  assert.deepEqual(claims.authorization_details, rar);
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal(claims.aud, 'https://vault.observatory.example');
});

test('an autonomous token has no actor', () => {
  assert.equal(decodeJwt(iss.mint({ sub: 'agent:ledger-agent', rar })).claims.act, undefined);
});

test('no RAR, no token (Vault would refuse it anyway: RAR_MISSING)', () => {
  assert.throws(() => iss.mint({ sub: 'agent:ledger-agent', rar: [] }), /RAR in every token/);
});

test('a missing key says how to fix it', () => {
  const broken = createIssuer({ keyFile: join(d, 'absent.pem'), issuer: 'i', audience: 'a' });
  assert.throws(() => broken.mint({ sub: 'x', rar }), (e) => e.status === 503 && /make gen-certs/.test(e.message));
  assert.equal(broken.fingerprint(), null);
});

test.after(() => rmSync(d, { recursive: true }));
