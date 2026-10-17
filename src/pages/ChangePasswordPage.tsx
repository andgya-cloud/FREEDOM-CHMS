import { useState, type FormEvent } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, functions } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { friendlyError } from '../lib/errors';
import { passwordProblems } from '../../functions/src/shared/password';
import { PasswordChecklist } from '../components/PasswordChecklist';

export function ChangePasswordPage() {
  const { profile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const email = profile?.email ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (passwordProblems(password, email).length) return setError('Choose a stronger password.');
    if (password !== confirm) return setError('The two passwords are different.');
    setBusy(true);
    try {
      await httpsCallable(functions, 'changeMyPassword')({ password });
      // Changing a password ends existing sessions, so sign straight back in with the new one.
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <h1>Choose your own password</h1>
      <p className="muted">The pastor gave you a temporary password. Pick a new one that only you know.</p>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <PasswordChecklist password={password} email={email} />
        <label className="field">
          <span>Type it again</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="btn btn-quiet btn-block" onClick={() => void signOut()}>Sign out</button>
      </form>
    </div>
  );
}
