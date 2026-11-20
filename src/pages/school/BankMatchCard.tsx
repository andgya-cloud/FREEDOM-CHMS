import { useMemo, useState } from 'react';
import { friendlyError } from '../../lib/errors';
import { matchBankPayments } from '../../lib/pettyPin';
import { millis, usePettyCash, usePettyMonths } from '../../state/usePettyCash';
import type { Organization } from '../../state/OrgContext';
import { paymentCodeOf } from '../../../functions/src/shared/pettyCash';
import { matchPayments, readPayments, type BankPayment } from '../../../functions/src/shared/bankMatch';
import { money } from './common';
import { PettySignBox } from './PettySignBox';
import { useDaily, useFinance } from '../../state/useFinance';
import { useBankMoney } from '../finance/BankMoney';
import { accountKindOf, looksLikeFullStatement, planUpload, savePlan, uploadNote } from '../finance/statementUpload';
import { FIN_ACCOUNT_SUGGESTIONS } from '../../../functions/src/shared/finance';

const nairobiDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
const showDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const payeeKey = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The rows of an uploaded Excel or PDF list of payments. */
async function fileRows(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { pdfTextRows } = await import('../../lib/bankStatementFile');
    return pdfTextRows(file);
  }
  const { readSpreadsheetSheets } = await import('../../lib/statementFile');
  return (await readSpreadsheetSheets(file)).flatMap((s) => s.rows);
}

/**
 * Match bank payments (Andy, 2026-11-09, 1B 2A 3B 4A 5A 6A): upload the list of payments to one person
 * (Excel or PDF), the app pairs each payment with that person's requisition of the same week that has no
 * payment code, and one of Andrew, Doreen or Elias confirms them all at once. Each requisition then takes
 * the amount the bank sent, and the bank line stands as its receipt.
 */
