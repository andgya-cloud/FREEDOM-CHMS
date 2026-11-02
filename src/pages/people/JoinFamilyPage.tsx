import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
  MAX_FAMILY, SIGNUP_CLAIM_LABELS, SIGNUP_CLAIMS, SIGNUP_RELATION_LABELS, SIGNUP_RELATIONS,
  type SignupClaim, type SignupRelation,
} from '../../../functions/src/shared/familySignup';

type Info = { name: string };
type Sent = { ok: boolean; firstName: string; count: number; returning?: boolean };

interface PersonForm { fullName: string; phone: string; email: string; gender: '' | 'Male' | 'Female'; day: string; month: string; year: string; claim: SignupClaim | '' }
interface MemberForm extends PersonForm { relation: SignupRelation }

const BLANK: PersonForm = { fullName: '', phone: '', email: '', gender: '', day: '', month: '', year: '', claim: '' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const THIS_YEAR = new Date().getFullYear();

const cleanMessage = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal'
    ? e.message.replace(/\s*\[\d+\]$/, '')
    : 'We could not send the form. Please check your internet and try again.';
};

const birthday = (p: PersonForm) => (p.day && p.month ? `${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}` : null);
const toSend = (p: PersonForm) => ({
  fullName: p.fullName, phone: p.phone, email: p.email, gender: p.gender || null, birthday: birthday(p),
  birthYear: p.year ? Number(p.year) : null, claim: p.claim,
});

