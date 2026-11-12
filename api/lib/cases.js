// lib/cases.js: runs one case of config/cases.json with the principal's own
// credential (D11) and records what each step got back, minus secrets. The
// evidence comes from the collector, not from here: this file only acts.
//   human            Noor's session token (her userpass login)
//   agent_autonomous a JWT from the lab issuer, sub = the agent
//   agent_obo        a delegation JWT, sub = noor, act.sub = the agent; only
//                    while Noor herself is signed in (her entity, checked)
//   workload         an AppRole login with the secret id Ansible minted
// One run at a time. Every Vault call carries the run's X-Correlation-Id and
// the case's purpose code (X-Observatory-Purpose, D10).
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { said } from './said.js';

export class CaseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SUMMARY_SQL = 'SELECT count(*)::int AS entries, sum(amount_cents)::bigint AS balance_cents FROM ledger_entries';

// What a step may show of Vault's answer: a KV read keeps its metadata (version,
// labels), never the value; a credential keeps its username and lease, never
// the password.
export function safeSaid(as, method, path, r) {
  const s = said(as, method, path, r);
  const d = r?.json?.data;
  if (path.includes('/kv/data/')) s.data = d?.metadata ? { metadata: d.metadata } : null;
  else if (path.includes('/database/creds/')) s.data = d ? { username: d.username } : null;
  if (r?.json?.lease_id) s.lease = { lease_id: r.json.lease_id, lease_duration: r.json.lease_duration, renewable: r.json.renewable };
  return s;
}

export function createCases({ cases, call, ns, consoleToken, issuer, store, newPgClient, approleDir, entityIdOf, now = () => new Date() }) {
  let busy = false;

  async function credential(kase, session, headers) {
    const p = cases.principals[kase.principal];
    switch (kase.flow) {
      case 'human':
        return { token: session.token, actor: `${kase.principal} (her session)` };
      case 'agent_autonomous':
        return { token: issuer.mint({ sub: p.subject, rar: kase.rar }), actor: `${kase.principal} (JWT, sub ${p.subject})` };
      case 'agent_obo': {
        const subjectEntity = await entityIdOf(kase.subject);
        if (!subjectEntity || session.entity !== subjectEntity)
          throw new CaseError(403, `only ${kase.subject}, signed in, can delegate to ${kase.principal}`);
        return { token: issuer.mint({ sub: kase.subject, act: p.actor, rar: kase.rar }), actor: `${kase.principal} for ${kase.subject} (delegation JWT)` };
      }
      case 'workload': {
        const body = {
          role_id: readFileSync(`${approleDir}/role_id`, 'utf8').trim(),
          secret_id: readFileSync(`${approleDir}/secret_id`, 'utf8').trim(),
        };
        const r = await call(null, 'POST', ns('auth/approle/login'), { body, headers });
        if (!r.ok) throw new CaseError(502, `${kase.principal} could not log in: ${r.errors[0] || r.status}`);
        // Not revoked after the run: revoking the token would revoke the lease
        // it created too, and case 9 is about a credential left unused. The
        // token expires by itself (token_ttl 300 s).
        return { token: r.json.auth.client_token, actor: `${kase.principal} (AppRole)` };
      }
      default:
        throw new CaseError(500, `unknown flow ${kase.flow}`);
    }
  }

  function appEvent(corr, fact) {
    const at = now().toISOString();
    store.add({ source: 'application', id: randomUUID(), at, body: { at, correlation_id: corr, ...fact }, facts: [{ kind: 'app.event', at, correlation_id: corr, ...fact }] });
  }

  async function run(session, caseId) {
    const kase = cases.cases.find((c) => c.id === Number(caseId));
    if (!kase) throw new CaseError(404, `no case ${caseId}`);
    if (busy) throw new CaseError(409, 'another case is running; wait for it');
    busy = true;
    const secret = cases.secrets[kase.secret];
    const corr = `run-${kase.id}-${randomBytes(4).toString('hex')}`;
    const run8 = corr.slice(-8);
    const headers = { 'X-Correlation-Id': corr, 'X-Observatory-Purpose': kase.purpose };
    const rec = { id: corr, case_id: kase.id, principal: kase.principal, correlation_id: corr, started_at: now().toISOString(), steps: [] };
    store.saveRun(rec);
    const clients = [];
    let cred = null;
    let creds = null; // { username, password, lease_id }: memory only, this run only
    let kvVersion = null;
    let outcome = 'allowed';
    const connect = async () => {
      const c = newPgClient({ host: 'postgres', port: 5432, database: 'finance', user: creds.username, password: creds.password, application_name: `${kase.principal}:${run8}`, connectionTimeoutMillis: 5000 });
      c.on('error', () => {}); // a dropped connection must not crash the API
      await c.connect();
      return c;
    };
    const dbStep = async (step, fn) => {
      try {
        rec.steps.push({ step, ...(await fn()) });
      } catch (e) {
        rec.steps.push({ step, db: { ok: false, error: e.message, code: e.code || null } });
      }
    };
    try {
      cred = await credential(kase, session, headers);
      for (const step of kase.steps) {
        if (outcome === 'denied') break;
        if (step === 'read' || step === 'creds') {
          const path = ns(secret.path);
          const r = await call(cred.token, 'GET', path, { headers });
          rec.steps.push({ step, actor: cred.actor, vault: safeSaid(cred.actor, 'GET', path, r) });
          if (!r.ok) { outcome = 'denied'; continue; }
          if (step === 'read') kvVersion = r.json?.data?.metadata?.version ?? null;
          else creds = { username: r.json.data.username, password: r.json.data.password, lease_id: r.json.lease_id };
        } else if (step === 'connect') {
          await dbStep(step, async () => {
            clients.push(await connect());
            return { db: { ok: true, user: creds.username, application_name: `${kase.principal}:${run8}` } };
          });
        } else if (step === 'query') {
          await dbStep(step, async () => {
            const c = clients.at(-1);
            if (!c) throw new Error('no open session');
            const r = await c.query(SUMMARY_SQL);
            return { db: { ok: true, rows: r.rows } };
          });
        } else if (step === 'disconnect') {
          await dbStep(step, async () => {
            for (const c of clients.splice(0)) await c.end();
            return { db: { ok: true } };
          });
        } else if (step === 'reconnect') {
          await dbStep(step, async () => {
            const c = await connect();
            clients.push(c);
            return { db: { ok: true, note: 'a new login with the same credential worked' } };
          });
        } else if (step === 'revoke') {
          const path = ns('sys/leases/revoke');
          const r = await call(consoleToken(), 'POST', path, { body: { lease_id: creds.lease_id }, headers });
          rec.steps.push({ step, actor: 'console (the responder)', vault: said('console', 'POST', path, r) });
          if (r.ok) appEvent(corr, { action: 'revoked', actor: 'console (the responder)', lease_id: creds.lease_id, detail: 'the responder revoked the lease while a session was open' });
        } else if (step === 'app-event') {
          appEvent(corr, { action: 'used', actor: kase.principal, detail: `${kase.principal} used ${kase.secret} version ${kvVersion} to call the ledger API (the lab's simulated call)` });
          rec.steps.push({ step, application: { recorded: true } });
        }
      }
    } catch (e) {
      outcome = 'failed';
      rec.steps.push({ step: 'error', error: e.message });
      throw e;
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      creds = null;
      rec.finished_at = now().toISOString();
      rec.outcome = outcome;
      store.saveRun(rec);
      busy = false;
    }
    return rec;
  }

  return { run, busy: () => busy };
}