export function BankMatchCard({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const { months } = usePettyMonths(org);
  const [payments, setPayments] = useState<BankPayment[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [payee, setPayee] = useState('');
  const [done, setDone] = useState('');

  // Approved requisitions with no payment code yet, in open months, by who was paid.
  const open = useMemo(() => p.requisitions.filter((r) => r.status === 'approved' && !paymentCodeOf(r) && !r.bankProof && months[r.month]?.status !== 'closed'), [p.requisitions, months]);
  const payees = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const r of open) {
      const k = payeeKey(r.payee);
      if (!k) continue;
      const x = m.get(k) ?? { label: r.payee!.trim(), n: 0 };
      x.n++; m.set(k, x);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v }));
  }, [open]);
  const candidates = (key: string) => open.filter((r) => payeeKey(r.payee) === key).map((r) => {
    const at = millis(r.approved?.at) ?? millis(r.createdAt) ?? Date.now();
    return { id: r.id, day: nairobiDay(at), cents: r.totalCents };
  });
  // The payee whose requisitions match the most payments is chosen first.
  const best = useMemo(() => {
    if (!payments) return '';
    let top = ''; let n = 0;
    // An exact amount counts double, so a file of monthly shares is not taken for someone's weekly payments.
    for (const x of payees) {
      const m = matchPayments(payments, candidates(x.key)).reduce((k, y) => k + (y.cents === y.reqCents ? 2 : 1), 0);
      if (m > n) { n = m; top = x.key; }
    }
    return top;
  }, [payments, payees]);
  const who = payee || best;
  const matches = useMemo(() => (payments && who ? matchPayments(payments, candidates(who)) : []), [payments, who]);
  const byId = new Map(p.requisitions.map((r) => [r.id, r]));
  const changes = matches.filter((m) => m.cents !== m.reqCents).length;
  const whoLabel = payees.find((x) => x.key === who)?.label ?? '';

  const fin = useFinance(org);
  const daily = useDaily(org);
  const bank = useBankMoney(org);
  const [bankNote, setBankNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  /** Saves the file to the bank account when it is a whole statement; true when it was one. */
  async function saveIfStatement(file: File): Promise<boolean> {
    if (!fin.allowed) return false;
    const { readBankStatement } = await import('../../lib/bankStatementFile');
    const read = await readBankStatement(file);
    if (!looksLikeFullStatement(read)) return false;
    const latest = [...bank.sources].sort((a, b) => b.asOf.localeCompare(a.asOf))[0]?.account;
    const account = latest ?? fin.statements.find((x) => accountKindOf(x.account) === 'bank')?.account ?? FIN_ACCOUNT_SUGGESTIONS[0]!;
    const plan = planUpload(read, account, { statements: fin.statements, learned: fin.learned, orgType: org.type, daily: daily.entries, months: fin.months });
    const fmt = (c: number) => money(org, c);
    if (!plan.lines.length) { setBankNote(uploadNote(fmt, account, read, bank, null)); return true; }
    const after = await savePlan(org.id, account, file.name, plan, fin.statements, bank.approved, fin.typed);
    setBankNote(uploadNote(fmt, account, read, bank, after));
    return true;
  }

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true); setError(''); setDone(''); setPayee(''); setBankNote(null);
    // A whole bank statement uploaded here updates Money in the bank too (Andy, 2026-11-20, 3A).
    const saved = await saveIfStatement(file).catch(() => false);
    try {
      const { payments: list } = readPayments((await fileRows(file)) as never);
      if (!list.length) { if (!saved) throw new Error('No payments were found in this file. It needs a date, a bank reference and an amount on each line.'); }
      else { setPayments(list); setFileName(file.name); }
    } catch (err) {
      setPayments(null); setError(friendlyError(err));
    }
    setReading(false);
  }

  return (
    <section className="card stack">
      <h2>Match bank payments</h2>
      <p className="small muted">Upload the list of bank payments to one person (Excel or PDF). The app finds their requisitions of the same week (or a monthly voucher paid in several lines on one day) that have no payment code. Once confirmed, each takes the amount the bank sent and the bank payment counts as its receipt.</p>
      <label className="btn btn-quiet">
        {reading ? 'Reading…' : payments ? 'Choose another file' : 'Upload payments (Excel or PDF)'}
        <input type="file" accept=".xlsx,.pdf,.csv" className="visually-hidden" onChange={(e) => void choose(e)} disabled={reading} />
      </label>
      {error && <p className="danger-text small">{error}</p>}
      {bankNote && <p className={bankNote.tone === 'ok' ? 'petty-ok small' : 'petty-warn small'}>{bankNote.text}</p>}
      {done && <p className="small">{done}</p>}
      {payments && (
        <>
          <p className="small">{fileName}: {payments.length} payments, {money(org, payments.reduce((n, x) => n + x.cents, 0))}.</p>
          {payees.length === 0 ? <p className="small muted">Every approved requisition already has a payment code.</p> : (
            <label className="field"><span>Paid to</span>
              <select value={who} onChange={(e) => setPayee(e.target.value)}>
                {!who && <option value="">Choose who was paid</option>}
                {payees.map((x) => <option key={x.key} value={x.key}>{x.label} ({x.n} without a code)</option>)}
              </select>
            </label>
          )}
          {who && (matches.length === 0 ? <p className="small muted">None of these payments falls within a week of {whoLabel}'s requisitions.</p> : (
            <>
              <p className="small"><strong>{matches.length} matched.</strong>{changes ? ` ${changes} will change to what the bank sent.` : ''}{payments.length > matches.length ? ` ${payments.length - matches.length} payments have no requisition and are left out.` : ''}</p>
              <div className="exam-table-wrap">
                <table className="table">
                  <thead><tr><th>Requisition</th><th className="num">Asked</th><th>Bank paid</th><th>Reference</th><th className="num">Paid</th></tr></thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.reqId}>
                        <td>{byId.get(m.reqId)?.number ?? 'Requisition'}<br /><span className="small muted">{showDay(m.reqDay)}</span></td>
                        <td className="num nowrap">{money(org, m.reqCents)}</td>
                        <td className="nowrap">{showDay(m.day)}</td>
                        <td>{m.ref || '—'}</td>
                        <td className={`num nowrap${m.cents !== m.reqCents ? ' danger-text' : ''}`}>{money(org, m.cents)}{m.lines.length > 1 && <><br /><span className="small muted">{m.lines.map((l) => money(org, l.cents)).join(' + ')}</span></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PettySignBox topUpOnly label="Andrew, Doreen or Elias confirms all the matches with one PIN." orgId={org.id} exclude={[]}
                confirmLabel={`✓ Confirm all ${matches.length}`}
                sign={async (signerUid, pin) => {
                  const res = await matchBankPayments({ orgId: org.id, signerUid, pin, payee: whoLabel, matches: matches.map(({ reqId, lines }) => ({ reqId, lines })) });
                  setPayments(null); setPayee('');
                  const msg = `${res.matched} requisitions matched to the bank${res.changed ? `, ${res.changed} amounts set to what the bank sent` : ''}.`;
                  setDone(msg);
                  return msg;
                }} />
            </>
          ))}
        </>
      )}
    </section>
  );
}
