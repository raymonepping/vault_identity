// pages/Cases.jsx: the ten cases of config/cases.json, grouped by how the
// caller proves who it is. Run sends only the case number: the API takes the
// path, the RAR and the purpose from the case (D12).
import { useState } from 'react';
import { Play } from 'lucide-react';
import { call } from '../api.js';
import { useResource } from '../hooks.js';
import { useAuth, SignInNotice, ErrorNotice, Mono } from '../components/ui.jsx';
import { Hero, FlowChip } from '../components/evidence.jsx';

const GROUPS = [
  { flow: 'human', title: 'A person', text: 'Noor signs in through userpass; Vault resolves her entity.' },
  { flow: 'agent_autonomous', title: 'An agent acting as itself', text: 'The ledger agent presents a JWT from the lab issuer; Vault needs its Agent Registry record and the RAR in the token.' },
  { flow: 'agent_obo', title: 'An agent acting for a person', text: "Noor's delegation token names her as subject and the finance agent as actor. Her baseline, the agent's ceiling and the RAR must all allow it." },
  { flow: 'workload', title: 'A workload', text: 'payments-batch logs in with AppRole; its secret id carries its labels.' },
];

export default function Cases() {
  const me = useAuth();
  const c = useResource('cases', '/api/cases');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (id) => {
    setBusy(id);
    setError(null);
    try {
      const r = await call(`Run case ${id}`, `/api/cases/${id}/run`, { method: 'POST' });
      window.location.hash = `#/run/${r.run.id}`;
    } catch (e) {
      setError(e);
      c.reload();
    } finally {
      setBusy(null);
    }
  };
  const cases = c.data?.cases || [];
  return (
    <>
      <Hero
        kicker="Three ways to prove who you are, two kinds of secret"
        title="Run a case and follow the secret from the request to its use."
        lede="Every case makes real requests with the principal's own credential. Vault decides; nothing on these pages simulates its answer."
      />
      {!me.signedIn && <SignInNotice />}
      <ErrorNotice error={error} title="The case did not run" />
      {me.signedIn &&
        GROUPS.map((g) => (
          <section key={g.flow} className="vg-card stack" aria-labelledby={`g-${g.flow}`}>
            <div className="card-head">
              <h3 id={`g-${g.flow}`}>{g.title}</h3>
              <FlowChip flow={g.flow} />
            </div>
            <p className="explain">{g.text}</p>
            <ul className="case-list">
              {cases
                .filter((k) => k.flow === g.flow)
                .map((k) => (
                  <li key={k.id} className="case">
                    <span className="case__num num">{k.id}</span>
                    <div className="case__body">
                      <strong>{k.title}</strong>
                      <span className="dim">
                        <Mono>{k.secret_path}</Mono>, purpose <Mono>{k.purpose}</Mono>, Vault should answer {k.expect.vault}
                        {k.expect.deniedBy ? ` (by the ${k.expect.deniedBy === 'rar' ? 'RAR' : k.expect.deniedBy})` : ''}
                      </span>
                      {k.last_run && (
                        <a className="case__last" href={`#/run/${k.last_run.id}`}>
                          Last run {new Date(k.last_run.started_at).toLocaleTimeString()}: {k.last_run.outcome || 'running'}
                        </a>
                      )}
                    </div>
                    <button type="button" className="primary-button" onClick={() => run(k.id)} disabled={busy !== null}>
                      <Play size={13} aria-hidden="true" /> {busy === k.id ? 'Running' : `Run case ${k.id}`}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </>
  );
}
