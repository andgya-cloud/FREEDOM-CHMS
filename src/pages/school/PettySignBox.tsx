import { useEffect, useState } from 'react';
import { PasswordInput } from '../../components/PasswordInput';
import { useToast } from '../../state/ToastContext';
import { useAuth } from '../../state/AuthContext';
import { friendlyError } from '../../lib/errors';
import { listPettySigners, passwordProof, type PettySigner } from '../../lib/pettyPin';
import { Link } from 'react-router-dom';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';

/**
 * Another stakeholder signs on this device: they pick their name and type their own signing PIN
 * (Andy, 2026-10-23). The server checks the PIN and writes the signature as them, so the person signed
 * in here stays signed in. Someone without a PIN, or who forgot it, sets one with their password once.
 */
export function PettySignBox({ label: title, orgId, fundOnly = false, topUpOnly = false, directorMode = false, directorOnly = false, ready = true, exclude, sign, confirmLabel = '✓ Confirm' }: {
  label: string; orgId: string; fundOnly?: boolean; exclude: string[]; confirmLabel?: string;
  /** Only the Director may give this signature (a request over the spending limit). */
  directorOnly?: boolean;
  /** Only the people who may top up alone; `ready` is false until the amount is typed. */
  topUpOnly?: boolean; ready?: boolean;
  /** The Director signs only from his own account, with no PIN or password (Andy, 2026-10-24). */
  directorMode?: boolean;
  /** Signs as the chosen stakeholder with their PIN; returns the name to show. */
  sign: (signerUid: string, pin: string) => Promise<string>;
}) {
  const toast = useToast();
  const { user, profile } = useAuth();
  // Only Andrew Guya and Doreen Mayaka pick another stakeholder's name (Andy: ADIA 2026-10-24, Church and Hope 2026-10-30); everyone else signs as themselves.
  const keeper = canKeepAccounts(profile);
  const [signers, setSigners] = useState<PettySigner[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [uid, setUid] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    listPettySigners(orgId).then((list) => { if (live) { setSigners(list); setLoadError(''); } })
      .catch((err) => { if (live) setLoadError((err as { code?: string })?.code?.includes('unavailable') ? 'The name list needs a connection.' : friendlyError(err)); });
    return () => { live = false; };
  }, [orgId, reload]);
  const choices = (signers ?? []).filter((s) => (keeper || s.uid === user?.uid) && !exclude.includes(s.uid) && (!fundOnly || s.canAuthorize) && (!topUpOnly || !!s.canTopUp) && (!directorOnly || !!(s.isDirector ?? s.isPastor)));
  const director = (s: PettySigner) => s.isDirector ?? !!s.isPastor;
  const lockedOut = (s: PettySigner) => directorMode && director(s) && s.uid !== user?.uid;
  const iAmDirector = directorMode && choices.some((s) => director(s) && s.uid === user?.uid);
  // The Director signed in here is chosen for him, and signs with one tap.
  const chosen = choices.find((s) => s.uid === (uid || (iAmDirector || !keeper ? user?.uid : '')) && !lockedOut(s));
  const noSecret = !!chosen && iAmDirector && chosen.uid === user?.uid;
  function done(name: string) {
    setUid(''); setPin('');
    toast.show(name);
  }
  async function go() {
    if (!chosen || !ready) return;
    setBusy(true);
    try {
      if (noSecret) {
        done(await sign(chosen.uid, ''));
      } else {
        // Four to six digits is a PIN; anything else is their Insight-IQ password.
        const secret = pin.trim();
        if (/^\d{4,6}$/.test(secret)) { done(await sign(chosen.uid, secret)); return; }
        // The password set in Staff accounts is checked on the server first; if it isn't that one (they may
        // have changed their own sign-in password since), their sign-in password is tried.
        try {
          done(await sign(chosen.uid, secret));
        } catch (err) {
          const e = err as { code?: string; message?: string };
          const wrong = e?.code === 'functions/permission-denied' && /Wrong password/.test(e.message ?? '');
          const none = e?.code === 'functions/failed-precondition' && /NO_SIGNING_PASSWORD/.test(e.message ?? '');
          if (!wrong && !none) throw err;
          try {
            done(await sign(chosen.uid, await passwordProof(chosen.uid, chosen.emails?.length ? chosen.emails : chosen.email, secret)));
          } catch (err2) {
            const c = (err2 as { code?: string })?.code ?? '';
            if (wrong && (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found')) throw err;
            throw err2;
          }
        }
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const code = e?.code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') toast.show(`That password is not right for ${chosen.name}. Set a new one for them in Settings, Staff accounts, Password, then try again.`);
      else if (code === 'auth/too-many-requests') toast.show('Too many tries for ' + chosen.name + '. Wait a few minutes and try again.');
      else if (code.startsWith('functions/') && e.message) toast.show(e.message.replace(/\s*\[\d+\]$/, ''));
      else toast.show(code === 'auth/network-request-failed' ? 'Signing here needs a connection. Try again when online.' : friendlyError(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="petty-signer-form">
      <p className="small muted">{keeper ? title : 'Sign as yourself: type your own password or PIN.'}</p>
      {loadError && <p className="small danger-text">{loadError} <button type="button" className="btn btn-quiet" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
      <div className="petty-signer-row">
        {!keeper ? (
          <label className="field"><span>Signer</span>
            <input value={signers ? (chosen ? chosen.name : 'You have already signed this, or you cannot sign it') : 'Loading…'} readOnly disabled />
          </label>
        ) : (
        <label className="field"><span>Signer</span>
          <select value={chosen?.uid ?? ''} onChange={(e) => { setUid(e.target.value); setPin(''); }} disabled={busy || !signers}>
            <option value="">{signers ? (choices.length ? 'Choose your name' : 'Nobody else can sign this') : 'Loading names…'}</option>
            {choices.map((s) => <option key={s.uid} value={s.uid} disabled={lockedOut(s)}>{s.name}{lockedOut(s) ? ' (signs from his own account)' : s.title ? ` (${s.title})` : ''}</option>)}
          </select>
        </label>
        )}
        {!noSecret && (
          <label className="field"><span>Your PIN or password</span>
            <PasswordInput autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4 && ready) void go(); }} placeholder={chosen ? 'Type your PIN or password' : 'Choose your name first'} disabled={busy || !chosen} />
          </label>
        )}
        {<button type="button" className="btn btn-primary" disabled={!chosen || (!noSecret && pin.length < 4) || busy || !ready} onClick={() => void go()}>{busy ? 'Checking…' : confirmLabel}</button>}
      </div>
      {noSecret && <p className="small muted">Signed in as {chosen!.name}: no password needed.</p>}
      {chosen && !noSecret && (
        <Link className="btn btn-quiet petty-pin-link" to="/settings/signing-pin">{chosen.hasPin ? 'Forgot your PIN? Set a new one' : 'Set a PIN for next time'}</Link>
      )}
    </div>
  );
}
