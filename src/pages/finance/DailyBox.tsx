import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { money } from '../school/common';
import { KpiCard, KpiRow } from '../../components/charts';
import { millis, usePettyCash } from '../../state/usePettyCash';
import { useDaily } from '../../state/useFinance';
import { addBankDaily, removeBankDaily, saveCashCount } from '../../lib/financeWrites';
import { parseAmountCents, pettyLedger } from '../../../functions/src/shared/pettyCash';
import { categoriesFor, dailyBook, FIN_ACCOUNT_SUGGESTIONS, finLabel } from '../../../functions/src/shared/finance';

const EAT = 3 * 3_600_000;
const dayOf = (ms: number) => new Date(ms + EAT).toISOString().slice(0, 10);
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Daily accounts on the petty cash Overview (Andy, 2026-11-09, 1C 2B 7A): today's opening, money in,
 * money out and cash now; an optional cash count; bank money typed on the day; and the past days.
 * Each day closes by itself. At month end the typed bank money is checked against the statement.
 */
export function DailyBox({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const d = useDaily(org);
  const { profile } = useAuth();
  const toast = useToast();
  const today = dayOf(Date.now());
  const [shown, setShown] = useState(14);
  const [count, setCount] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const ledger = pettyLedger(p.funds, p.requisitions, millis).map((l) => ({ day: dayOf(l.at), creditCents: l.creditCents, debitCents: l.debitCents, balanceCents: l.balanceCents, kind: l.kind }));
    return dailyBook(ledger, d.entries, d.counts, today);
  }, [p.funds, p.requisitions, d.entries, d.counts, today]);
  if (!d.on) return null;
  const t = rows[0]!;
  const todays = d.entries.filter((e) => e.date === today);

  async function saveCount() {
    const cents = parseAmountCents(count);
    if (cents == null) { toast.show('Type the cash you counted.'); return; }
    try { await saveCashCount(org.id, today, cents, profile?.displayName ?? ''); setCount(''); }
    catch (err) { toast.show(friendlyError(err)); }
  }
  const diffText = (diff: number) => (diff === 0 ? 'matches the books' : diff < 0 ? `${money(org, -diff)} short` : `${money(org, diff)} extra`);

  return (
    <section className="card stack">
      <div className="card-head"><h2>Today · {longDay(today)}</h2></div>
      <KpiRow label="Petty cash today">
        <KpiCard label="Opening" value={money(org, t.openingCents)} />
        <KpiCard label="Money in" value={money(org, t.inCents)} />
        <KpiCard label="Money out" value={money(org, t.outCents)} />
        <KpiCard label="Cash now" value={money(org, t.closingCents)} tone="navy" />
      </KpiRow>

      {t.countedCents != null
        ? <p className={t.diffCents ? 'petty-warn small' : 'small'}>Cash counted: {money(org, t.countedCents)}{t.countedBy ? ` by ${t.countedBy}` : ''}, {diffText(t.diffCents!)}.</p>
        : null}
      <form className="field-row" onSubmit={(e) => { e.preventDefault(); void saveCount(); }}>
        <label className="field"><span>{t.countedCents != null ? 'Count again' : 'Count the cash in the box (optional)'}</span>
          <input inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} placeholder={`Books say ${money(org, t.closingCents)}`} />
        </label>
        <button type="submit" className="btn align-end" disabled={!count}>Save count</button>
      </form>

      <div className="stack">
        <strong>Bank money today</strong>
        {todays.length ? (
          <ul className="plain small">
            {todays.map((e) => (
              <li key={e.id} className="fin-line">
                <span>{e.dir === 'in' ? 'In' : 'Out'} · {e.account}: {e.text || finLabel(e.category)} <strong className={e.dir === 'in' ? 'fin-in' : 'fin-out'}>{money(org, e.cents)}</strong></span>
                <button type="button" className="btn btn-quiet" onClick={() => void removeBankDaily(org.id, e.id).catch((err) => toast.show(friendlyError(err)))}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="small muted">Nothing typed yet. Type money banked or paid from the bank today; at month end it is checked against the bank statement.</p>}
        {adding ? <BankForm org={org} today={today} accounts={[...new Set([...d.entries.map((e) => e.account), ...FIN_ACCOUNT_SUGGESTIONS])]} onDone={() => setAdding(false)} />
          : <button type="button" className="btn align-start" onClick={() => setAdding(true)}>Type bank money</button>}
      </div>

      <details className="fold-card">
        <summary>Past days</summary>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Day</th><th className="num">Opening</th><th className="num">In</th><th className="num">Out</th><th className="num">Closing</th><th className="num">Bank in</th><th className="num">Bank out</th><th>Count</th></tr></thead>
            <tbody>
              {rows.slice(1, shown + 1).map((r) => (
                <tr key={r.date}>
                  <td>{shortDay(r.date)}</td>
                  <td className="num">{money(org, r.openingCents)}</td>
                  <td className="num">{r.inCents ? money(org, r.inCents) : '–'}</td>
                  <td className="num">{r.outCents ? money(org, r.outCents) : '–'}</td>
                  <td className="num">{money(org, r.closingCents)}</td>
                  <td className="num">{r.bankInCents ? money(org, r.bankInCents) : '–'}</td>
                  <td className="num">{r.bankOutCents ? money(org, r.bankOutCents) : '–'}</td>
                  <td className={r.diffCents ? 'fin-out' : ''}>{r.countedCents == null ? '–' : diffText(r.diffCents!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown + 1 && <button type="button" className="btn btn-quiet" onClick={() => setShown(shown + 30)}>Show more days</button>}
        <p className="small muted">At month end, upload the bank statement in <Link to="/finance">Financial statements</Link>; the typed bank money and the top-ups are checked against it.</p>
      </details>
    </section>
  );
}

function BankForm({ org, today, accounts, onDone }: { org: Organization; today: string; accounts: string[]; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(accounts[0] ?? FIN_ACCOUNT_SUGGESTIONS[0]!);
  const [text, setText] = useState('');
  const [category, setCategory] = useState(org.type === 'church_campus' ? 'offerings' : org.type === 'ministry' ? 'grants' : 'fees');
  const cats = categoriesFor(dir);
  async function save() {
    const cents = parseAmountCents(amount);
    if (!cents) { toast.show('Type the amount.'); return; }
    try { await addBankDaily(org.id, { date, dir, cents, account, text: text.trim(), category: cats.some((c) => c.id === category) ? category : cats[0]!.id }); onDone(); }
    catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="field-row">
        <label className="field"><span>Money</span>
          <select value={dir} onChange={(e) => { const v = e.target.value as 'in' | 'out'; setDir(v); setCategory(categoriesFor(v)[0]!.id); }}>
            <option value="in">Into the bank</option><option value="out">Out of the bank</option>
          </select>
        </label>
        <label className="field"><span>Amount (KES)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Account</span><select value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field"><span>Category</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      </div>
      <div className="field-row">
        <label className="field"><span>What it was</span><input value={text} maxLength={120} onChange={(e) => setText(e.target.value)} placeholder={dir === 'in' ? 'Sunday offering banked' : 'Cheque to the plumber'} /></label>
        <label className="field"><span>Date</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="row-actions">
        <button type="submit" className="btn btn-primary">Save</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
