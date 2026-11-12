// lib/normalize.js: one source record in, facts out. Only fields the probe
// found (docs/capabilities.md) are read; a missing field stays missing.
//
// Vault audit (file device, one JSON object per line):
//   request.id joins the request and response entries (R1); the
//   X-Correlation-Id header (audited by default, P20) joins a case run;
//   auth.entity_id is the SUBJECT, auth.metadata.actor_entity_id the agent
//   acting for it (P18); response.data.username is in clear on database/
//   (audit_non_hmac_response_keys, P22); response.secret.lease_id is clear.
// PostgreSQL jsonlog: "connection authorized" carries no application_name
// field, only in the message; "disconnection" has the field (P23).

const SECRET_PATH = /^(kv\/data\/finance\/|database\/creds\/)/;
const LOGIN_PATH = /^auth\/(userpass|approle)\/login(\/|$)/;
const REVOKE_PATH = /^sys\/leases\/revoke$/;
const first = (v) => (Array.isArray(v) ? v[0] : v) ?? null;
const clear = (v) => (typeof v === 'string' && !v.startsWith('hmac-sha256:') ? v : null);

// How Vault saw the caller, from what Vault itself recorded (never from a
// display name, 03): an actor means OBO, a JWT issuer means an agent acting as
// itself, an AppRole role a workload, a userpass username a person.
export function identityFlow(auth) {
  const m = auth?.metadata || {};
  if (m.actor_entity_id) return 'agent_obo';
  if (m.jwt_issuer) return 'agent_autonomous';
  if (m.role_name) return 'workload';
  if (m.username) return 'human';
  return 'unknown';
}

// The Vault error code, when the text has one (P9, P12, P14, P15).
export const errorCode = (err) => /\b(CEILING_POLICY_DENIED|RAR_NO_MATCH|RAR_MISSING)\b/.exec(err || '')?.[1] || (err ? 'permission denied' : null);

// fromAudit(entry, node, namespace) -> null (not ours) or { id, at, facts }
export function fromAudit(e, node, namespace = 'observatory') {
  if (!e || (e.type !== 'request' && e.type !== 'response')) return null;
  const req = e.request || {};
  if ((req.namespace?.path || '') !== `${namespace}/`) return null;
  const path = req.path || '';
  const corr = first(req.headers?.['x-correlation-id']);
  const ours = String(corr || '').startsWith('run-');
  const relevant = SECRET_PATH.test(path) || LOGIN_PATH.test(path) || (REVOKE_PATH.test(path) && ours);
  if (!relevant) return null;
  const auth = e.auth || {};
  const m = auth.metadata || {};
  const resp = e.response || {};
  const fact = {
    kind: `vault.${e.type}`,
    at: e.time,
    correlation_id: corr,
    vault_request_id: req.id || null,
    lease_id: clear(resp.secret?.lease_id) || null,
    db_user: e.type === 'response' ? clear(resp.data?.username) : null,
    node,
    path,
    operation: req.operation || null,
    mount_type: req.mount_type || null,
    remote_address: req.remote_address || null,
    purpose: first(req.headers?.['x-observatory-purpose']),
    flow: identityFlow(auth),
    entity_id: auth.entity_id || null,
    display_name: auth.display_name || null,
    token_type: auth.token_type || null,
    policies: auth.policies || [],
    identity_policies: auth.identity_policies || [],
    auth_metadata: {
      username: m.username ?? null,
      role_name: m.role_name ?? null,
      application: m.application ?? null,
      team: m.team ?? null,
      actor_entity_id: m.actor_entity_id ?? null,
      actor_entity_name: m.actor_entity_name ?? null,
      jwt_issuer: m.jwt_issuer ?? null,
      jwt_unique_id: m.jwt_unique_id ?? null,
      jwt_audience: m.jwt_audience_claim ?? null,
    },
    authorization_details: auth.authorization_details || m.jwt_authorization_details || null,
    policy_results: auth.policy_results
      ? { allowed: Boolean(auth.policy_results.allowed), granting: (auth.policy_results.granting_policies || []).map((g) => g.name).filter(Boolean) }
      : null,
    error: e.error || null,
    error_code: e.type === 'response' ? errorCode(e.error) : null,
    kv_version: e.type === 'response' ? (resp.data?.metadata?.version ?? null) : null,
    // A login's response names who signed in.
    login_entity: LOGIN_PATH.test(path) && e.type === 'response' ? resp.auth?.entity_id || null : null,
  };
  return { id: `${node}:${req.id}:${e.type}`, at: e.time, facts: [fact] };
}

const SESSION_TIME = /session time: (\d+):(\d+):([\d.]+)/;
const APPNAME = /application_name=(\S+)/;
const TLS = /SSL enabled \(protocol=([^,]+)/;

// fromPg(line) -> null or { id, at, facts }. Only Vault-generated users
// (v-<display>-<role>-...) are evidence; the postgres OS user's healthcheck and
// the schema phase are not.
export function fromPg(l) {
  if (!l || typeof l.user !== 'string' || !l.user.startsWith('v-')) return null;
  const msg = l.message || '';
  let kind = null;
  if (msg.startsWith('connection authorized')) kind = 'pg.connect';
  else if (msg.startsWith('disconnection')) kind = 'pg.disconnect';
  else if (l.error_severity === 'FATAL') kind = 'pg.login_failed';
  else if (l.error_severity === 'ERROR') kind = 'pg.error';
  if (!kind) return null;
  const st = SESSION_TIME.exec(msg);
  const at = new Date(String(l.timestamp).replace(' UTC', 'Z').replace(' ', 'T')).toISOString();
  return {
    id: `${l.session_id}:${l.line_num}`,
    at,
    facts: [{
      kind,
      at,
      db_user: l.user,
      session_id: l.session_id,
      database: l.dbname || null,
      remote_host: l.remote_host || null,
      application_name: l.application_name || APPNAME.exec(msg)?.[1] || null,
      // The connect line names the TLS protocol when the session is encrypted.
      tls: kind === 'pg.connect' ? TLS.exec(msg)?.[1] || null : null,
      state_code: l.state_code || null,
      message: msg,
      session_seconds: st ? Number(st[1]) * 3600 + Number(st[2]) * 60 + Number(st[3]) : null,
    }],
  };
}
