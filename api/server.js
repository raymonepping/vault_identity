// vault-identity-api: the Identity Observatory's evidence service (prompt 05).
// Plain node:http; one dependency, pg (the principals open real PostgreSQL
// sessions). Vault makes every decision; this process runs the cases with
// each principal's own credential, reads the evidence sources, and derives
// the chain. It never simulates a Vault decision and never stores a secret.
//
//   GET  /api/healthz                 process and store (no session)
//   GET  /api/status                  nodes, sources, console token, issuer key
//   POST /api/session                 sign in as noor (userpass, D11)
//   POST /api/session/end             sign out, revoke her token
//   GET  /api/session                 who is signed in
//   GET  /api/cases                   the ten cases and their last run
//   POST /api/cases/:id/run           run one case (empty body only)
//   GET  /api/runs/:id                one investigation: chain, principals, decision, story
//   GET  /api/timeline?before=&kind=  every fact, newest first
//   GET  /api/identities              entities, doors (aliases), registry, workload
//   GET  /api/secrets                 labels, the database role, credentials issued
//   GET  /api/raw/:id                 one source record, as read
//   GET  /api/overview                the four questions of input/01.md
import http from 'node:http';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { call, ns, VaultError, VAULT_NODES, nodeHealth, tokenPresent, consoleToken } from './lib/vault.js';
import * as session from './lib/session.js';
import { createRate } from './lib/rate.js';
import { openStore } from './lib/store.js';
import { createCollector } from './lib/collector.js';
import { investigate, secretResponse, RULES } from './lib/correlate.js';
import { createIssuer, IssuerError } from './lib/issuer.js';
import { createCases, CaseError } from './lib/cases.js';

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024;
const WINDOW = Number(process.env.CONSUMPTION_WINDOW || 60);
const cases = JSON.parse(readFileSync(process.env.CASES_FILE || '/app/config/cases.json', 'utf8'));
const store = openStore();
const signInRate = createRate({ max: 10, windowMs: 60_000 });
const runRate = createRate({ max: 30, windowMs: 60_000 });
const sessions = session.createSessions({ login: session.vaultLogin, revoke: session.vaultRevoke });
const issuer = createIssuer({ keyFile: process.env.ISSUER_KEY_FILE || '/run/secrets/issuer/signing.pem', issuer: process.env.VID_ISSUER, audience: process.env.VID_AUDIENCE });
const audits = Object.fromEntries((process.env.AUDIT_LOGS || '').split(',').filter(Boolean).map((p) => p.split('=')));
const collector = createCollector({
  store, audits, pgLog: process.env.PG_LOG || '/pglog/postgresql.json', namespace: process.env.VID_NAMESPACE || 'observatory',
  lookupLease: (lease_id) => call(consoleToken(), 'POST', ns('sys/leases/lookup'), { body: { lease_id } }),
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── Vault reads with the console token (identity, labels, configuration) ────
const cache = new Map(); // key -> { at, value }
async function cached(key, ttlMs, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
// A refusal is logged once per path and status: a view that silently loses a
// field (the console token lacking a capability) must leave a trace.
const refusedOnce = new Set();
const consoleRead = async (path) => {
  const r = await call(consoleToken(), 'GET', ns(path));
  if (!r.ok && r.status !== 404 && !refusedOnce.has(`${path} ${r.status}`)) {
    refusedOnce.add(`${path} ${r.status}`);
    console.error(JSON.stringify({ at: new Date().toISOString(), console_read: path, status: r.status, error: r.errors[0] || null }));
  }
  return r.ok ? r.json?.data ?? null : null;
};
const entities = () => cached('entities', 30_000, async () => {
  const r = await call(consoleToken(), 'LIST', ns('identity/entity/id'));
  const out = {};
  for (const [id, info] of Object.entries(r.json?.data?.key_info || {})) out[id] = info.name;
  return out;
});
const entityIdOf = async (name) => Object.entries(await entities()).find(([, n]) => n === name)?.[0] || null;
const doors = () => cached('doors', 60_000, async () => {
  const auth = (await consoleRead('sys/auth')) || {};
  const out = {};
  for (const [path, m] of Object.entries(auth)) if (m?.accessor) out[m.accessor] = `${path.replace(/\/$/, '')} (${m.type})`;
  const prof = await consoleRead('sys/config/oauth-resource-server/corvid-issuer');
  if (prof?.mount_accessor) out[prof.mount_accessor] = 'OAuth profile corvid-issuer (JWT)';
  return out;
});
const policyText = (name) => cached(`policy:${name}`, 60_000, async () => (await consoleRead(`sys/policies/acl/${name}`))?.policy ?? null);
const registry = (name) => cached(`agent:${name}`, 30_000, () => consoleRead(`agent-registry/registration/display-name/${name}`));

const runner = createCases({
  cases, call, ns, consoleToken, issuer, store, entityIdOf,
  newPgClient: (o) => new pg.Client(o),
  approleDir: process.env.APPROLE_DIR || '/run/secrets/approle/payments-batch',
});

// ── helpers ──────────────────────────────────────────────────────────────────
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(400, 'request body too large');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error();
    return b;
  } catch {
    throw new HttpError(400, 'the body must be a JSON object');
  }
}
const kaseOf = (id) => {
  const k = cases.cases.find((c) => c.id === Number(id));
  return k ? { ...k, secret_kind: cases.secrets[k.secret].kind, secret_path: cases.secrets[k.secret].path } : null;
};
const readable = () => {
  const st = collector.status();
  const audit = Object.keys(audits).map((n) => st[`vault-audit:${n}`]?.readable);
  return { audit: audit.some((x) => x === true) ? true : audit.some((x) => x === false) ? false : null, postgres: st.postgres?.readable ?? null };
};
const name = (ents, id) => (id ? ents[id] || id : null);
// Who a fact names, as Vault recorded it: the actor for its subject (OBO), the
// AppRole role for a workload (its entity is only entity_<id>), else the entity.
function whoOf(d, ents) {
  const m = d.auth_metadata || {};
  if (m.actor_entity_name) return `${m.actor_entity_name} for ${name(ents, d.entity_id)}`;
  if (d.flow === 'workload' && m.role_name) return `${m.role_name} (AppRole)`;
  return name(ents, d.entity_id);
}

const SOURCE_OF = { vault: 'Vault audit', pg: 'PostgreSQL log', app: 'application', lease: 'Vault lease lookup' };
function storyLine(f, ents) {
  const d = f.data;
  const src = SOURCE_OF[f.kind.split('.')[0]];
  const who = whoOf(d, ents);
  let text;
  switch (f.kind) {
    case 'vault.request':
      if (/login/.test(d.path)) text = `login request on ${d.path}`;
      else if (/^sys\/leases\/revoke$/.test(d.path)) text = 'the console (the responder) asked Vault to revoke the lease';
      else text = `${who || 'a caller'} asked ${d.operation} ${d.path}`;
      break;
    case 'vault.response':
      if (d.login_entity) text = `${name(ents, d.login_entity)} authenticated (${d.path.split('/')[1]})`;
      else if (/^sys\/leases\/revoke$/.test(d.path)) text = d.error ? `Vault refused the revoke: ${d.error_code}` : 'Vault revoked the lease';
      else text = d.error ? `Vault denied it: ${d.error_code}` : d.kv_version != null ? `Vault returned version ${d.kv_version}` : f.lease_id ? `Vault issued ${f.db_user} (lease)` : 'Vault answered';
      break;
    case 'pg.connect': text = `PostgreSQL accepted ${f.db_user}${d.application_name ? ` from ${d.application_name}` : ''}${d.tls ? ` over ${d.tls}` : ' without TLS'}`; break;
    case 'pg.disconnect': text = `PostgreSQL closed the session of ${f.db_user}${d.session_seconds != null ? ` after ${d.session_seconds} s` : ''}`; break;
    case 'pg.error': text = `PostgreSQL refused a query of ${f.db_user}: ${d.message}`; break;
    case 'pg.login_failed': text = `PostgreSQL refused a login of ${f.db_user}: ${d.message}`; break;
    case 'app.event': text = d.detail; break;
    case 'lease.active': text = `the lease is active until ${d.expire_time}`; break;
    case 'lease.ended': text = `the lease lookup answers "${d.answer}"`; break;
    default: text = f.kind;
  }
  return { id: f.id, raw_id: f.raw_id, at: f.at, kind: f.kind, source: src, label: f.kind.startsWith('app.') ? 'declared by the application' : 'observed', text };
}

async function investigation(run) {
  const kase = kaseOf(run.case_id);
  const facts = store.runFacts(run, secretResponse);
  const ents = await entities().catch(() => ({}));
  const inv = investigate({ run, kase, facts, readable: readable(), windowSeconds: WINDOW });
  if (inv.principals) {
    const sub = inv.principals.subject;
    // An AppRole login makes an entity named entity_<id>: the role says more.
    sub.name = sub.flow === 'workload' && sub.metadata.role_name ? `${sub.metadata.role_name} (AppRole)` : name(ents, sub.entity_id);
    if (inv.principals.actor) inv.principals.actor.name ||= name(ents, inv.principals.actor.entity_id);
  }
  // Configured context next to what Vault recorded (02's decision panel, 03's rule).
  const configured = { rar: kase.rar || null, purpose: kase.purpose };
  if (kase.flow === 'agent_obo') {
    const subj = await consoleRead('identity/entity/name/' + kase.subject).catch(() => null);
    const reg = await registry(kase.principal).catch(() => null);
    configured.baseline = subj?.policies || [];
    configured.ceiling = reg?.ceiling_policies || [];
  } else if (kase.flow === 'agent_autonomous' || kase.flow === 'human') {
    const e = await consoleRead('identity/entity/name/' + kase.principal).catch(() => null);
    configured.baseline = e?.policies || [];
  }
  const texts = {};
  for (const p of [...(configured.baseline || []), ...(configured.ceiling || [])].filter((x) => x.startsWith('obs-'))) texts[p] = await policyText(p).catch(() => null);
  configured.policy_texts = texts;
  return { run, case: kase, ...inv, configured, story: facts.map((f) => storyLine(f, ents)) };
}

// ── routes ───────────────────────────────────────────────────────────────────
const routes = {
  // A real check: the store answers a query.
  'GET /api/healthz': async () => ({ store: store.meta('ingest_since') === null ? 'empty' : 'ok' }),

  'GET /api/status': async (req) => {
    sessions.get(req);
    const nodes = await Promise.all(VAULT_NODES.map(nodeHealth));
    return { nodes, console_token: tokenPresent(), issuer_key: issuer.fingerprint(), sources: collector.status(), window_seconds: WINDOW, ingest_since: store.meta('ingest_since'), rules: RULES };
  },

  'POST /api/session': async (req, res) => {
    const t = signInRate.take(req.socket.remoteAddress || '?');
    if (!t.ok) throw new HttpError(429, `too many sign-in attempts; wait ${Math.ceil(t.retryAfterMs / 1000)} s`);
    const b = await readBody(req);
    if (typeof b.username !== 'string' || typeof b.password !== 'string' || !b.password || b.password.length > 256)
      throw new HttpError(400, 'username and password, please');
    const { sid, maxAge } = await sessions.signIn(b.username.trim().toLowerCase(), b.password);
    res.setHeader('set-cookie', session.sessionCookie(sid, maxAge));
    return { signedIn: b.username.trim().toLowerCase() };
  },
  'POST /api/session/end': async (req, res) => {
    const was = await sessions.signOut(req);
    res.setHeader('set-cookie', session.sessionCookie('', 0));
    return { signedOut: was };
  },
  'GET /api/session': async (req) => {
    const s = sessions.get(req);
    return { user: s.user, entity_id: s.entity, policies: s.policies };
  },

  'GET /api/cases': async (req) => {
    sessions.get(req);
    const runs = store.latestRuns();
    return {
      principals: cases.principals,
      busy: runner.busy(),
      cases: cases.cases.map((c) => ({ ...kaseOf(c.id), last_run: runs.find((r) => r.case_id === c.id) || null })),
    };
  },

  'GET /api/timeline': async (req, res, url) => {
    sessions.get(req);
    const before = Number(url.searchParams.get('before')) || null;
    const kind = url.searchParams.get('kind');
    if (kind && !/^(vault|pg|app|lease)$/.test(kind)) throw new HttpError(400, 'kind: vault, pg, app or lease');
    const kinds = kind ? { vault: ['vault.request', 'vault.response'], pg: ['pg.connect', 'pg.disconnect', 'pg.error', 'pg.login_failed'], app: ['app.event'], lease: ['lease.active', 'lease.ended'] }[kind] : null;
    const ents = await entities().catch(() => ({}));
    const facts = store.timeline({ before, kinds, limit: 100 });
    return { facts: facts.map((f) => ({ ...storyLine(f, ents), correlation_id: f.correlation_id, flow: f.data.flow || null })), next: facts.length === 100 ? facts.at(-1).id : null };
  },

  'GET /api/identities': async (req) => {
    sessions.get(req);
    const ents = await entities();
    const dmap = await doors();
    const out = [];
    for (const id of Object.keys(ents)) {
      const e = await consoleRead(`identity/entity/id/${id}`);
      if (!e) continue;
      const reg = await call(consoleToken(), 'GET', ns(`agent-registry/registration/entity-id/${id}`));
      // An AppRole login makes an entity named entity_<id>; its alias names the role.
      const role = (e.aliases || []).find((a) => a.metadata?.role_name)?.metadata.role_name;
      out.push({
        id, name: role ? `${role} (AppRole entity)` : e.name, vault_name: e.name, policies: e.policies || [], metadata: e.metadata || {}, disabled: e.disabled,
        aliases: (e.aliases || []).map((a) => ({ name: a.name, door: dmap[a.mount_accessor] || a.mount_accessor, metadata: a.metadata || null, created: a.creation_time })),
        registry: reg.ok ? reg.json.data : null,
      });
    }
    const approle = await consoleRead('auth/approle/role/payments-batch');
    return { entities: out, workload_role: approle ? { token_policies: approle.token_policies, token_ttl: approle.token_ttl } : null };
  },

  'GET /api/secrets': async (req) => {
    sessions.get(req);
    const kv = [];
    for (const [key, s] of Object.entries(cases.secrets).filter(([, s]) => s.kind === 'kv_v2')) {
      const m = await consoleRead(`kv/metadata/${s.path.replace(/^kv\/data\//, '')}`);
      kv.push({ key, path: s.path, labels: m?.custom_metadata || null, current_version: m?.current_version ?? null, updated: m?.updated_time ?? null });
    }
    const role = await consoleRead('database/roles/finance-readonly');
    const ents = await entities().catch(() => ({}));
    const issued = store.credentials().map(({ fact: f, ended, active, sessions }) => ({
      lease_id: f.lease_id, db_user: f.db_user, at: f.at, correlation_id: f.correlation_id, requested_by: whoOf(f.data, ents),
      actor: f.data.auth_metadata.actor_entity_name, flow: f.data.flow, sessions, state: ended ? 'ended' : active ? 'active' : 'unknown', expire_time: active?.expire_time ?? null,
    })).reverse();
    return { kv, database_role: role ? { db_name: role.db_name, default_ttl: role.default_ttl, max_ttl: role.max_ttl } : null, credentials: issued };
  },

  'GET /api/overview': async (req) => {
    sessions.get(req);
    const ents = await entities().catch(() => ({}));
    const secretResp = store.secretResponses();
    const requesters = {};
    for (const f of secretResp) {
      const who = whoOf(f.data, ents) || 'unknown (no identity in the record)';
      const r = (requesters[who] ||= { who, flow: f.data.flow, allowed: 0, denied: 0, last: null });
      if (f.data.error) r.denied++;
      else r.allowed++;
      r.last = f.at;
    }
    const consumers = {};
    for (const f of store.factsWhere("kind = 'pg.connect'")) {
      const app = String(f.data.application_name || 'unnamed').split(':')[0];
      const c = (consumers[app] ||= { application: app, sessions: 0, last: null });
      c.sessions++;
      c.last = f.at;
    }
    const nowMs = Date.now();
    const look = [];
    for (const f of secretResp.filter((x) => x.data.error)) look.push({ at: f.at, what: 'denied', detail: `${f.data.error_code} on ${f.data.path}`, correlation_id: f.correlation_id });
    const creds = store.credentials();
    for (const { fact: f, sessions } of creds) {
      if (f.db_user && !sessions && nowMs - Date.parse(f.at) > WINDOW * 1000)
        look.push({ at: f.at, what: 'unmatched', detail: `${f.db_user} was issued and no connection was observed in ${WINDOW} s`, correlation_id: f.correlation_id });
    }
    for (const f of store.factsWhere("kind IN ('pg.error', 'pg.login_failed')")) look.push({ at: f.at, what: f.kind === 'pg.error' ? 'query refused' : 'login refused', detail: `${f.db_user}: ${f.data.message}`, correlation_id: null });
    for (const f of secretResp.filter((x) => !String(x.correlation_id || '').startsWith('run-'))) look.push({ at: f.at, what: 'outside the console', detail: `${whoOf(f.data, ents) || 'an unknown caller'} asked for ${f.data.path} without a run correlation id`, correlation_id: f.correlation_id });
    return {
      requesters: Object.values(requesters).sort((a, b) => b.last.localeCompare(a.last)),
      consumers: Object.values(consumers).sort((a, b) => b.last.localeCompare(a.last)),
      active_credentials: creds.filter((c) => c.active && !c.ended).map((c) => ({ lease_id: c.fact.lease_id, expire_time: c.active.expire_time })),
      look: look.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      sources: readable(),
    };
  },
};

// Routes with an id.
async function idRoute(req, res, url) {
  let m = /^\/api\/cases\/(\d+)\/run$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    const s = sessions.get(req);
    const t = runRate.take('runs');
    if (!t.ok) throw new HttpError(429, 'too many runs in a minute');
    const b = await readBody(req);
    // Paths, RAR and purpose come from config/cases.json only (D12).
    if (Object.keys(b).length) throw new HttpError(400, 'a run takes no parameters; the case defines them');
    const run = await runner.run(s, m[1]);
    res.runId = run.id;
    return { run };
  }
  m = /^\/api\/runs\/(run-\d+-[0-9a-f]{8})$/.exec(url.pathname);
  if (m && req.method === 'GET') {
    sessions.get(req);
    const run = store.run(m[1]);
    if (!run) throw new HttpError(404, 'no such run');
    return await investigation(run);
  }
  m = /^\/api\/raw\/(\d+)$/.exec(url.pathname);
  if (m && req.method === 'GET') {
    sessions.get(req);
    const r = store.raw(Number(m[1]));
    if (!r) throw new HttpError(404, 'no such record');
    return { raw: { ...r, body: JSON.parse(r.body) } };
  }
  return null;
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  const url = new URL(req.url, 'http://api');
  const t0 = Date.now();
  // One JSON line per request: never headers, bodies or tokens. Quiet polls.
  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode < 400) return;
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0, run_id: res.runId || null }));
  });
  if (session.crossSiteWrite(req)) return send(res, 403, { ok: false, error: 'refused: this request came from another site' });
  try {
    let out = await idRoute(req, res, url);
    if (out === null) {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        const known = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`));
        return send(res, known ? 405 : 404, { ok: false, error: known ? 'method not allowed' : 'not found' });
      }
      out = await handler(req, res, url);
    }
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    if (e instanceof session.Unauthenticated) return send(res, 401, { ok: false, error: e.message });
    if (e instanceof session.Refused || e instanceof HttpError || e instanceof CaseError || e instanceof IssuerError) return send(res, e.status, { ok: false, error: e.message });
    if (e instanceof VaultError) return send(res, 502, { ok: false, error: e.message });
    console.error(`[identity-api] ${req.method} ${url.pathname}:`, e?.stack || e);
    return send(res, 500, { ok: false, error: 'internal error' });
  }
});

// The console token is periodic (24h): renew it while the API runs (D14).
async function renewConsole() {
  try {
    const r = await call(consoleToken(), 'POST', ns('auth/token/renew-self'));
    if (!r.ok) console.error(`[identity-api] console token renew: HTTP ${r.status} ${r.errors[0] || ''}`);
  } catch (e) {
    console.error(`[identity-api] console token renew: ${e.message}`);
  }
}

if (process.env.NODE_ENV !== 'test') {
  if (store.meta('ingest_since') === null) store.setMeta('ingest_since', new Date(0).toISOString());
  const interrupted = store.markInterrupted();
  if (interrupted) console.log(JSON.stringify({ at: new Date().toISOString(), runs_interrupted: interrupted }));
  server.listen(PORT, () => console.log(`[identity-api] listening on :${PORT}, Vault ${VAULT_NODES.join(' ')}`));
  renewConsole();
  setInterval(renewConsole, 3_600_000).unref();
  // Files every second; lease lookups every tenth cycle (each lookup is a
  // Vault request too).
  let n = 0;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await collector.cycle({ leases: n++ % 10 === 0 });
    } catch (e) {
      console.error(`[identity-api] collector: ${e.message}`);
    } finally {
      running = false;
    }
  }, 1_000).unref();
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
}
