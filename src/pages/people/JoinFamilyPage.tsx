import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
  AGE_RANGE_LABELS, AGE_RANGES, ageOn, ageRangeFor, FREEDOM_SINCE, FREEDOM_SINCE_LABELS, MARITAL_LABELS, MARITAL_STATUSES, MAX_FAMILY,
  SIGNUP_CLAIM_LABELS, SIGNUP_CLAIMS, SIGNUP_RELATION_LABELS, SIGNUP_RELATIONS, WORK_LABELS, WORK_STATUSES,
  type AgeRange, type SignupClaim, type SignupRelation,
} from '../../../functions/src/shared/familySignup';

type Info = { name: string; serviceTimes?: string[]; howHeard?: string[] };
type Sent = { ok: boolean; firstName: string; count: number; returning?: boolean };
type YesNo = '' | 'yes' | 'no';

interface PersonForm {
  fullName: string; phone: string; email: string; gender: '' | 'Male' | 'Female'; day: string; month: string; year: string;
  claim: SignupClaim | ''; ageRange: AgeRange | ''; maritalStatus: string; bornAgain: YesNo; baptised: YesNo; freedomSince: string;
}
interface MemberForm extends PersonForm { relation: SignupRelation }
interface MoreForm { area: string; work: string; homeGroup: YesNo; ministry: string; howHeard: string; serviceAttended: string }

const BLANK: PersonForm = {
  fullName: '', phone: '', email: '', gender: '', day: '', month: '', year: '', claim: '', ageRange: '', maritalStatus: '', bornAgain: '', baptised: '', freedomSince: '',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const THIS_YEAR = new Date().getFullYear();
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const cleanMessage = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal'
    ? e.message.replace(/\s*\[\d+\]$/, '')
    : 'We could not send the form. Please check your internet and try again.';
};

const birthday = (p: PersonForm) => (p.day && p.month ? `${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}` : null);
/** The age range: worked out from the year of birth (4A), or the one they chose. */
const rangeOf = (p: PersonForm): AgeRange | '' => {
  const age = ageOn(p.year ? Number(p.year) : null, birthday(p), todayKey());
  return age != null ? ageRangeFor(age) : p.ageRange;
};
const yn = (v: YesNo) => (v === 'yes' ? true : v === 'no' ? false : null);
const toSend = (p: PersonForm) => ({
  fullName: p.fullName, phone: p.phone, email: p.email, gender: p.gender || null, birthday: birthday(p),
  birthYear: p.year ? Number(p.year) : null, claim: p.claim,
  about: { ageRange: p.ageRange || null, maritalStatus: p.maritalStatus || null, bornAgain: yn(p.bornAgain), baptised: yn(p.baptised), freedomSince: p.freedomSince || null },
});

/** A row of big tap buttons; tapping the chosen one again clears it when `clearable`. */
function Chips<T extends string>({ label, options, value, onChange, clearable = false }: { label: string; options: readonly (readonly [T, string])[]; value: T | ''; onChange: (v: T | '') => void; clearable?: boolean }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="chips">
        {options.map(([v, text]) => (
          <button key={v} type="button" className={`chip ${value === v ? 'chip-on' : ''}`} aria-pressed={value === v} onClick={() => onChange(clearable && value === v ? '' : v)}>{text}</button>
        ))}
      </div>
    </fieldset>
  );
}
const YES_NO = [['yes', 'Yes'], ['no', 'No']] as const;
const GENDERS = [['Male', 'Male'], ['Female', 'Female']] as const;
const CLAIMS = SIGNUP_CLAIMS.map((c) => [c, SIGNUP_CLAIM_LABELS[c]] as const);

