import { useState, type FormEvent } from 'react';
import { httpsCallable } from 'firebase/functions';
import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth, functions } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { friendlyError } from '../lib/errors';
import { passwordProblems } from '../../functions/src/shared/password';
import { PasswordInput } from '../components/PasswordInput';
import { PasswordChecklist } from '../components/PasswordChecklist';

/** The forced first-time change, or (voluntary) Settings, My password. */
export function ChangePasswordPage({ voluntary = false }: { voluntary?: boolean }) {
  const { profile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const email = auth.currentUser?.email ?? profile?.email ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (passwordProblems(password, email).length) return setError('Choose a stronger password.');
    if (password !== confirm) return setError('The two passwords are different.');
    setBusy(true);
    try {
      // A fresh sign-in is needed to change a password; the current one proves it.
      if (voluntary && auth.currentUser) await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(email, current));
      if (voluntary) await auth.currentUser?.getIdToken(true);
      await httpsCallable(functions, 'changeMyPassword')({ password });
      // Changing a password ends existing sessions, so sign straight back in with the new one.
      await signInWithEmailAndPassword(auth, email, password);
      if (voluntary) { setDone(true); setPassword(''); setConfirm(''); setCurrent(''); }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      const msg = (err as { message?: string })?.message ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') setError('Your current password is not right.');
      else if (code.startsWith('functions/') && msg) setError(msg.replace(/\s*\[\d+\]$/, ''));
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <h1>{voluntary ? 'My password' : 'Choose your own password'}</h1>
      <p className="muted">{voluntary ? 'Choose a new password. You can then sign in by typing just this password.' : 'The pastor gave you a temporary password. Pick a new one that only you know.'}</p>
      {done && <p className="small" role="status">✓ Saved. Next time, type just this password to sign in.</p>}
      <form onSubmit={submit} className="form">
        {voluntary && (
          <label className="field">
            <span>Current password</span>
            <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>New password</span>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <PasswordChecklist password={password} email={email} />
        <label className="field">
          <span>Type it again</span>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        {voluntary
          ? <Link className="btn btn-quiet btn-block" to="/settings">Back to settings</Link>
          : <button type="button" className="btn btn-quiet btn-block" onClick={() => void signOut()}>Sign out</button>}
      </form>
    </div>
  );
}