/** Member, Regular or Not a member, as three big buttons. */
function ClaimPicker({ value, onChange, who }: { value: SignupClaim | ''; onChange: (v: SignupClaim) => void; who: string }) {
  return (
    <fieldset className="field join-claim">
      <legend>{who}</legend>
      <div className="chips">
        {SIGNUP_CLAIMS.map((c) => (
          <button key={c} type="button" className={`chip ${value === c ? 'chip-on' : ''}`} aria-pressed={value === c} onClick={() => onChange(c)}>{SIGNUP_CLAIM_LABELS[c]}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** Day, month and (optional) year of birth. */
function BirthdayInput({ p, set, yearLabel }: { p: PersonForm; set: (k: 'day' | 'month' | 'year', v: string) => void; yearLabel: string }) {
  return (
    <div className="field">
      <span>Birthday (optional)</span>
      <div className="join-birthday">
        <select aria-label="Day" value={p.day} onChange={(e) => set('day', e.target.value)}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
        </select>
        <select aria-label="Month" value={p.month} onChange={(e) => set('month', e.target.value)}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <select aria-label={yearLabel} value={p.year} onChange={(e) => set('year', e.target.value)}>
          <option value="">Year</option>
          {Array.from({ length: 100 }, (_, i) => THIS_YEAR - i).map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

/**
 * "Join the Freedom family" (Andy, 2026-11-02, 1A-6A): a person scans the QR code, fills in their own details
 * and their family's, and everyone appears on the People page as one family. No sign-in; it talks only to the
 * familySignup function.
 */
export function JoinFamilyPage() {
  const { orgId = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<PersonForm>(BLANK);
  const [whatsapp, setWhatsapp] = useState(true);
  const [consent, setConsent] = useState(true);
  const [family, setFamily] = useState<MemberForm[]>([]);
  const [weddingDate, setWeddingDate] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    httpsCallable<{ orgId: string; action: 'info' }, Info>(functions, 'familySignup')({ orgId, action: 'info' })
      .then((r) => setInfo(r.data))
      .catch(() => setMissing(true));
  }, [orgId]);

  const setMine = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => setMe((p) => ({ ...p, [k]: v }));
  const setMember = <K extends keyof MemberForm>(i: number, k: K, v: MemberForm[K]) => setFamily((list) => list.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const addMember = (relation: SignupRelation) => setFamily((list) => [...list, { ...BLANK, relation }]);
  const hasSpouse = family.some((m) => m.relation === 'spouse');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (me.fullName.trim().length < 2) return setError('Please type your full name.');
    if (me.phone.replace(/\D/g, '').length < 9) return setError('Please type your phone number, for example 0712 345 678.');
    if (!me.claim) return setError('Please choose Member, Regular or Not a member for yourself.');
    const unnamed = family.findIndex((m) => m.fullName.trim().length < 2);
    if (unnamed >= 0) return setError(`Please type the full name of family member ${unnamed + 1}, or remove them.`);
    const noClaim = family.find((m) => !m.claim);
    if (noClaim) return setError(`Please choose Member, Regular or Not a member for ${noClaim.fullName.split(' ')[0]}.`);
    setBusy(true);
    try {
      const r = await httpsCallable<Record<string, unknown>, Sent>(functions, 'familySignup')({
        orgId, action: 'send', website,
        me: { ...toSend(me), whatsapp, consent: whatsapp && consent },
        family: family.map((m) => ({ ...toSend(m), relation: m.relation })),
        weddingDate: hasSpouse ? weddingDate : '',
      });
      setSent(r.data);
    } catch (err) {
      setError(cleanMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <div className="center-card welcome-card"><h1>Welcome!</h1><p>This form is not working right now. Please ask at the church office.</p></div>;
  if (!info) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;

  if (sent) {
    return (
      <div className="center-card welcome-card">
        <img src="/org/freedom-church-logo.png" alt="" width={96} height={96} />
        <h1>Thank you{sent.firstName ? `, ${sent.firstName}` : ''}!</h1>
        <p>{sent.count > 1 ? `We have your family's details (${sent.count} people).` : 'We have your details.'} Welcome to the {info.name} family.</p>
        <p className="muted small">You can close this page now.</p>
      </div>
    );
  }

  return (
    <div className="center-card welcome-card join-card">
      <img src="/org/freedom-church-logo.png" alt="" width={96} height={96} />
      <h1>Join the {info.name} family</h1>
      <p>Tell us about yourself and your family, so we can know you, pray for you and celebrate your special days.</p>
      <form className="form" onSubmit={submit}>
        <h2 className="join-section">About you</h2>
        <label className="field"><span>Your full name</span><input autoComplete="name" autoCapitalize="words" value={me.fullName} maxLength={120} onChange={(e) => setMine('fullName', e.target.value)} /></label>
        <label className="field"><span>Phone number</span><input type="tel" inputMode="tel" autoComplete="tel" value={me.phone} maxLength={30} onChange={(e) => setMine('phone', e.target.value)} placeholder="0712 345 678" /></label>
        <label className="check"><input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /><span>This number is on WhatsApp</span></label>
        {whatsapp && <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>The church may send me WhatsApp messages</span></label>}
        <label className="field"><span>Email (optional)</span><input type="email" autoComplete="email" value={me.email} maxLength={120} onChange={(e) => setMine('email', e.target.value)} /></label>
        <fieldset className="field">
          <legend>Gender (optional)</legend>
          <div className="chips">
            {(['Male', 'Female'] as const).map((g) => <button key={g} type="button" className={`chip ${me.gender === g ? 'chip-on' : ''}`} aria-pressed={me.gender === g} onClick={() => setMine('gender', me.gender === g ? '' : g)}>{g}</button>)}
          </div>
        </fieldset>
        <BirthdayInput p={me} set={(k, v) => setMine(k, v)} yearLabel="Year of birth" />
        <ClaimPicker who={`At ${info.name}, I am…`} value={me.claim} onChange={(v) => setMine('claim', v)} />

        <h2 className="join-section">Your family</h2>
        {family.length === 0 && <p className="muted small">Add your husband or wife, your children and anyone else in your home.</p>}
        {family.map((m, i) => (
          <section key={i} className="join-member" aria-label={`Family member ${i + 1}`}>
            <div className="join-member-head">
              <select aria-label="Relationship" value={m.relation} onChange={(e) => setMember(i, 'relation', e.target.value as SignupRelation)}>
                {SIGNUP_RELATIONS.map((r) => <option key={r} value={r}>{SIGNUP_RELATION_LABELS[r]}</option>)}
              </select>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setFamily((list) => list.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <label className="field"><span>Full name</span><input autoCapitalize="words" value={m.fullName} maxLength={120} onChange={(e) => setMember(i, 'fullName', e.target.value)} /></label>
            <label className="field"><span>Phone number {m.relation === 'child' ? '(if they have one)' : '(optional)'}</span><input type="tel" inputMode="tel" value={m.phone} maxLength={30} onChange={(e) => setMember(i, 'phone', e.target.value)} placeholder="0712 345 678" /></label>
            {m.relation !== 'child' && <label className="field"><span>Email (optional)</span><input type="email" value={m.email} maxLength={120} onChange={(e) => setMember(i, 'email', e.target.value)} /></label>}
            <fieldset className="field">
              <legend>Gender (optional)</legend>
              <div className="chips">
                {(['Male', 'Female'] as const).map((g) => <button key={g} type="button" className={`chip ${m.gender === g ? 'chip-on' : ''}`} aria-pressed={m.gender === g} onClick={() => setMember(i, 'gender', m.gender === g ? '' : g)}>{g}</button>)}
              </div>
            </fieldset>
            <BirthdayInput p={m} set={(k, v) => setMember(i, k, v)} yearLabel="Year of birth" />
            <ClaimPicker who={`At ${info.name}, ${m.fullName.trim().split(' ')[0] || 'they'} is…`} value={m.claim} onChange={(v) => setMember(i, 'claim', v)} />
          </section>
        ))}
        {family.length < MAX_FAMILY && (
          <div className="join-add">
            {!hasSpouse && <button type="button" className="btn" onClick={() => addMember('spouse')}>+ Husband or wife</button>}
            <button type="button" className="btn" onClick={() => addMember('child')}>+ Child</button>
            <button type="button" className="btn btn-quiet" onClick={() => addMember('other')}>+ Someone else</button>
          </div>
        )}
        {hasSpouse && (
          <label className="field"><span>Wedding date (optional), so we can celebrate your anniversary</span><input type="date" value={weddingDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setWeddingDate(e.target.value)} /></label>
        )}
        <label className="welcome-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
      <p className="muted small">Only the church team sees your details.</p>
    </div>
  );
}
