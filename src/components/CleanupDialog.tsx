import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { checkEntries, cleanupError, removeEntries, type CheckedItem, type Item } from '../lib/cleanup';
import { passwordProof } from '../lib/pettyPin';
import { canKeepAccounts } from '../../functions/src/shared/permissions';
import { BIN_DAYS, type CleanupKind } from '../../functions/src/shared/cleanup';

/**
 * Removing entries to the Recycle Bin (Andy, 2026-10-30). It first shows what will go, including linked
 * records; money and official records need Andrew Guya's password and a reason.
 */
export function RemoveDialog({ orgId, items, open, onClose, onDone }: { orgId: string; items: Item[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const { user } = useAuth();
  const [checked, setChecked] = useState<CheckedItem[] | null>(null);
  const [director, setDirector] = useState(false);
  const [problem, setProblem] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setChecked(null); setProblem(''); setReason(''); setPassword('');
    checkEntries({ orgId, items }).then((r) => { if (live) { setChecked(r.items); setDirector(r.isDirector); } }, (err) => live && setProblem(cleanupError(err)));
    return () => { live = false; };
  }, [open, orgId, items]);

  const official = !!checked?.some((c) => c.official);
  const blocked = official && !director;
  const linked = checked?.filter((c) => c.linkedText) ?? [];

  async function go() {
    setBusy(true);
    try {
      const proof = official ? await passwordProof(user?.uid ?? '', user?.email ?? '', password) : undefined;
      const res = await removeEntries({ orgId, items, reason, proof });
      toast.show(`${res.removed === 1 ? 'Moved' : `${res.removed} entries moved`} to the Recycle Bin. You can put ${res.removed === 1 ? 'it' : 'them'} back for ${BIN_DAYS} days.`);
      onClose();
      onDone();
    } catch (err) {
      toast.show(cleanupError(err));
    } finally {
      setBusy(false);
    }
  }

  const n = items.length;
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <h2>{n === 1 ? 'Remove this entry?' : `Remove ${n} entries?`}</h2>
      {problem && <p className="error">{problem}</p>}
      {!checked && !problem && <p className="muted">Checking what is linked…</p>}
      {checked && (
        <>
          {n === 1 ? <p><strong>{checked[0]?.label}</strong>{checked[0]?.detail ? ` · ${checked[0].detail}` : ''}</p> : null}
          {linked.length > 0 && (
            <div className="cleanup-linked">
              <p className="small"><strong>This also removes what is linked to {n === 1 ? 'it' : 'them'}:</strong></p>
              <ul className="small">
                {linked.slice(0, 8).map((c) => <li key={c.id}>{n === 1 ? '' : `${c.label}: `}{c.linkedText}</li>)}
                {linked.length > 8 && <li>and {linked.length - 8} more entries with linked records</li>}
              </ul>
            </div>
          )}
          <p className="small muted">It goes to the Recycle Bin, and putting it back brings back everything linked too. After {BIN_DAYS} days it moves to Forever, which only Andrew Guya and Doreen can see.</p>
          {official && (
            <p className={blocked ? 'error' : 'small cleanup-official'}>
              {blocked ? 'This includes money or official records. Only Andrew Guya can remove those.' : 'This includes money or official records, so it needs your password and a reason.'}
            </p>
          )}
          {!blocked && (
            <label className="field"><span>{official ? 'Reason' : 'Reason (optional)'}</span>
              <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test data" disabled={busy} />
            </label>
          )}
          {official && !blocked && (
            <label className="field"><span>Your password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </label>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={() => void go()}
          disabled={busy || !checked || blocked || (official && (reason.trim().length < 3 || !password))}>
          {busy ? 'Removing…' : 'Move to Recycle Bin'}
        </button>
      </div>
    </dialog>
  );
}

/** The Remove button on an entry's own page; only Andrew Guya and Doreen see it. */
export function CleanupButton({ orgId, kind, id, back }: { orgId: string; kind: CleanupKind; id: string; back: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items] = useState<Item[]>(() => [{ kind, id }]);
  if (!orgId || !id || !canKeepAccounts(profile)) return null;
  return (
    <>
      <button type="button" className="btn btn-quiet cleanup-remove no-print" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
        Remove
      </button>
      <RemoveDialog orgId={orgId} items={items} open={open} onClose={() => setOpen(false)} onDone={() => navigate(back, { replace: true })} />
    </>
  );
}
