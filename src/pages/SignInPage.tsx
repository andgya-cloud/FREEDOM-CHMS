import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '../state/AuthContext';
import { friendlyError } from '../lib/errors';
import { isSharedDevice } from '../lib/useIdleSignOut';
import { PasswordInput } from '../components/PasswordInput';
import { writePref } from '../lib/storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export function SignInPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  // Password only, by default (Andy, 2026-10-24): the server finds whose password it is.
  const [withEmail, setWithEmail] = useState(false);
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState(isSharedDevice);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    writePref('sharedDevice', shared ? 'true' : 'false');
    try {
      if (withEmail) {
        await signIn(email, password);
      } else {
        const found = await httpsCallable<{ password: string }, { email: string }>(functions, 'findPasswordAccount')({ password });
        await signIn(found.data.email, password);
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setError(e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal' ? e.message.replace(/\s*\[\d+\]$/, '') : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <img src="/logo-mark.png" alt="" width={72} height={72} />
      <h1>Insight-IQ</h1>
      <p className="tagline">The People Compass</p>
      <p className="muted">{withEmail ? 'Sign in with the account the pastor gave you.' : 'Type the password the pastor gave you.'}</p>
      <form onSubmit={submit} className="form">
        {withEmail && (
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <PasswordInput id={passwordId} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>This is a shared device (sign out automatically when not in use)</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn btn-quiet btn-block" onClick={() => { setWithEmail((w) => !w); setError(''); }}>
          {withEmail ? 'Sign in with your password only' : 'Sign in with email and password instead'}
        </button>
      </form>
      <p className="muted small">Forgot your password? Ask the pastor to reset it.</p>
    </div>
  );
}
