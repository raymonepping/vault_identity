// pages/Identities.jsx: entities and their doors (aliases), the Agent
// Registry, and the workload's role. One person can come through two doors
// and still be one entity (input/01.md, image 1).
import { useResource } from '../hooks.js';
import { useAuth, SignInNotice, ErrorNotice, Mono, Loading } from '../components/ui.jsx';
import { Hero } from '../components/evidence.jsx';

export default function Identities() {
  const me = useAuth();
  const r = useResource('identities', '/api/identities');
  if (!me.signedIn) return <SignInNotice />;
  const d = r.data;
  return (
    <>
      <Hero
        kicker="Vault identity, read with the console token"
        title="One entity per principal, one alias per door."
        lede="Policies on the entity follow the principal through every door. An agent also needs an Agent Registry record: its owner and the ceiling it may never exceed for a person."
      />
      <ErrorNotice error={r.error} title="Vault refused the identity read" />
      {!d ? (
        <Loading />
      ) : (
        <div className="grid-2">
          {d.entities.map((e) => (
            <section key={e.id} className="vg-card stack" aria-labelledby={`e-${e.id}`}>
              <div className="card-head">
                <h3 id={`e-${e.id}`}>{e.name}</h3>
                {e.registry ? <span className="vg-pill vg-pill--approved">registered agent</span> : null}
              </div>
              <dl className="facts">
                <dt>Entity</dt>
                <dd>
                  <Mono>{e.id}</Mono>
                </dd>
                <dt>Policies</dt>
                <dd>{e.policies.length ? e.policies.map((p) => <Mono key={p}>{p}</Mono>) : <span className="dim">none on the entity</span>}</dd>
                <dt>Doors</dt>
                <dd>
                  <ul className="plain-list">
                    {e.aliases.map((a) => (
                      <li key={`${a.door}-${a.name}`}>
                        <Mono>{a.name}</Mono> <span className="dim">through {a.door}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
                {Object.keys(e.metadata).length > 0 && (
                  <>
                    <dt>Metadata</dt>
                    <dd>
                      {Object.entries(e.metadata).map(([k, v]) => (
                        <Mono key={k}>
                          {k}={v}
                        </Mono>
                      ))}{' '}
                      <span className="label">declared</span>
                    </dd>
                  </>
                )}
                {e.registry && (
                  <>
                    <dt>Owner</dt>
                    <dd>{e.registry.owner}</dd>
                    <dt>Ceiling</dt>
                    <dd>
                      {e.registry.ceiling_policies.map((p) => (
                        <Mono key={p}>{p}</Mono>
                      ))}
                    </dd>
                    <dt>Purpose</dt>
                    <dd>{e.registry.description}</dd>
                  </>
                )}
              </dl>
            </section>
          ))}
          {d.workload_role && (
            <section className="vg-card stack" aria-labelledby="wl-h">
              <div className="card-head">
                <h3 id="wl-h">payments-batch (AppRole role)</h3>
              </div>
              <p className="explain">Its entity appears after its first login, named by Vault. The secret id carries its labels, which land in the token metadata of every request it makes.</p>
              <dl className="facts">
                <dt>Policies</dt>
                <dd>
                  {d.workload_role.token_policies.map((p) => (
                    <Mono key={p}>{p}</Mono>
                  ))}
                </dd>
                <dt>Token TTL</dt>
                <dd className="num">{d.workload_role.token_ttl} s</dd>
              </dl>
            </section>
          )}
        </div>
      )}
    </>
  );
}
