// pages/Timeline.jsx: every fact the collector stored, newest first, with its
// source. Filter by source; page back with "older".
import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useAuth, SignInNotice, ErrorNotice, Loading } from '../components/ui.jsx';
import { Hero, SourceChip, when } from '../components/evidence.jsx';

const KINDS = [
  { id: '', label: 'Everything' },
  { id: 'vault', label: 'Vault audit' },
  { id: 'pg', label: 'PostgreSQL' },
  { id: 'app', label: 'Application' },
  { id: 'lease', label: 'Leases' },
];

export default function Timeline() {
  const me = useAuth();
  const [kind, setKind] = useState('');
  const [facts, setFacts] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const load = async (before = null) => {
    try {
      const q = new URLSearchParams({ ...(kind ? { kind } : {}), ...(before ? { before } : {}) });
      const r = await call('Timeline', `/api/timeline?${q}`, { quiet: true });
      setFacts((f) => (before ? [...(f || []), ...r.facts] : r.facts));
      setNext(r.next);
      setError(null);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    if (me.signedIn) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, me.signedIn]);
  if (!me.signedIn) return <SignInNotice />;
  return (
    <>
      <Hero kicker="The evidence store" title="Every fact, as each source recorded it." lede="Request, decision, issuance, connection, refusal, renewal, revocation and expiry stay separate events." />
      <ErrorNotice error={error} title="The timeline did not load" />
      <section className="vg-card stack" aria-labelledby="tl-h">
        <div className="card-head">
          <h3 id="tl-h">Facts</h3>
          <div className="filters" role="group" aria-label="Filter by source">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {!facts ? (
          <Loading label="Reading the store" />
        ) : facts.length === 0 ? (
          <p className="dim">Nothing yet. Run a case.</p>
        ) : (
          <ol className="timeline">
            {facts.map((f) => (
              <li key={f.id}>
                <span className="when">{when(f.at)}</span>
                <SourceChip source={f.source} label={f.label} />
                <span className="what">
                  {f.text}
                  {f.correlation_id?.startsWith('run-') && (
                    <a href={`#/run/${f.correlation_id}`} className="dim">
                      {f.correlation_id}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        {next && (
          <button type="button" className="secondary-button" onClick={() => load(next)}>
            Older facts
          </button>
        )}
      </section>
    </>
  );
}
