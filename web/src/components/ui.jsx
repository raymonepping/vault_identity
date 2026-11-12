// components/ui.jsx: small shared pieces (vault_dance, vault_codex).
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { call } from '../api.js';
import { X, LogIn } from 'lucide-react';

// The signed-in person and what Vault allows them (GET /api/me), plus
// refresh() after a sign-in or sign-out.
export const AuthContext = createContext({ signedIn: false, refresh: () => {} });
export const useAuth = () => useContext(AuthContext);

// Vault's errors arrive as "1 error occurred:\n\t* permission denied\n\n".
const tidy = (v) => String(v).replace(/^\d+ errors? occurred:\s*/, '').replace(/^\*\s*/, '').replace(/\s+/g, ' ').trim();


// An error from the API, with Vault's own error lines verbatim.
export { tidy };

export function ErrorNotice({ error, title }) {
  if (!error) return null;
  if (error.status === 401) return <SignInNotice />;
  const vault = (error.body?.vault?.errors || []).map(tidy);
  return (
    <div className="inline-notice error" role="alert">
      <strong>{title || 'Refused'}</strong>
      {error.status ? <span className="vault-status"> HTTP {error.status}</span> : null}
      {vault.length ? (
        <ul className="vault-errors">
          {vault.map((v) => (
            <li key={v}>
              Vault said: <code>{v}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0">{error.message}</p>
      )}
    </div>
  );
}

// The presenter signs in as Noor (D11). The password goes to the API, which
// logs her in to Vault and keeps the token; the browser keeps only a session
// cookie. make people-copy-password puts it on the clipboard.
export function SignInNotice() {
  const { refresh } = useAuth();
  const [user, setUser] = useState('noor');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('Sign in', '/api/session', { method: 'POST', body: { username: user, password } });
      setPassword('');
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vg-card signin-notice" aria-labelledby="signin-h">
      <h3 id="signin-h">Sign in as Noor</h3>
      <p>
        Noor Haddad signs in with her own Vault login. The agents and the batch job act with their own credentials; a delegation needs her signed in. Password: <code className="mono">make people-copy-password</code>.
      </p>
      <form className="signin-form" onSubmit={submit}>
        <label className="form-field" htmlFor="signin-user">
          <span>User</span>
          <input id="signin-user" name="username" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="form-field" htmlFor="signin-pw">
          <span>Password</span>
          <input id="signin-pw" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="primary-button" disabled={busy || !password}>
          <LogIn size={14} aria-hidden="true" /> {busy ? 'Asking Vault…' : 'Sign in'}
        </button>
      </form>
      {error && (
        <p className="inline-notice error" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}

// A table that may scroll sideways on a phone: focusable and named, so a
// keyboard can scroll it (axe scrollable-region-focusable).
export function TableScroll({ label, children }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export function Mono({ children, title }) {
  return (
    <code className="mono" title={title}>
      {children}
    </code>
  );
}


// Right-hand drawer; Escape and the backdrop close it; focus moves in.
export function Drawer({ open, title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="vg-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="vg-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="vg-drawer__header">
          <h2 className="vg-drawer__title">{title}</h2>
          <button type="button" className="vg-btn vg-btn--ghost" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="vg-drawer__body">{children}</div>
      </aside>
    </>
  );
}


export function Loading({ label = 'Asking Vault…' }) {
  return (
    <div className="vg-loading" role="status">
      <span className="vg-live-dot" aria-hidden="true" />
      {label}
    </div>
  );
}

