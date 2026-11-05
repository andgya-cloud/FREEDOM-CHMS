import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { listPettySigners, setPinWithPassword, type PettySigner } from '../../lib/pettyPin';
import { checkPin, PETTY_CASH_ORG_TYPES, pettyCashBase } from '../../../functions/src/shared/pettyCash';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { PasswordInput } from '../../components/PasswordInput';

/**
 * The one place to set or change a petty cash signing PIN (Andy, 2026-10-24). The person types their own
 * Insight-IQ password once to prove it is them. Andrew Guya and Doreen can open it for another stakeholder
 * on a shared device; that person still types their own password.
 */
export function SigningPinPage() {
  const { user, profile } = useAuth();
  const { current, organizations } = useOrg();
  const toast = useToast();
  const org = current && (PETTY_CASH_ORG_TYPES as readonly string[]).includes(current.type) ? current
    : organizations.find((o) => (PETTY_CASH_ORG_TYPES as readonly string[]).includes(o.type)) ?? null;
  const keeper = canKeepAccounts(profile);
  const [signers, setSigners] = useState<PettySigner[] | null>(null);
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  useEffect(() => {
    if (!org) return;
    let live = true;
    listPettySigners(org.id).then((l) => { if (live) setSigners(l); }).catch((err) => { if (live) { setSigners([]); toast.show(friendlyError(err)); } });
    return () => { live = false; };
  }, [org?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = (signers ?? []).filter((s) => keeper || s.uid === user?.uid);
  const chosen = choices.find((s) => s.uid === (uid || user?.uid));
  async function save() {
    if (!chosen) return;
    if (!checkPin(pin)) { toast.show('Choose a PIN of 4 to 6 digits, not all the same digit.'); return; }
    if (pin !== pin2) { toast.show('The two PINs are not the same.'); return; }
    setBusy(true);
    try {
      let lastErr: unknown = null;
      for (const email of chosen.emails?.length ? chosen.emails : [chosen.email]) {
        try { await setPinWithPassword(email, password, pin); lastErr = null; break; } catch (err) { lastErr = err; }
      }
      if (lastErr) throw lastErr;
      setDone(`${chosen.name}'s signing PIN is saved. From now on ${chosen.uid === user?.uid ? 'you sign' : 'they sign'} with it.`);
      setPassword(''); setPin(''); setPin2('');
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      toast.show(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? `That password is not right for ${chosen.name}.` : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Signing PIN</h1></div>
      <p className="muted">A PIN of 4 to 6 digits signs petty cash requests quickly. You can always sign with your Insight-IQ password instead.</p>
      {!org ? <p className="muted">Petty cash is not set up for your organization.</p> : (
        <section className="card stack">
          {keeper ? (
            <label className="field"><span>Whose PIN?</span>
              <select value={chosen?.uid ?? ''} onChange={(e) => { setUid(e.target.value); setDone(''); }} disabled={busy || !signers}>
                {!signers && <option value="">Loading names…</option>}
                {choices.map((s) => <option key={s.uid} value={s.uid}>{s.name}{s.uid === user?.uid ? ' (me)' : ''}{s.hasPin ? '' : ' · no PIN yet'}</option>)}
              </select>
            </label>
          ) : <p><strong>{profile?.displayName}</strong>{chosen && !chosen.hasPin ? ' · no PIN yet' : ''}</p>}
          <label className="field"><span>{chosen && chosen.uid !== user?.uid ? `${chosen.name}'s Insight-IQ password (typed by them)` : 'Your Insight-IQ password'}</span>
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </label>
          <div className="field-row">
            <label className="field"><span>New PIN (4 to 6 digits)</span>
              <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} disabled={busy} />
            </label>
            <label className="field"><span>Type the PIN again</span>
              <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} disabled={busy} />
            </label>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={!chosen || !password || pin.length < 4 || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save PIN'}</button>
            <Link className="btn btn-quiet" to={pettyCashBase(org.type)}>Back to petty cash</Link>
          </div>
          {done && <p className="notice">{done}</p>}
        </section>
      )}
    </div>
  );
}
