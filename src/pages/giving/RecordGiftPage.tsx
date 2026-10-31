import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useFunds } from '../../state/useGiving';
import { giftWithCode, recordGift, type GiftInput } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { OrgGate } from '../../components/OrgGate';
import { PersonPicker } from '../../components/PersonPicker';
import { GIFT_METHOD_LABELS, GIFT_METHODS, normalizeMpesaCode, parseAmount, PAYBILL_NUMBER, type GiftMethod } from '../../../functions/src/shared/giving';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { normalizePhone } from '../../../functions/src/shared/phone';

/** Records one gift: cash, bank, cheque, or an M-Pesa payment typed in from the SMS. */
export function RecordGiftPage() {
  return <OrgGate title="Record Giving">{(org) => <RecordGift org={org} />}</OrgGate>;
}

function RecordGift({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const { byId } = usePeople();
  const { active: funds, loading } = useFunds(org.id);
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
  const [codeTaken, setCodeTaken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!fundId) return setError('Choose the fund.');
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
        fundId,
        method,
        mpesaCode,
        accountRef: prefill?.accountRef ?? '',
        notes,
      }, profile?.displayName ?? '');
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(saved('Gift recorded'));
      navigate(`/giving/${org.id}/${id}`, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loading && funds.length === 0) {
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
          <span>Fund</span>
          <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
            <option value="">Choose…</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>

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

        <label className="field">
          <span>Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={method === 'cheque' ? 'Cheque number and bank' : method === 'bank' ? 'Bank reference' : ''} />
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving || !!codeTaken}>Save and make receipt</button>
      </form>
    </div>
  );
}
