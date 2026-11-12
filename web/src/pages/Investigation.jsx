// pages/Investigation.jsx: one case run, followed from the request to its use
// (input/01.md "the access investigation", 02's decision panel, 03's states).
// Configured context and what Vault recorded are shown side by side and never
// merged: a configured ceiling is not proof it was evaluated.
import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useHashParam, useResource } from '../hooks.js';
import { useAuth, SignInNotice, ErrorNotice, Mono, Drawer, Loading, tidy } from '../components/ui.jsx';
import { Hero, Chain, Lanes, SourceChip, EvidenceState, STATE_TEXT, when } from '../components/evidence.jsx';

function verdict(inv) {
  const d = inv.decision;
  if (!d) return 'Waiting for the audit record of this run.';
  if (d.outcome === 'denied') return `Vault denied it: ${d.code}. Nothing was issued.`;
  const used = inv.chain.find((l) => l.link === 'used');
  const version = /version (\d+)/.exec(inv.chain.find((l) => l.link === 'issued').detail)?.[1] || '(not in the record)';
  const kind = inv.case.secret_kind === 'leased_dynamic' ? 'a database credential' : `version ${version} of the secret`;
  const tail = { Correlated: 'and a downstream source shows it used', Partial: 'and nothing downstream shows it used yet', Unmatched: 'and nothing downstream shows it used', Unknown: 'but the downstream source could not be read' }[used.state] || '';
  const revoked = inv.afterRevoke.length ? ' Then the lease was revoked: the open session stayed connected and lost its privileges.' : '';
  return `Vault allowed it and issued ${kind}, ${tail}.${revoked}`;
}

function PolicyList({ names, texts }) {
  if (!names?.length) return <span className="dim">none</span>;
  return (
    <span className="policy-list">
      {names.map((n) =>
        texts?.[n] ? (
          <details key={n} className="policy">
            <summary>
              <Mono>{n}</Mono>
            </summary>
            <pre className="said-json">{texts[n]}</pre>
          </details>
        ) : (
          <Mono key={n}>{n}</Mono>
        ),
      )}
    </span>
  );
}

function Decision({ inv }) {
  const d = inv.decision;
  const cfg = inv.configured || {};
  const obo = inv.case.flow === 'agent_obo';
  const granted = (p) => d?.granting_policies?.includes(p);
  return (
    <section className="vg-card stack" aria-labelledby="dec-h">
      <div className="card-head">
        <h3 id="dec-h">The authorization decision</h3>
        {d && <span className={`vg-pill vg-pill--${d.outcome === 'allowed' ? 'healthy' : 'rejected'}`}>{d.outcome}</span>}
      </div>
      {!d ? (
        <p className="dim">No response entry in the audit log yet.</p>
      ) : (
        <>
          <h4 className="sub-h">What Vault recorded</h4>
          <dl className="facts">
            <dt>Outcome</dt>
            <dd>{d.outcome === 'allowed' ? 'allowed (the response carries no error)' : <code className="said-error">{tidy(d.error)}</code>}</dd>
            <dt>Granting policies</dt>
            <dd>{d.granting_policies.length ? d.granting_policies.map((p) => <Mono key={p}>{p}</Mono>) : <span className="dim">none recorded</span>}</dd>
            {d.authorization_details && (
              <>
                <dt>RAR in the token</dt>
                <dd>
                  {d.authorization_details.map((r) => (
                    <Mono key={r.path}>
                      {r.capabilities.join(',')} {r.path}
                    </Mono>
                  ))}
                </dd>
              </>
            )}
            {d.jwt && (
              <>
                <dt>Token</dt>
                <dd>
                  JWT from <Mono>{d.jwt.issuer}</Mono>, id <Mono>{d.jwt.unique_id}</Mono>
                </dd>
              </>
            )}
            <dt>Purpose</dt>
            <dd>
              <Mono>{d.purpose || 'none'}</Mono> <span className="label">declared</span>
            </dd>
          </dl>
          <h4 className="sub-h">What was configured</h4>
          <dl className="facts">
            <dt>{obo ? "Noor's baseline" : 'Baseline'}</dt>
            <dd>
              <PolicyList names={cfg.baseline} texts={cfg.policy_texts} />
              {obo && d.outcome === 'allowed' && cfg.baseline?.some(granted) && <span className="dim"> recorded as granting</span>}
            </dd>
            {obo && (
              <>
                <dt>Agent ceiling</dt>
                <dd>
                  <PolicyList names={cfg.ceiling} texts={cfg.policy_texts} />
                  {d.outcome === 'allowed' && cfg.ceiling?.some(granted) && <span className="dim"> recorded as granting</span>}
                  {d.code === 'CEILING_POLICY_DENIED' && <span className="said-status bad"> Vault named the ceiling</span>}
                </dd>
              </>
            )}
            {cfg.rar && (
              <>
                <dt>RAR the issuer put in</dt>
                <dd>
                  {cfg.rar.map((r) => (
                    <Mono key={r.path}>
                      {r.capabilities.join(',')} {r.path}
                    </Mono>
                  ))}
                  {['RAR_NO_MATCH', 'RAR_MISSING'].includes(d.code) && <span className="said-status bad"> Vault named the RAR</span>}
                </dd>
              </>
            )}
          </dl>
          <p className="explain">Configuration explains a decision; only the recorded lines prove one. An agent's own policies are not evaluated when it acts for a person.</p>
        </>
      )}
    </section>
  );
}

