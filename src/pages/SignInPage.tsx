import { useId, useState, type FormEvent } from 'react';
import { useAuth } from '../state/AuthContext';
import { friendlyError } from '../lib/errors';
import { isSharedDevice } from '../lib/useIdleSignOut';
import { PasswordInput } from '../components/PasswordInput';
import { writePref } from '../lib/storage';

export function SignInPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
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
      await signIn(email, password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <img src="/logo-mark.png" alt="" width={72} height={72} />
      <h1>Insight-IQ</h1>
      <p className="tagline">The People Compass</p>
      <p className="muted">Sign in with the account the pastor gave you.</p>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
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
      </form>
      <p className="muted small">Forgot your password? Ask the pastor to reset it.</p>
    </div>
  );
}
