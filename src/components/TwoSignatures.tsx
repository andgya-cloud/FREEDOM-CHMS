import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../state/ToastContext';
import { myOwnProof, passwordProof } from '../lib/pettyPin';
import { useAuth } from '../state/AuthContext';
import { isDirectorProfile } from '../../functions/src/shared/permissions';
import { friendlyError } from '../lib/errors';
import { forgetSignatures, keepSignatures, keptSignatures, listChampionSigners, type ChampionSignerRow } from '../lib/championEdit';
import { CHAMPION_SIGN_MINUTES } from '../../functions/src/shared/hopeChampionPay';

type Run = (proofs: [string, string]) => Promise<unknown>;

/**
 * Two signatures for changing a champion (Andy, 2026-11-05): Andy or Doreen, and the Director, each choose their
 * name and type their own password. `sign(what, run)` asks for them, or uses the pair signed in the last few
 * minutes on this phone, then runs the save.
 */
export function useTwoSignatures(orgId: string) {
  const toast = useToast();
  // Andy alone signs, with no password (2026-11-06): the save goes straight through.
  const { profile } = useAuth();
  const andy = isDirectorProfile(profile);
  const [ask, setAsk] = useState<{ what: string; run: Run } | null>(null);
  const sign = useCallback((what: string, run: Run) => {
    if (andy) { myOwnProof().then((p) => run([p, ''])).catch((err) => toast.show(friendlyError(err))); return; }
    const k = keptSignatures(orgId);
    if (k) { run(k.proofs).catch((err) => { forgetSignatures(); toast.show(friendlyError(err)); }); return; }
    setAsk({ what, run });
  }, [orgId, toast, andy]);
  const dialog = <SignDialog orgId={orgId} ask={ask} onDone={() => setAsk(null)} />;
  return { sign, dialog };
}

function SignDialog({ orgId, ask, onDone }: { orgId: string; ask: { what: string; run: Run } | null; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<ChampionSignerRow[] | null>(null);
  const [a, setA] = useState({ uid: '', pw: '' });
  const [b, setB] = useState({ uid: '', pw: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) {
      setA({ uid: '', pw: '' }); setB({ uid: '', pw: '' }); setError(''); d.showModal();
      if (!people) listChampionSigners(orgId).then((list) => {
        setPeople(list);
        const dirs = list.filter((p) => p.role === 'director');
        if (dirs.length === 1) setB((x) => ({ ...x, uid: dirs[0]!.uid }));
      }, (err) => setError(friendlyError(err)));
    }
    if (!ask && d.open) d.close();
  }, [ask, orgId, people]);

  const keepers = people?.filter((p) => p.role === 'keeper') ?? [];
  const directors = people?.filter((p) => p.role === 'director') ?? [];
  async function go() {
    const pa = keepers.find((p) => p.uid === a.uid), pb = directors.find((p) => p.uid === b.uid);
    if (!pa || !pb || !a.pw || !b.pw) { setError('Both people choose their name and type their password.'); return; }
    setBusy(true); setError('');
    let proofs: [string, string];
    try { proofs = [await passwordProof(pa.uid, pa.emails, a.pw), ''] as [string, string]; }
    catch { setBusy(false); setError(`${pa.name}'s password is not right.`); return; }
    try { proofs[1] = await passwordProof(pb.uid, pb.emails, b.pw); }
    catch { setBusy(false); setError(`${pb.name}'s password is not right.`); return; }
    try {
      await ask!.run(proofs);
      keepSignatures(orgId, proofs, `${pa.name} and ${pb.name}`);
      onDone();
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  const box = (label: string, list: ChampionSignerRow[], v: { uid: string; pw: string }, set: (x: { uid: string; pw: string }) => void) => (
    <fieldset className="stack sig-box">
      <legend>{label}</legend>
      <select aria-label={label} value={v.uid} onChange={(e) => set({ ...v, uid: e.target.value })} disabled={busy || !people}>
        <option value="" disabled>{people ? 'Choose your name…' : 'Loading…'}</option>
        {list.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
      </select>
      <input type="password" aria-label={`${label}: password`} placeholder="Password" autoComplete="off" value={v.pw} onChange={(e) => set({ ...v, pw: e.target.value })} disabled={busy} />
    </fieldset>
  );
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); if (!busy) onDone(); }}>
      <h2>Two signatures needed</h2>
      <p className="small">{ask?.what} Andy or Doreen, and the Director, each sign with their own password.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        {box('Andy or Doreen', keepers, a, setA)}
        {box('The Director', directors, b, setB)}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="small muted">Signing lasts {CHAMPION_SIGN_MINUTES} minutes on this phone, for more changes.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onDone} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Signing…' : 'Sign and save'}</button>
        </div>
      </form>
    </dialog>
  );
}
