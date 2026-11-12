// lib/issuer.js: the lab's OAuth issuer (D12). It stands in for an enterprise
// identity provider: it signs short access tokens (ES256) that Vault's profile
// corvid-issuer trusts. Subjects, actors and RAR come only from
// config/cases.json through lib/cases.js, never from a request body. It mints
// a delegation (sub = a person, act.sub = an agent) only for the person's own
// signed-in session (cases.js checks the entity). No token-exchange endpoint
// is exposed. The private key is read per mint from its read-only mount.
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { signJwt } from './jwt.js';

export class IssuerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createIssuer({ keyFile, issuer, audience, ttlSeconds = 300, kid = 'corvid-1', now = () => Date.now() }) {
  const key = () => {
    try {
      return readFileSync(keyFile);
    } catch (e) {
      throw new IssuerError(503, `the issuer key is not readable (${keyFile}): ${e.code || e.message}; run make gen-certs`);
    }
  };
  return {
    // mint({ sub, act, rar }) -> a compact JWT. Never logged.
    mint({ sub, act = null, rar }) {
      if (typeof sub !== 'string' || !sub) throw new IssuerError(500, 'the issuer needs a subject');
      if (!Array.isArray(rar) || !rar.length) throw new IssuerError(500, 'the issuer puts RAR in every token (Vault requires it, probe P9)');
      const iat = Math.floor(now() / 1000);
      const claims = { iss: issuer, aud: audience, sub, jti: randomUUID(), iat, nbf: iat, exp: iat + ttlSeconds, authorization_details: rar };
      if (act) claims.act = { sub: act };
      return signJwt(claims, { key: key(), kid });
    },
    // The public key's fingerprint (first 8 hex of SHA-256 of its DER), for /api/status.
    fingerprint() {
      try {
        const der = createPublicKey(key()).export({ type: 'spki', format: 'der' });
        return createHash('sha256').update(der).digest('hex').slice(0, 8);
      } catch {
        return null;
      }
    },
  };
}
