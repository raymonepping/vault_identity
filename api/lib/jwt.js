// api/lib/jwt.js: sign and read compact ES256 JWTs with node:crypto (D12).
// The lab's issuer (lib/issuer.js) and the probe (scripts/probe-jwt.js) both
// use it. Signatures are IEEE P1363 (r||s), as JWS requires.
import { sign, verify, createPublicKey } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(claims, { key, kid, typ = 'at+jwt' }) {
  const header = { alg: 'ES256', typ, kid };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

// Decode without trusting: for tests and for showing claims next to evidence.
export function decodeJwt(jwt) {
  const [h, p] = String(jwt).split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')) };
}

export function verifyJwt(jwt, publicKeyPem) {
  const [h, p, s] = String(jwt).split('.');
  return verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey(publicKeyPem), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
}
