import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { HOW_HEARD_OPTIONS } from '../../../functions/src/shared/people';

type Info = { name: string };
type Sent = { ok: boolean; firstName: string; returning?: boolean };

const cleanMessage = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal'
    ? e.message.replace(/\s*\[\d+\]$/, '')
    : 'We could not send your card. Please check your internet and try again, or ask an usher.';
};

/**
 * The card a visitor fills in on their own phone after scanning the QR poster (Andy, 2026-10-31, 3A).
 * No sign-in: it talks only to the welcomeCard function, which adds them to People.
 */
export function WelcomeCardPage() {
  const { orgId = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState(true);
  const [consent, setConsent] = useState(true);
  const [howHeard, setHowHeard] = useState('');
  const [invitedBy, setInvitedBy] = useState('');
  const [prayer, setPrayer] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    httpsCallable<{ orgId: string; action: 'info' }, Info>(functions, 'welcomeCard')({ orgId, action: 'info' })
      .then((r) => setInfo(r.data))
      .catch(() => setMissing(true));
  }, [orgId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (fullName.trim().length < 2) return setError('Please type your name.');
    if (phone.replace(/\D/g, '').length < 9) return setError('Please type your phone number, for example 0712 345 678.');
    setBusy(true);
    try {
      const r = await httpsCallable<Record<string, unknown>, Sent>(functions, 'welcomeCard')({
        orgId, action: 'send', fullName, phone, whatsapp, consent: whatsapp && consent, howHeard, invitedBy, prayer, website,
      });
      setSent(r.data);
    } catch (err) {
      setError(cleanMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return <div className="center-card welcome-card"><h1>Welcome!</h1><p>This card is not working right now. Please ask an usher for a paper card.</p></div>;
  }
  if (!info) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;

  if (sent) {
    return (
      <div className="center-card welcome-card">
        <img src="/org/freedom-church-logo.png" alt="" width={96} height={96} />
        <h1>Thank you{sent.firstName ? `, ${sent.firstName}` : ''}!</h1>
        <p>{sent.returning ? 'Good to see you again.' : `We are so glad you joined us at ${info.name} today.`} {prayer.trim() ? 'Our pastors will pray with you.' : ''}</p>
        <p className="muted small">You can close this page now.</p>
      </div>
    );
  }

  return (
    <div className="center-card welcome-card">
      <img src="/org/freedom-church-logo.png" alt="" width={96} height={96} />
      <h1>Welcome to {info.name}</h1>
      <p>We are glad you are here. Tell us a little about yourself so we can say hello.</p>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Your name</span><input autoComplete="name" autoCapitalize="words" value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} /></label>
        <label className="field"><span>Phone number</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></label>
        <label className="check"><input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /><span>This number is on WhatsApp</span></label>
        {whatsapp && <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>The church may send me WhatsApp messages</span></label>}
        <label className="field">
          <span>How did you hear about us? (optional)</span>
          <select value={howHeard} onChange={(e) => setHowHeard(e.target.value)}>
            <option value="">Choose…</option>
            {HOW_HEARD_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        {howHeard === 'Invited by someone' && <label className="field"><span>Who invited you?</span><input value={invitedBy} maxLength={120} onChange={(e) => setInvitedBy(e.target.value)} /></label>}
        <label className="field"><span>Anything we can pray with you about? (optional)</span><textarea rows={3} value={prayer} maxLength={2000} onChange={(e) => setPrayer(e.target.value)} /></label>
        <label className="welcome-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send my card'}</button>
      </form>
      <p className="muted small">Only the church team sees your details.</p>
    </div>
  );
}
