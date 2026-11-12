// lib/correlate.js: the evidence chain of one case run, derived from facts on
// every read (pure; no I/O). Five links, each with its state, the rule that
// joined it and the facts it rests on (input/03.md):
//   Confirmed   a direct, tested join: Vault's request and response share
//               request.id (R1); a lease lookup is Vault's own answer (R4)
//   Correlated  independent sources match on a stable identifier: the
//               generated username (R2) or the run's correlation id (R3)
//   Partial     something is there, a link is missing (or still in its window)
//   Unmatched   the window passed and no source shows a match (R5)
//   Unknown     the source was not readable
// "n/a" marks a link the secret kind does not have (a KV read issues no
// lease). Missing evidence never becomes a match.

export const RULES = {
  R1: 'request.id: the audit request and response entries share it',
  R2: 'the generated database username equals the PostgreSQL user, connection after issuance',
  R3: 'the run correlation id: X-Correlation-Id in the audit entry, the application event, or application_name',
  R4: 'sys/leases/lookup: Vault answers for the lease id',
  R5: 'no PostgreSQL connection for the username within the consumption window',
};

const link = (name, state, detail, { rule = null, facts = [], source = null } = {}) =>
  ({ link: name, state, detail, rule, rule_text: rule ? RULES[rule] : null, source, facts: facts.map((f) => f.id) });

const ms = (x) => (typeof x === 'number' ? x : Date.parse(x));
const after = (a, b) => ms(a) >= ms(b);
const SKEW_MS = 5_000; // both sources run in one VM; allow small clock skew

const SECRET_PATH = /^(kv\/data|database\/creds)\//;

// The run's answer to its secret request: the last response on a secret path
// with the run's correlation id (a run may also revoke a lease or log in).
export function secretResponse(facts, corr) {
  return facts.filter((f) => f.kind === 'vault.response' && f.correlation_id === corr && SECRET_PATH.test(f.data.path)).at(-1) || null;
}

