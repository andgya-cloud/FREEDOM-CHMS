import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { passwordProof } from '../lib/pettyPin';

/**
 * "Do you want to delete?" with the person's own password (Andy, 2026-11-05, 1B), so nothing on a child's
 * profile is deleted by a stray tap.
 */
export function PasswordConfirm({ open, title, body, confirmLabel = 'Yes, delete', onConfirm, onCancel }: {
  open: boolean; title: string; body?: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setPassword(''); setError(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  async function go() {
    setBusy(true); setError('');
    try { await passwordProof(user?.uid ?? '', user?.email ?? '', password); onConfirm(); }
    catch { setError('That password is not right. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (password) void go(); }}>
        <label className="field"><span>Your password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>No</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !password}>{busy ? 'Checking…' : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
