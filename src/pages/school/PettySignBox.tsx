import { useEffect, useState } from 'react';
import { PasswordInput } from '../../components/PasswordInput';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { listPettySigners, setPinWithPassword, type PettySigner } from '../../lib/pettyPin';
import { checkPin } from '../../../functions/src/shared/pettyCash';

/**
 * Another stakeholder signs on this device: they pick their name and type their own signing PIN
 * (Andy, 2026-10-23). The server checks the PIN and writes the signature as them, so the person signed
 * in here stays signed in. Someone without a PIN, or who forgot it, sets one with their password once.
 */
export function PettySignBox({ label: title, orgId, fundOnly = false, topUpOnly = false, ready = true, exclude, sign, confirmLabel = '✓ Confirm' }: {
  label: string; orgId: string; fundOnly?: boolean; exclude: string[]; confirmLabel?: string;
  /** Only the people who may top up alone; `ready` is false until the amount is typed. */
  topUpOnly?: boolean; ready?: boolean;
  /** Signs as the chosen stakeholder with their PIN; returns the name to show. */
  sign: (signerUid: string, pin: string) => Promise<string>;
}) {
  const toast = useToast();
  const [signers, setSigners] = useState<PettySigner[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [uid, setUid] = useState('');
  const [pin, setPin] = useState('');
  const [settingPin, setSettingPin] = useState(false);
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    listPettySigners(orgId).then((list) => { if (live) { setSigners(list); setLoadError(''); } })
      .catch((err) => { if (live) setLoadError((err as { code?: string })?.code?.includes('unavailable') ? 'The name list needs a connection.' : friendlyError(err)); });
    return () => { live = false; };
  }, [orgId, reload]);
  const choices = (signers ?? []).filter((s) => !exclude.includes(s.uid) && (!fundOnly || s.canAuthorize) && (!topUpOnly || !!s.canTopUp));
  const chosen = choices.find((s) => s.uid === uid);
  const needsPin = !!chosen && (!chosen.hasPin || settingPin);
  const pinOk = checkPin(newPin) && newPin === newPin2;
  function done(name: string) {
    setUid(''); setPin(''); setPassword(''); setNewPin(''); setNewPin2(''); setSettingPin(false);
    toast.show(name);
  }
  async function go() {
    if (!chosen || !ready) return;
    setBusy(true);
    try {
      if (needsPin) {
        if (!checkPin(newPin)) { toast.show('Choose a PIN of 4 to 6 digits, not all the same digit.'); return; }
        if (newPin !== newPin2) { toast.show('The two PINs are not the same.'); return; }
        await setPinWithPassword(chosen.email, password, newPin);
        setReload((n) => n + 1);
        done(await sign(chosen.uid, newPin));
      } else {
        done(await sign(chosen.uid, pin.trim()));
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const code = e?.code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') toast.show('That password is not right for ' + chosen.name + '.');
      else if (code.startsWith('functions/') && e.message) toast.show(e.message.replace(/\s*\[\d+\]$/, ''));
      else toast.show(code === 'auth/network-request-failed' ? 'Signing here needs a connection. Try again when online.' : friendlyError(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="petty-signer-form">
      <p className="small muted">{title}</p>
      {loadError && <p className="small danger-text">{loadError} <button type="button" className="btn btn-quiet" onClick={() => setReload((n) => n + 1)}>Try again</button></p>}
      <div className="petty-signer-row">
        <label className="field"><span>Stakeholder</span>
          <select value={uid} onChange={(e) => { setUid(e.target.value); setPin(''); setSettingPin(false); }} disabled={busy || !signers}>
            <option value="">{signers ? (choices.length ? 'Choose your name' : 'Nobody else can sign this') : 'Loading names…'}</option>
            {choices.map((s) => <option key={s.uid} value={s.uid}>{s.name}{s.title ? ` (${s.title})` : ''}</option>)}
          </select>
        </label>
        {!needsPin && (
          <label className="field"><span>Your signing PIN</span>
            <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4 && ready) void go(); }} placeholder="4 to 6 digits" disabled={busy || !chosen} />
          </label>
        )}
        {!needsPin && <button type="button" className="btn btn-primary" disabled={!chosen || pin.length < 4 || busy || !ready} onClick={() => void go()}>{busy ? 'Checking…' : confirmLabel}</button>}
      </div>
      {chosen && !needsPin && (
        <button type="button" className="btn btn-quiet petty-pin-link" onClick={() => setSettingPin(true)}>Forgot your PIN? Set a new one</button>
      )}
      {needsPin && (
        <div className="petty-pin-setup">
          <p className="small">{chosen!.hasPin ? `${chosen!.name}, set a new PIN.` : `${chosen!.name} has no PIN yet. Set one now; next time you will only need the PIN.`} Type your Insight-IQ password once to prove it is you.</p>
          <div className="petty-signer-row">
            <label className="field"><span>Your Insight-IQ password</span>
              <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Typed by them" disabled={busy} />
            </label>
            <label className="field"><span>New PIN (4 to 6 digits)</span>
              <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} disabled={busy} />
            </label>
            <label className="field"><span>Type the PIN again</span>
              <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} disabled={busy} />
            </label>
            <button type="button" className="btn btn-primary" disabled={!password || !pinOk || busy || !ready} onClick={() => void go()}>{busy ? 'Checking…' : '✓ Save PIN and sign'}</button>
          </div>
          {chosen!.hasPin && <button type="button" className="btn btn-quiet petty-pin-link" onClick={() => setSettingPin(false)}>Back to PIN</button>}
        </div>
      )}
    </div>
  );
}
