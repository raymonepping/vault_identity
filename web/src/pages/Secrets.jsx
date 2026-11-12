// pages/Secrets.jsx: the KV secrets with their labels (descriptive, not
// proof), the database role, and every credential Vault issued in a run.
import { useResource } from '../hooks.js';
import { useAuth, SignInNotice, ErrorNotice, Mono, TableScroll, Loading } from '../components/ui.jsx';
import { Hero, FlowChip, when } from '../components/evidence.jsx';

export default function Secrets() {
  const me = useAuth();
  const r = useResource('secrets', '/api/secrets', { intervalMs: me.signedIn ? 5000 : 0 });
  if (!me.signedIn) return <SignInNotice />;
  const d = r.data;
  return (
    <>
      <Hero
        kicker="Static and dynamic"
        title="A KV read returns a version. A database request issues a credential with a lease."
        lede="Labels say what a secret is for. They do not prove who used it or why; only the evidence chain can show use."
      />
      <ErrorNotice error={r.error} title="Vault refused the read" />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="grid-2">
            {d.kv.map((k) => (
              <section key={k.key} className="vg-card stack" aria-labelledby={`kv-${k.key}`}>
                <div className="card-head">
                  <h3 id={`kv-${k.key}`}>{k.key}</h3>
                  <span className="card-sub">version {k.current_version}</span>
                </div>
                <Mono>{k.path}</Mono>
                <dl className="facts">
                  {Object.entries(k.labels || {}).map(([lk, lv]) => (
                    <div key={lk} className="facts__row">
                      <dt>{lk}</dt>
                      <dd>{lv}</dd>
                    </div>
                  ))}
                </dl>
                <p className="dim">
                  KV v2 custom_metadata: descriptive labels, not proof <span className="label">declared</span>
                </p>
              </section>
            ))}
          </div>
          <section className="vg-card stack" aria-labelledby="cred-h">
            <div className="card-head">
              <h3 id="cred-h">Database credentials issued</h3>
              {d.database_role && (
                <span className="card-sub">
                  role <Mono>finance-readonly</Mono>, TTL {d.database_role.default_ttl} s, max {d.database_role.max_ttl} s
                </span>
              )}
            </div>
            {d.credentials.length === 0 ? (
              <p className="dim">None yet. Run case 2, 4, 6, 9 or 10.</p>
            ) : (
              <TableScroll label="Database credentials issued">
                <table className="vg-table">
                  <thead>
                    <tr>
                      <th scope="col">Issued</th>
                      <th scope="col">Requested by</th>
                      <th scope="col">Database user</th>
                      <th scope="col">Sessions</th>
                      <th scope="col">Lease</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.credentials.map((c) => (
                      <tr key={c.lease_id}>
                        <td className="num">
                          <a href={`#/run/${c.correlation_id}`}>{when(c.at)}</a>
                        </td>
                        <td>
                          <span className="cell-stack">
                            {c.requested_by}
                            <FlowChip flow={c.flow} />
                          </span>
                        </td>
                        <td>
                          <Mono>{c.db_user}</Mono>
                        </td>
                        <td className="num">{c.sessions}</td>
                        <td>
                          <span className={`vg-pill vg-pill--${c.state === 'active' ? 'healthy' : c.state === 'ended' ? 'manual' : 'pending'}`}>{c.state}</span>
                          {c.state === 'active' && <span className="dim"> until {when(c.expire_time)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            <p className="explain">The password is never shown or stored here. The username is in the audit log in clear by design (audit_non_hmac_response_keys); the password stays HMAC'd.</p>
          </section>
        </>
      )}
    </>
  );
}
