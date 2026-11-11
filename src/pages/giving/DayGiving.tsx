import { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import type { Fund } from '../../state/useGiving';
import { recordGift, type NewFund } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { formatMoney, fundNamed, fundTextFromReference, otherFundIdFor, parseAmount, tidyFundName, type GiftMethod } from '../../../functions/src/shared/giving';
import { localDateKey } from '../../../functions/src/shared/datetime';

const METHODS: [GiftMethod, string][] = [['cash', 'Cash'], ['bank', 'Bank'], ['cheque', 'Cheque']];

/** The last Sunday on or before a day ("2026-11-09" -> "2026-11-08"). */
function lastSunday(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** "FCC#Building", "fcc #building fund" or "Building" -> "Building Fund"-style name. */
export function otherGivingName(text: string) {
  const t = text.includes('#') ? fundTextFromReference(text) : text.replace(/^\s*FCC\s*/i, '');
  return tidyFundName(t.toLowerCase());
}

/**
 * Record a day's giving in one go (Andy, 2026-11-09): pick any day, type the Offerings and Tithes totals and
 * any other giving (FCC#BUILDING or just Building), then save once. Each line is saved as its own gift, so
 * reports and the monthly summary count it under the right kind. One person's gift still uses Record a gift.
 */
export function DayGiving({ org, funds }: { org: Organization; funds: Fund[] }) {
  const { profile } = useAuth();
  const toast = useToast();
  const today = localDateKey(new Date(), org.timeZone);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<GiftMethod>('cash');
  const [offerings, setOfferings] = useState('');
  const [tithes, setTithes] = useState('');
  const [others, setOthers] = useState<{ name: string; amount: string }[]>([{ name: '', amount: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const otherFunds = funds.filter((f) => f.kind === 'other').sort((a, b) => a.name.localeCompare(b.name));
  const tithesFund = fundNamed('Tithes', funds);
  const offeringsFund = fundNamed('Offerings', funds);

  const lines = [
    { fund: offeringsFund, name: 'Offerings', cents: parseAmount(offerings) },
    { fund: tithesFund, name: 'Tithes', cents: parseAmount(tithes) },
    ...others.filter((o) => o.name.trim() || o.amount.trim()).map((o) => {
      const name = otherGivingName(o.name);
      return { fund: fundNamed(name, funds), name, cents: parseAmount(o.amount) };
    }),
  ].filter((l, i) => i > 1 || l.cents);
  const total = lines.reduce((n, l) => n + (l.cents ?? 0), 0);

  async function save() {
    setError('');
    if (date > today) return setError('The day cannot be in the future.');
    if (!lines.length) return setError('Type at least one amount.');
    const bad = lines.find((l) => !l.cents || l.name.length < 2);
    if (bad) return setError(bad.name.length < 2 ? 'Give each other giving a name, for example FCC#BUILDING or Building.' : `Check the amount for ${bad.name}.`);
    if (!offeringsFund || !tithesFund) return setError('Tithes and Offerings are still being set up. Try again in a moment.');
    setBusy(true);
    try {
      const made = new Set<string>();
      for (const l of lines) {
        let fundId = l.fund?.id;
        let newFund: NewFund | undefined;
        if (!fundId) {
          fundId = otherFundIdFor(l.name);
          if (!made.has(fundId)) { newFund = { id: fundId, name: l.name }; made.add(fundId); }
        }
        const { synced } = recordGift(org.id, {
          personId: null, giverName: 'Anonymous', phone: null, date, amountCents: l.cents!, fundId, method,
          mpesaCode: null, accountRef: '', notes: `Day's giving, ${l.name}`,
        }, profile?.displayName ?? '', newFund);
        synced.catch((err) => toast.show(friendlyError(err)));
      }
      toast.show(`✅ Well done! Saved ${formatMoney(total)} for ${new Date(`${date}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}`);
      setOfferings(''); setTithes(''); setOthers([{ name: '', amount: '' }]);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack day-giving">
      <h2>Record a day's giving</h2>
      <div className="field-row">
        <label className="field">
          <span>Day</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field">
          <span>Quick pick</span>
          <div className="segmented">
            <button type="button" className={`chip${date === today ? ' chip-on' : ''}`} onClick={() => setDate(today)}>Today</button>
            <button type="button" className={`chip${date === lastSunday(today) && date !== today ? ' chip-on' : ''}`} onClick={() => setDate(lastSunday(today))}>Last Sunday</button>
          </div>
        </div>
        <div className="field">
          <span>How given</span>
          <div className="segmented">
            {METHODS.map(([m, label]) => <button key={m} type="button" className={`chip${method === m ? ' chip-on' : ''}`} aria-pressed={method === m} onClick={() => setMethod(m)}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="field-row">
        <label className="field"><span>Offerings (KES)</span><input inputMode="decimal" value={offerings} onChange={(e) => setOfferings(e.target.value)} placeholder="0" /></label>
        <label className="field"><span>Tithes (KES)</span><input inputMode="decimal" value={tithes} onChange={(e) => setTithes(e.target.value)} placeholder="0" /></label>
      </div>
      {others.map((o, i) => (
        <div className="field-row" key={i}>
          <label className="field">
            <span>Other giving</span>
            <input list="day-other-giving" value={o.name} onChange={(e) => setOthers(others.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="FCC#BUILDING or Building" />
          </label>
          <label className="field">
            <span>Amount (KES)</span>
            <input inputMode="decimal" value={o.amount} onChange={(e) => setOthers(others.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} placeholder="0" />
          </label>
        </div>
      ))}
      <datalist id="day-other-giving">{otherFunds.map((f) => <option key={f.id} value={f.name} />)}</datalist>
      <button type="button" className="btn btn-quiet align-start" onClick={() => setOthers([...others, { name: '', amount: '' }])}>+ Another kind of giving</button>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary btn-lg" disabled={busy || !total} onClick={() => void save()}>
        {total ? `Save ${formatMoney(total)}` : 'Save'}
      </button>
      <p className="small muted">For one person's gift, with their name for a receipt, use Record a gift.</p>
    </section>
  );
}