/** Day, month and year of birth. */
function BirthdayInput({ p, set }: { p: PersonForm; set: (k: 'day' | 'month' | 'year', v: string) => void }) {
  return (
    <div className="field">
      <span>Date of birth</span>
      <div className="join-birthday">
        <select aria-label="Day" value={p.day} onChange={(e) => set('day', e.target.value)}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
        </select>
        <select aria-label="Month" value={p.month} onChange={(e) => set('month', e.target.value)}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <select aria-label="Year of birth" value={p.year} onChange={(e) => set('year', e.target.value)}>
          <option value="">Year</option>
          {Array.from({ length: 100 }, (_, i) => THIS_YEAR - i).map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Birthday, then the age range only when no year is given. */
function AgeFields({ p, set }: { p: PersonForm; set: <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => void }) {
  const range = rangeOf(p);
  return (
    <>
      <BirthdayInput p={p} set={(k, v) => set(k, v)} />
      {p.year
        ? range && <p className="muted small join-age">Age range: {AGE_RANGE_LABELS[range]}</p>
        : (
          <label className="field"><span>No year? Choose the age range</span>
            <select value={p.ageRange} onChange={(e) => set('ageRange', e.target.value as AgeRange | '')}>
              <option value="">Choose…</option>
              {AGE_RANGES.map((r) => <option key={r} value={r}>{AGE_RANGE_LABELS[r]}</option>)}
            </select>
          </label>
        )}
    </>
  );
}

/** Born again, baptised, how long at Freedom, and Member / Regular / Not a member: for everyone 13 and over. */
function FaithFields({ p, set, who, church }: { p: PersonForm; set: <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => void; who: { self: boolean; first: string }; church: string }) {
  const are = who.self ? 'Are you' : `Is ${who.first || 'this person'}`;
  return (
    <>
      <Chips label={`${are} born again?`} options={YES_NO} value={p.bornAgain} onChange={(v) => set('bornAgain', v)} />
      <Chips label={`${are} baptised in water by immersion?`} options={YES_NO} value={p.baptised} onChange={(v) => set('baptised', v)} />
      <label className="field"><span>How long {who.self ? 'have you' : `has ${who.first || 'this person'}`} been at Freedom Church?</span>
        <select value={p.freedomSince} onChange={(e) => set('freedomSince', e.target.value)}>
          <option value="">Choose…</option>
          {FREEDOM_SINCE.map((f) => <option key={f} value={f}>{FREEDOM_SINCE_LABELS[f]}</option>)}
        </select>
      </label>
      <Chips label={`At ${church}, ${who.self ? 'I am' : `${who.first || 'this person'} is`}…`} options={CLAIMS} value={p.claim} onChange={(v) => set('claim', v)} />
    </>
  );
}

/**
 * "Join the Freedom family" (Andy, 2026-11-02): a person scans the QR code and fills in their own details and their
 * family's. The form waits for Andrew or Doreen to approve it before anything reaches People. No sign-in; it talks
 * only to the familySignup function.
 */
export function JoinFamilyPage() {
  const { orgId = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<PersonForm>(BLANK);
  const [more, setMore] = useState<MoreForm>({ area: '', work: '', homeGroup: '', ministry: '', howHeard: '', serviceAttended: '' });
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
  const setMore1 = <K extends keyof MoreForm>(k: K, v: MoreForm[K]) => setMore((m) => ({ ...m, [k]: v }));
  const setMember = <K extends keyof MemberForm>(i: number, k: K, v: MemberForm[K]) => setFamily((list) => list.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const addMember = (relation: SignupRelation) => setFamily((list) => [...list, { ...BLANK, relation }]);
  const hasSpouse = family.some((m) => m.relation === 'spouse');
  const married = me.maritalStatus === 'married' || hasSpouse;
  const myRange = rangeOf(me);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (me.fullName.trim().length < 2) return setError('Please type your full name.');
    if (me.phone.replace(/\D/g, '').length < 9) return setError('Please type your phone number, for example 0712 345 678.');
    const unnamed = family.findIndex((m) => m.fullName.trim().length < 2);
    if (unnamed >= 0) return setError(`Please type the full name of family member ${unnamed + 1}, or remove them.`);
    setBusy(true);
    try {
      const r = await httpsCallable<Record<string, unknown>, Sent>(functions, 'familySignup')({
        orgId, action: 'send', website,
        me: {
          ...toSend(me), whatsapp, consent: whatsapp && consent, howHeard: more.howHeard || null, serviceAttended: more.serviceAttended || null,
          about: { ...toSend(me).about, area: more.area, work: more.work || null, homeGroup: yn(more.homeGroup), ministry: more.ministry },
        },
        family: family.map((m) => ({ ...toSend(m), relation: m.relation })),
        weddingDate: married ? weddingDate : '',
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
      <p>Tell us about yourself and your family, so we can know you, pray for you and celebrate your special days. Already filled it in before? Fill it again to update your details.</p>
      <form className="form" onSubmit={submit} onChangeCapture={() => setError('')} onClickCapture={() => setError('')}>
        <h2 className="join-section">About you</h2>
        <label className="field"><span>Full name</span><input autoComplete="name" autoCapitalize="words" value={me.fullName} maxLength={120} onChange={(e) => setMine('fullName', e.target.value)} /></label>
        <label className="field"><span>Phone number</span><input type="tel" inputMode="tel" autoComplete="tel" value={me.phone} maxLength={30} onChange={(e) => setMine('phone', e.target.value)} placeholder="0712 345 678" /></label>
        <label className="check"><input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /><span>This number is on WhatsApp</span></label>
        {whatsapp && <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>The church may send me WhatsApp messages</span></label>}
        <label className="field"><span>Email address (optional)</span><input type="email" autoComplete="email" value={me.email} maxLength={120} onChange={(e) => setMine('email', e.target.value)} /></label>
        <AgeFields p={me} set={setMine} />
        <Chips label="Gender" options={GENDERS} value={me.gender} onChange={(v) => setMine('gender', v)} />
        {myRange !== 'teen' && myRange !== 'child' && (
          <Chips label="Marital status" options={MARITAL_STATUSES.map((m) => [m, MARITAL_LABELS[m]] as const)} value={me.maritalStatus} onChange={(v) => setMine('maritalStatus', v)} />
        )}
        <FaithFields p={me} set={setMine} who={{ self: true, first: '' }} church={info.name} />
        <label className="field"><span>Where you stay (optional)</span><input value={more.area} maxLength={80} placeholder="For example Kasarani" onChange={(e) => setMore1('area', e.target.value)} /></label>

        <h2 className="join-section">Your family</h2>
        {family.length === 0 && <p className="muted small">Add your husband or wife, your children and anyone else in your home.</p>}
        {family.map((m, i) => {
          const range = rangeOf(m);
          const first = m.fullName.trim().split(' ')[0] ?? '';
          const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => setMember(i, k, v as MemberForm[K]);
          return (
            <section key={i} className="join-member" aria-label={`Family member ${i + 1}`}>
              <div className="join-member-head">
                <select aria-label="Relationship" value={m.relation} onChange={(e) => setMember(i, 'relation', e.target.value as SignupRelation)}>
                  {SIGNUP_RELATIONS.map((r) => <option key={r} value={r}>{SIGNUP_RELATION_LABELS[r]}</option>)}
                </select>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setFamily((list) => list.filter((_, j) => j !== i))}>Remove</button>
              </div>
              <label className="field"><span>Full name</span><input autoCapitalize="words" value={m.fullName} maxLength={120} onChange={(e) => set('fullName', e.target.value)} /></label>
              <AgeFields p={m} set={set} />
              <Chips label="Gender" options={GENDERS} value={m.gender} onChange={(v) => set('gender', v)} />
              {range !== 'child' && (
                <>
                  <label className="field"><span>Phone number {m.relation === 'child' ? '(if they have one)' : '(optional)'}</span><input type="tel" inputMode="tel" value={m.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} placeholder="0712 345 678" /></label>
                  {m.relation !== 'child' && <label className="field"><span>Email address (optional)</span><input type="email" value={m.email} maxLength={120} onChange={(e) => set('email', e.target.value)} /></label>}
                  {m.relation === 'other' && range !== 'teen' && (
                    <Chips label="Marital status (optional)" options={MARITAL_STATUSES.map((s) => [s, MARITAL_LABELS[s]] as const)} value={m.maritalStatus} onChange={(v) => set('maritalStatus', v)} clearable />
                  )}
                  <FaithFields p={m} set={set} who={{ self: false, first }} church={info.name} />
                </>
              )}
            </section>
          );
        })}
        {family.length < MAX_FAMILY && (
          <div className="join-add">
            {!hasSpouse && <button type="button" className="btn" onClick={() => addMember('spouse')}>+ Husband or wife</button>}
            <button type="button" className="btn" onClick={() => addMember('child')}>+ Child</button>
            <button type="button" className="btn btn-quiet" onClick={() => addMember('other')}>+ Someone else</button>
          </div>
        )}
        {married && (
          <label className="field"><span>Marriage anniversary: your wedding date (optional)</span><input type="date" value={weddingDate} max={todayKey()} onChange={(e) => setWeddingDate(e.target.value)} /></label>
        )}

        <h2 className="join-section">A few more questions (optional)</h2>
        <label className="field"><span>How did you first come to Freedom Church?</span>
          <select value={more.howHeard} onChange={(e) => setMore1('howHeard', e.target.value)}>
            <option value="">Choose…</option>
            {(info.howHeard ?? []).map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        {(info.serviceTimes?.length ?? 0) > 0 && (
          <label className="field"><span>Which service do you usually attend?</span>
            <select value={more.serviceAttended} onChange={(e) => setMore1('serviceAttended', e.target.value)}>
              <option value="">Choose…</option>
              {info.serviceTimes!.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        )}
        <Chips label="Work" options={WORK_STATUSES.map((w) => [w, WORK_LABELS[w]] as const)} value={more.work} onChange={(v) => setMore1('work', v)} clearable />
        <Chips label="Are you in a home group?" options={YES_NO} value={more.homeGroup} onChange={(v) => setMore1('homeGroup', v)} clearable />
        <label className="field"><span>A ministry you serve in, or would like to join</span><input value={more.ministry} maxLength={120} placeholder="For example Choir, Ushering, Children" onChange={(e) => setMore1('ministry', e.target.value)} /></label>

        <label className="welcome-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
      <p className="muted small">Only the church team sees your details.</p>
    </div>
  );
}