// investigate({ run, kase, facts, readable, windowSeconds, now })
//   readable: { audit: bool|null, postgres: bool|null }
export function investigate({ run, kase, facts, readable = {}, windowSeconds = 60, now = Date.now() }) {
  const corr = run.correlation_id;
  const run8 = corr.slice(-8);
  const secretFacts = facts.filter((f) => f.correlation_id === corr && f.kind.startsWith('vault.') && SECRET_PATH.test(f.data.path));
  const resp = secretResponse(facts, corr);
  const req = resp ? secretFacts.find((f) => f.kind === 'vault.request' && f.vault_request_id === resp.vault_request_id) : secretFacts.find((f) => f.kind === 'vault.request');
  const auditUnknown = readable.audit === false;
  const dynamic = kase.secret_kind === 'leased_dynamic';
  const chain = [];

  // 1. Requested
  if (req && resp) chain.push(link('requested', 'Confirmed', `${req.data.operation} ${req.data.path}`, { rule: 'R1', facts: [req, resp], source: 'vault-audit' }));
  else if (req || resp) chain.push(link('requested', 'Partial', 'only one of the request and response entries is in the audit log', { facts: [req || resp], source: 'vault-audit' }));
  else chain.push(link('requested', auditUnknown ? 'Unknown' : 'Partial', auditUnknown ? 'the audit log is not readable' : 'no audit record for this run yet', { source: 'vault-audit' }));

  // 2. Decided (Vault's own record; never simulated)
  const denied = Boolean(resp?.data.error);
  if (resp) chain.push(link('decided', 'Confirmed', denied ? `denied: ${resp.data.error_code}` : 'allowed', { rule: 'R1', facts: [resp], source: 'vault-audit' }));
  else chain.push(link('decided', auditUnknown ? 'Unknown' : 'Partial', 'no response entry yet', { source: 'vault-audit' }));

  // 3. Issued
  if (!resp || denied) chain.push(link('issued', denied ? 'n/a' : 'Partial', denied ? 'nothing issued: the request was denied' : 'no response entry yet'));
  else if (!dynamic) chain.push(link('issued', 'Confirmed', `KV v2 version ${resp.data.kv_version ?? '(not in the record)'}`, { rule: 'R1', facts: [resp], source: 'vault-audit' }));
  else if (resp.lease_id && resp.db_user) chain.push(link('issued', 'Confirmed', `lease ${resp.lease_id}, database user ${resp.db_user}`, { rule: 'R1', facts: [resp], source: 'vault-audit' }));
  else chain.push(link('issued', 'Partial', 'the response has no lease id or username', { facts: [resp], source: 'vault-audit' }));

  // 4. Used
  const user = resp?.db_user || null;
  const issuedAt = resp?.at || run.started_at;
  const connects = user ? facts.filter((f) => f.kind === 'pg.connect' && f.db_user === user && after(f.at, Date.parse(issuedAt) - SKEW_MS)) : [];
  const appUse = facts.filter((f) => f.kind === 'app.event' && f.correlation_id === corr && f.data.action === 'used');
  if (!resp || denied) chain.push(link('used', 'n/a', denied ? 'nothing was issued, so nothing could be used' : 'waiting for the issuance record'));
  else if (!dynamic) {
    if (appUse.length) chain.push(link('used', 'Correlated', `the application reported: ${appUse[0].data.detail}`, { rule: 'R3', facts: appUse, source: 'application' }));
    else chain.push(link('used', 'Partial', `Vault returned version ${resp.data.kv_version} to the caller; no application reported using it (a KV read issues no lease, so nothing else can)`));
  } else if (connects.length) {
    const named = connects.filter((f) => String(f.data.application_name || '').endsWith(run8));
    chain.push(link('used', 'Correlated', `PostgreSQL accepted ${connects.length} connection(s) as ${user}${named.length ? ` from application ${named[0].data.application_name}` : ''}`,
      { rule: named.length ? 'R2+R3' : 'R2', facts: connects, source: 'postgres' }));
  } else if (readable.postgres === false) chain.push(link('used', 'Unknown', 'the PostgreSQL log is not readable', { source: 'postgres' }));
  else {
    const ends = Date.parse(issuedAt) + windowSeconds * 1000;
    if (now < ends) chain.push(link('used', 'Partial', `no connection observed yet; the ${windowSeconds} s window ends ${new Date(ends).toISOString()}`, { source: 'postgres' }));
    else chain.push(link('used', 'Unmatched', `no matching connection observed in this ${windowSeconds} s telemetry window`, { rule: 'R5', source: 'postgres' }));
  }
  if (chain.at(-1).rule === 'R2+R3') chain.at(-1).rule_text = `${RULES.R2}; ${RULES.R3}`;

  // 5. Ended
  const lease = resp?.lease_id || null;
  const ended = lease ? facts.filter((f) => f.kind === 'lease.ended' && f.lease_id === lease) : [];
  const active = lease ? facts.filter((f) => f.kind === 'lease.active' && f.lease_id === lease).at(-1) : null;
  const revoked = facts.find((f) => f.kind === 'app.event' && f.correlation_id === corr && f.data.action === 'revoked');
  if (!dynamic) chain.push(link('ended', 'n/a', 'KV v2 has no lease: a read has no end'));
  else if (!lease) chain.push(link('ended', 'n/a', 'no lease was issued'));
  else if (ended.length) {
    const exp = active?.data.expire_time;
    const why = revoked ? `revoked by ${revoked.data.actor} at ${revoked.at}`
      : exp && after(ended[0].at, exp) ? `expired (expire_time ${exp}; Vault writes no audit entry for an expiry)`
        : 'ended before its expire_time with no revoke from this run (a revoked or expired parent token ends its leases too)';
    chain.push(link('ended', 'Confirmed', `${why}; lookup answers "${ended[0].data.answer}"`, { rule: 'R4', facts: revoked ? [revoked, ended[0]] : [ended[0]], source: 'vault-lease' }));
  } else if (active) chain.push(link('ended', 'Partial', `active until ${active.data.expire_time} (lease lookup)`, { rule: 'R4', facts: [active], source: 'vault-lease' }));
  else chain.push(link('ended', 'Partial', 'no lease lookup yet'));

  // After a revoke (case 10): what PostgreSQL observed from that user.
  const afterRevoke = revoked && user
    ? facts.filter((f) => f.db_user === user && f.kind.startsWith('pg.') && f.kind !== 'pg.connect' && after(f.at, revoked.at))
      .map((f) => ({ id: f.id, at: f.at, kind: f.kind, message: f.data.message, state_code: f.data.state_code }))
    : [];

  // Principals as Vault recorded them (P18): subject = auth.entity_id, actor
  // from auth.metadata. Configured context is the server's to add.
  const principals = resp ? {
    subject: { entity_id: resp.data.entity_id, flow: resp.data.flow, display_name: resp.data.display_name, metadata: resp.data.auth_metadata },
    actor: resp.data.auth_metadata.actor_entity_id ? { entity_id: resp.data.auth_metadata.actor_entity_id, name: resp.data.auth_metadata.actor_entity_name } : null,
  } : null;
  const decision = resp ? {
    outcome: denied ? 'denied' : 'allowed',
    error: resp.data.error,
    code: resp.data.error_code,
    granting_policies: resp.data.policy_results?.granting || [],
    policy_allowed: resp.data.policy_results?.allowed ?? null,
    authorization_details: resp.data.authorization_details,
    purpose: req?.data.purpose ?? null,
    jwt: resp.data.auth_metadata.jwt_issuer ? { issuer: resp.data.auth_metadata.jwt_issuer, unique_id: resp.data.auth_metadata.jwt_unique_id, audience: resp.data.auth_metadata.jwt_audience } : null,
  } : null;

  // Settled: nothing left that more time could change (the UI stops polling).
  const settled = Boolean(resp) && chain.every((l) => l.state !== 'Partial' || (l.link === 'ended' && l.facts.length > 0) || (l.link === 'used' && !dynamic));
  return { chain, principals, decision, afterRevoke, settled };
}