export default function Investigation() {
  const me = useAuth();
  const param = useHashParam();
  const cases = useResource('cases', '/api/cases');
  const latest = (cases.data?.cases || []).map((c) => c.last_run).filter(Boolean).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  const id = param || latest?.id || null;
  if (!me.signedIn) return <SignInNotice />;
  if (!id)
    return (
      <Hero title="No run to investigate yet." lede="Run a case first; its investigation opens here.">
        <a className="hero-link" href="#/cases">
          Go to the cases
        </a>
      </Hero>
    );
  return <RunView key={id} id={id} />;
}

// One run's investigation; polls every 3 s until nothing more can change.
function RunView({ id }) {
  const inv = useResource(`investigation ${id}`, `/api/runs/${id}`);
  const [raw, setRaw] = useState(null);
  const settled = inv.data?.settled;
  const { reload } = inv;
  useEffect(() => {
    if (settled) return undefined;
    const t = setInterval(() => reload(), 3000);
    return () => clearInterval(t);
  }, [settled, reload]);
  const openRaw = async (rawId) => {
    try {
      setRaw(await call(`Raw record ${rawId}`, `/api/raw/${rawId}`, { quiet: true }));
    } catch (e) {
      setRaw({ error: e.message });
    }
  };

  const d = inv.data;
  if (!d?.chain) return inv.error ? <ErrorNotice error={inv.error} title="No investigation" /> : <Loading label="Reading the evidence" />;
  return (
    <>
      <Hero kicker={`Case ${d.case.id}, run ${d.run.id}`} title={d.case.title} lede={verdict(d)}>
        <Lanes subject={d.principals?.subject} actor={d.principals?.actor} target={d.case.secret_path} kind={d.case.secret_kind} />
      </Hero>
      <section className="vg-card stack" aria-labelledby="chain-h">
        <div className="card-head">
          <h3 id="chain-h">The evidence chain</h3>
          <span className="card-sub">{d.settled ? 'settled' : 'still collecting: refreshes every 3 s'}</span>
        </div>
        <Chain chain={d.chain} />
        <ul className="legend" aria-label="What the states mean">
          {Object.entries(STATE_TEXT).map(([k, v]) => (
            <li key={k}>
              <EvidenceState state={k} /> {v}
            </li>
          ))}
        </ul>
      </section>
      <div className="grid-2">
        <Decision inv={d} />
        <section className="vg-card stack" aria-labelledby="story-h">
          <div className="card-head">
            <h3 id="story-h">The access story</h3>
            <span className="card-sub">every fact, with its source; open one to see the record as read</span>
          </div>
          <ol className="story">
            {d.story.map((s) => (
              <li key={s.id}>
                <span className="when">{when(s.at)}</span>
                <span className="what">
                  <button type="button" className="link-button" onClick={() => openRaw(s.raw_id)}>
                    {s.text}
                  </button>
                  <SourceChip source={s.source} label={s.label} />
                </span>
              </li>
            ))}
          </ol>
          {d.afterRevoke.length > 0 && (
            <div className="inline-notice warn" role="note">
              <strong>After the revoke, PostgreSQL saw this user again</strong>
              <ul className="vault-errors">
                {d.afterRevoke.map((a) => (
                  <li key={a.id}>
                    {when(a.at)} <Mono>{a.message}</Mono>
                  </li>
                ))}
              </ul>
              <p className="m-0">Revoking a credential dropped the role and its privileges; it did not close a session that was already open.</p>
            </div>
          )}
        </section>
      </div>
      <Drawer open={Boolean(raw)} title="The record as read" onClose={() => setRaw(null)}>
        {raw?.raw ? (
          <>
            <dl className="facts">
              <dt>Source</dt>
              <dd>{raw.raw.source}</dd>
              <dt>Source id</dt>
              <dd>
                <Mono>{raw.raw.source_event_id}</Mono>
              </dd>
              <dt>Source time</dt>
              <dd>{raw.raw.source_timestamp}</dd>
              <dt>Ingested</dt>
              <dd>{raw.raw.ingested_at}</dd>
            </dl>
            <p className="drawer-intro">Exactly as the source wrote it. Vault's audit keeps HMAC on every string it was not told to show.</p>
            <pre className="said-json">{JSON.stringify(raw.raw.body, null, 2)}</pre>
          </>
        ) : (
          <p>{raw?.error}</p>
        )}
      </Drawer>
    </>
  );
}
