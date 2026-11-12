// pages/Overview.jsx: the four questions of input/01.md, answered from the
// evidence store, and the guiding question of input/02.md.
import { useResource } from '../hooks.js';
import { useAuth, SignInNotice, TableScroll, Mono } from '../components/ui.jsx';
import { Hero, FlowChip, when } from '../components/evidence.jsx';

export default function Overview() {
  const me = useAuth();
  const o = useResource('overview', '/api/overview', { intervalMs: me.signedIn ? 5000 : 0 });
  const d = o.data;
  return (
    <>
      <Hero
        kicker="Corvid Ledger, a fictional finance company"
        title="When an agent reads a secret for a person, who authorized it, who acted, and what happened to the credential?"
        lede="Vault records who asked and what it decided. PostgreSQL records who connected. This console joins the two and says how strong each join is."
      >
        <dl className="hero-tiles">
          <div className="vg-tile">
            <dt className="vg-tile__label">Requesters</dt>
            <dd className="vg-tile__value">{d ? d.requesters.length : '–'}</dd>
          </div>
          <div className="vg-tile">
            <dt className="vg-tile__label">Consuming applications</dt>
            <dd className="vg-tile__value">{d ? d.consumers.length : '–'}</dd>
          </div>
          <div className="vg-tile">
            <dt className="vg-tile__label">Active credentials</dt>
            <dd className="vg-tile__value">{d ? d.active_credentials.length : '–'}</dd>
          </div>
          <div className="vg-tile">
            <dt className="vg-tile__label">Worth a look</dt>
            <dd className="vg-tile__value">{d ? d.look.length : '–'}</dd>
          </div>
        </dl>
      </Hero>
      {!me.signedIn && <SignInNotice />}
      {me.signedIn && d && (
        <>
          <div className="grid-2">
            <section className="vg-card stack" aria-labelledby="who-h">
              <div className="card-head">
                <h3 id="who-h">Who has been requesting secrets?</h3>
                <span className="card-sub">Vault audit, the identity Vault resolved</span>
              </div>
              {d.requesters.length === 0 ? (
                <p className="dim">No requests yet. Run a case.</p>
              ) : (
                <TableScroll label="Requesters">
                  <table className="vg-table">
                    <thead>
                      <tr>
                        <th scope="col">Identity</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Allowed</th>
                        <th scope="col">Denied</th>
                        <th scope="col">Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.requesters.map((r) => (
                        <tr key={r.who}>
                          <td>{r.who}</td>
                          <td>
                            <FlowChip flow={r.flow} />
                          </td>
                          <td className="num">{r.allowed}</td>
                          <td className="num">{r.denied}</td>
                          <td className="num">{when(r.last)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </section>
            <section className="vg-card stack" aria-labelledby="use-h">
              <div className="card-head">
                <h3 id="use-h">Which applications are consuming them?</h3>
                <span className="card-sub">PostgreSQL log; the client declares application_name</span>
              </div>
              {d.consumers.length === 0 ? (
                <p className="dim">No PostgreSQL session with a Vault-issued user yet.</p>
              ) : (
                <ul className="plain-list">
                  {d.consumers.map((c) => (
                    <li key={c.application}>
                      <strong>{c.application}</strong> <span className="dim">{c.sessions} session(s), last {when(c.last)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="card-head">
                <h3 id="active-h">Which credentials are active?</h3>
                <span className="card-sub">sys/leases/lookup</span>
              </div>
              {d.active_credentials.length === 0 ? (
                <p className="dim">None active.</p>
              ) : (
                <ul className="plain-list">
                  {d.active_credentials.map((c) => (
                    <li key={c.lease_id}>
                      <Mono>{c.lease_id}</Mono> <span className="dim">until {when(c.expire_time)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="vg-card stack" aria-labelledby="look-h">
            <div className="card-head">
              <h3 id="look-h">What deserves a look?</h3>
              <span className="card-sub">denials, credentials never used, refusals after a revoke, reads from outside this console</span>
            </div>
            {d.look.length === 0 ? (
              <p className="dim">Nothing yet.</p>
            ) : (
              <ol className="timeline">
                {d.look.map((l, i) => (
                  <li key={`${l.at}-${i}`}>
                    <span className="when">{when(l.at)}</span>
                    <span className={`look look--${l.what.replace(/\s+/g, '-')}`}>{l.what}</span>
                    <span className="what">
                      {l.detail}
                      {l.correlation_id?.startsWith('run-') && (
                        <a href={`#/run/${l.correlation_id}`} className="dim">
                          open the investigation
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  );
}
