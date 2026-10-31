import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useFunds } from '../../state/useGiving';
import { addStandardFunds, giftWithCode, recordGift, type GiftInput, type NewFund } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { OrgGate } from '../../components/OrgGate';
import { PersonPicker } from '../../components/PersonPicker';
import { formatMoney, fundNamed, fundTextFromReference, GIFT_METHOD_LABELS, GIFT_METHODS, normalizeMpesaCode, otherFundIdFor, otherGivingFromReference, parseAmount, parseMpesaMessage, PAYBILL_NUMBER, tidyFundName, titleCaseName, type GiftMethod } from '../../../functions/src/shared/giving';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { normalizePhone } from '../../../functions/src/shared/phone';

/**
 * Records one gift: cash, bank, cheque, or an M-Pesa payment typed in or pasted from the SMS.
 * At Freedom Church the fund is Tithes, Offerings, or "Other giving" with its kind typed in, for example
 * Building Fund; a new kind becomes its own fund so reports show it separately (Andy, 2026-10-31, 1B-6A).
 */
export function RecordGiftPage() {
  return <OrgGate title="Record Giving">{(org) => <RecordGift org={org} />}</OrgGate>;
}

/** The choice that opens "Kind of giving". */
const OTHER = '__other';

function RecordGift({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const { byId, people } = usePeople();
  const { active: funds, loading } = useFunds(org.id);
  const church = org.type === 'church_campus';
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const state = useLocation().state as { prefill?: Partial<GiftInput>; replaces?: string } | null;
  const prefill = state?.prefill;
  // Entering a voided gift again may reuse its M-Pesa code.
  const replaces = state?.replaces ?? null;
  const today = localDateKey(new Date(), org.timeZone);

  const [method, setMethod] = useState<GiftMethod>(prefill?.method ?? 'cash');
  const [amount, setAmount] = useState(prefill?.amountCents ? String(prefill.amountCents / 100) : '');
  const [date, setDate] = useState(prefill?.date ?? today);
  const [fundId, setFundId] = useState(prefill?.fundId ?? '');
  const [giver, setGiver] = useState<{ id: string | null; name: string }>({ id: prefill?.personId ?? null, name: prefill?.giverName ?? '' });
  const [code, setCode] = useState(prefill?.mpesaCode ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [notes, setNotes] = useState(prefill?.notes ?? '');
  const [otherName, setOtherName] = useState('');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [accountRef, setAccountRef] = useState(prefill?.accountRef ?? '');
  const [message, setMessage] = useState('');
  const [filled, setFilled] = useState('');
  const [codeTaken, setCodeTaken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Tithes first, Offerings second, then the pastor's other funds; kinds of other giving sit behind "Other giving".
  const order = (id: string) => (id === 'tithes' ? 0 : id === 'offerings' ? 1 : 2);
  const mainFunds = funds.filter((f) => f.kind !== 'other').sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));
  const otherFunds = funds.filter((f) => f.kind === 'other').sort((a, b) => a.name.localeCompare(b.name));

  // Tithes and Offerings are ready without a set-up step at Freedom Church (4A).
  const started = useRef(false);
  useEffect(() => {
    if (!church || loading || started.current) return;
    const missing = !fundNamed('Tithes', funds) || !fundNamed('Offerings', funds);
    if (!missing) return;
    started.current = true;
    addStandardFunds(org.id, funds.map((f) => f.id)).catch((err) => toast.show(friendlyError(err)));
  }, [church, loading, funds, org.id, toast]);

  function fillFromMessage() {
    const m = parseMpesaMessage(message);
    const got: string[] = [];
    if (!m.code && !m.amountCents) { setFilled('That doesn’t look like an M-Pesa message. Copy the whole SMS and paste it again.'); return; }
    setMethod('mpesa'); setCodeTaken(null);
    if (m.amountCents) { setAmount(String(m.amountCents / 100)); got.push(formatMoney(m.amountCents)); }
    if (m.code) { setCode(m.code); got.push(m.code); }
    if (m.date && m.date <= today) { setDate(m.date); got.push(m.date.split('-').reverse().join('/')); }
    if (m.phone) setPhone(m.phone);
    const e164 = normalizePhone(m.phone);
    const person = e164 ? people.find((p) => p.orgId === org.id && (p.phone === e164 || p.whatsapp === e164)) : undefined;
    if (person) { setGiver({ id: person.id, name: person.fullName }); got.push(person.fullName); }
    else if (m.name) { setGiver({ id: null, name: titleCaseName(m.name) }); got.push(titleCaseName(m.name)); }
    if (m.accountRef) {
      setAccountRef(m.accountRef);
      const named = fundNamed(fundTextFromReference(m.accountRef), funds);
      const other = otherGivingFromReference(m.accountRef);
      if (named) { setFundId(named.id); got.push(named.name); }
      else if (church && other) { setFundId(OTHER); setOtherName(other); got.push(other); }
    }
    setFilled(`Filled in: ${got.join(', ')}. Check the rest, then save.`);
  }

  const cents = parseAmount(amount);
  const mpesaCode = method === 'mpesa' ? normalizeMpesaCode(code) : null;

  async function checkCode() {
    setCodeTaken(null);
    if (!mpesaCode) return;
    const giftId = await giftWithCode(org.id, mpesaCode);
    if (giftId && giftId !== replaces) setCodeTaken(giftId);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!cents) return setError('Enter the amount, for example 1000 or 1,500.50.');
    if (date > today) return setError('The date cannot be in the future.');
    if (!fundId) return setError(church ? 'Choose Tithes, Offerings or Other giving.' : 'Choose the fund.');
    let newFund: NewFund | undefined;
    let useFundId = fundId;
    if (fundId === OTHER) {
      const name = tidyFundName(otherName);
      if (name.length < 2 || !/[a-z]/i.test(name)) return setError('Type the kind of giving in words, for example Building Fund or Missions. The amount goes in Amount.');
      const known = fundNamed(name, funds);
      if (known) useFundId = known.id;
      else { newFund = { id: otherFundIdFor(name), name }; useFundId = newFund.id; }
    }
    if (!giver.name.trim()) return setError('Enter who gave, or "Anonymous" for loose offering.');
    if (method === 'mpesa' && !mpesaCode) return setError('Enter the M-Pesa code from the SMS, for example QJK3ABCD12.');
    setSaving(true);
    try {
      if (mpesaCode) {
        const taken = await giftWithCode(org.id, mpesaCode);
        if (taken && taken !== replaces) {
          setCodeTaken(taken);
          return;
        }
      }
      const person = giver.id ? byId(giver.id) : undefined;
      const { id, synced } = recordGift(org.id, {
        personId: giver.id,
        giverName: giver.name,
        phone: normalizePhone(phone) ?? person?.phone ?? null,
        date,
        amountCents: cents,
        fundId: useFundId,
        method,
        mpesaCode,
        accountRef,
        notes: [reference.trim() && `${method === 'cheque' ? 'Cheque no.' : 'Bank ref.'} ${reference.trim()}`, method === 'cheque' && bank.trim(), notes.trim()].filter(Boolean).join(' · '),
      }, profile?.displayName ?? '', newFund);
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(saved('Gift recorded'));
      navigate(`/giving/${org.id}/${id}`, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!church && !loading && funds.length === 0) {
    return (
      <div className="page narrow">
        <h1>Record Giving</h1>
        <p>No funds are set up yet. <Link to="/giving">Back to Giving</Link></p>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <h1>Record Giving</h1>
      <details className="more mpesa-paste">
        <summary>Paste an M-Pesa message</summary>
        <div className="form">
          <label className="field">
            <span>The M-Pesa SMS, copied whole</span>
            <textarea rows={4} value={message} onChange={(e) => { setMessage(e.target.value); setFilled(''); }} placeholder="QJK3ABCD12 Confirmed. Ksh1,000.00 received from JOHN KAMAU 254712345678 on 31/10/26 at 10:15 AM. Account Number FCC#Tithes" />
            <small className="hint">The code, amount, date, giver and Tithes, Offerings or other giving are filled in for you.</small>
          </label>
          <button type="button" className="btn align-start" disabled={!message.trim()} onClick={fillFromMessage}>Fill in the form</button>
          {filled && <p className="small" role="status">{filled}</p>}
        </div>
      </details>
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend>How was it given?</legend>
          <div className="segmented">
            {GIFT_METHODS.map((m) => (
              <button key={m} type="button" className={`chip${method === m ? ' chip-on' : ''}`} aria-pressed={method === m} onClick={() => { setMethod(m); setCodeTaken(null); }}>
                {GIFT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          {method === 'mpesa' && <small className="hint">For payments to Paybill {PAYBILL_NUMBER}. Payments in the statement can be imported instead, all at once.</small>}
        </fieldset>

        <div className="field-row">
          <label className="field">
            <span>Amount (KES)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,000" autoFocus />
          </label>
          <label className="field">
            <span>Date received</span>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>{church ? 'Giving' : 'Fund'}</span>
          <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
            <option value="">Choose…</option>
            {(church ? mainFunds : funds).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            {church && <option value={OTHER}>Other giving…</option>}
          </select>
        </label>
        {fundId === OTHER && (
          <label className="field">
            <span>Kind of giving</span>
            <input list="other-giving" value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="For example Building Fund, Missions, Thanksgiving" autoCapitalize="words" />
            <datalist id="other-giving">{otherFunds.map((f) => <option key={f.id} value={f.name} />)}</datalist>
            <small className="hint">{otherFunds.length ? 'Pick one used before, or type a new one.' : 'Type it once; next time it is suggested.'}</small>
          </label>
        )}

        <PersonPicker
          label="Given by"
          value={giver}
          onChange={setGiver}
          allowFreeText
          orgId={org.id}
          hint="Type a name or phone number. Someone not in the system can be typed in, or Anonymous."
        />

        {method === 'mpesa' && (
          <>
            <label className="field">
              <span>M-Pesa code</span>
              <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTaken(null); }} onBlur={() => void checkCode()} placeholder="QJK3ABCD12" autoCapitalize="characters" />
            </label>
            {codeTaken && (
              <div className="notice notice-warn">
                This M-Pesa code is already recorded, so it would be counted twice. <Link to={`/giving/${org.id}/${codeTaken}`}>Open that payment</Link> or check the <Link to="/giving/unassigned">Unassigned</Link> list.
              </div>
            )}
            <label className="field">
              <span>Phone it came from (optional)</span>
              <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </label>
          </>
        )}

        {method === 'bank' && (
          <label className="field">
            <span>Bank reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank slip or transfer" />
          </label>
        )}
        {method === 'cheque' && (
          <div className="field-row">
            <label className="field">
              <span>Cheque number</span>
              <input inputMode="numeric" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="000123" />
            </label>
            <label className="field">
              <span>Bank</span>
              <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="For example KCB" />
            </label>
          </div>
        )}
        {method === 'mpesa' && accountRef && <p className="small muted">Account typed by the giver: {accountRef}</p>}

        <label className="field">
          <span>Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving || !!codeTaken}>Save and make receipt</button>
      </form>
    </div>
  );
}
