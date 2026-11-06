import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { myOwnProof, passwordProof } from '../lib/pettyPin';
import { isDirectorProfile } from '../../functions/src/shared/permissions';
import { friendlyError } from '../lib/errors';
import { listPhotoApprovers, type PhotoApprover } from '../lib/childPhoto';

/**
 * Taking, uploading or removing a child's photo needs the password of the Director, Andy or Doreen (Andy,
 * 2026-11-05). One of them chooses their name and types their password on this phone; `onApproved` gets the proof.
 */
export function ApprovePhoto({ open, orgId, title, body, confirmLabel = 'Approve', danger, onApproved, onCancel }: {
  open: boolean; orgId: string; title: string; body?: string; confirmLabel?: string; danger?: boolean;
  onApproved: (proof: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user, profile } = useAuth();
  // Andy approves with one tap, no password (2026-11-06).
  const andy = isDirectorProfile(profile);
  const [people, setPeople] = useState<PhotoApprover[] | null>(null);
  const [who, setWho] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPassword(''); setError(''); d.showModal();
      if (!people) listPhotoApprovers(orgId).then((list) => {
        setPeople(list);
        setWho((w) => w || (list.some((p) => p.uid === user?.uid) ? user!.uid : list.length === 1 ? list[0]!.uid : ''));
      }, (err) => setError(friendlyError(err)));
    }
    if (!open && d.open) d.close();
  }, [open, orgId, people, user]);

  async function go() {
    setBusy(true); setError('');
    if (andy) {
      try { onApproved(await myOwnProof()); } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
      return;
    }
    const p = people?.find((x) => x.uid === who);
    if (!p) { setBusy(false); setError('Choose who is approving.'); return; }
    try { onApproved(await passwordProof(p.uid, p.emails, password)); }
    catch { setError('That password is not right. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2>{title}</h2>
      <p className="small">{body ?? 'The Director, Andrew Guya or Doreen approves this with their password.'}</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (password || andy) void go(); }}>
        {!andy && <><label className="field"><span>Who is approving</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} disabled={busy || !people}>
            <option value="" disabled>{people ? 'Choose…' : 'Loading…'}</option>
            {people?.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Their password</span>
          <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </label></>}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (!andy && (!password || !who))}>{busy ? 'Checking…' : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
