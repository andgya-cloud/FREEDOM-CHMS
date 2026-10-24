import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { millis, usePettyCash, usePettyMonths, useReceipts } from '../../state/usePettyCash';
import { PettySignBox } from './PettySignBox';
import { closePettyMonth, reopenPettyMonth } from '../../lib/pettyPin';
import { saveAllocations } from '../../lib/pettyCashWrites';
import { AskDeleteDialog, BinButton } from './PettyBin';
import { balanceSheetPdf, monthReportPdf } from '../../lib/pettyPdf';
import { downloadFile } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { type LedgerLine, categoryBudgets, categoryLabel, parseAmountCents, pettyCashBase, pettyCashCategoriesFor, pettyLedger, PETTY_CASH_STATUS_LABELS, MONTH_CLOSE_SIGNATURES } from '../../../functions/src/shared/pettyCash';
import { CsvButton, KpiCard, KpiRow } from '../../components/charts';
import { money } from './common';
import { BudgetHealth, NoAccess, packGroup, PettyGate, PettyNav, ReceiptsBox, savePack } from './PettyCashPage';
import { needsReceipt, receiptStatus } from '../../lib/receiptNames';
import type { Organization } from '../../state/OrgContext';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

/** Every requisition's receipts in one place, one folder per requisition, for those who see all requisitions. */
export function PettyReceiptsPage() {
  return <PettyGate title="Receipts">{(org) => <Receipts org={org} />}</PettyGate>;
}

function Receipts({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const { months: monthRecs } = usePettyMonths(org);
  const toast = useToast();
  const { receipts } = useReceipts(org);
  const [show, setShow] = useState<'missing' | 'all'>('missing');
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [category, setCategory] = useState('');
  const [packing, setPacking] = useState(false);
  const live = p.requisitions.filter((r) => r.status !== 'rejected');
  const months = useMemo(() => [...new Set(live.map((r) => r.month))].sort().reverse(), [live]);
  if (!p.seesAll) return <NoAccess />;
  const receiptsOf = (id: string) => receipts.filter((r) => r.reqId === id);
  const inView = live.filter((r) => (!month || r.month === month) && (!category || r.category === category));
  const approved = inView.filter((r) => r.status === 'approved');
  const missing = approved.filter((r) => needsReceipt(r, receiptsOf(r.id).length));
  const list = show === 'missing' ? missing : inView;
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const prefix = org.type === 'college' ? 'ADIA' : org.name.replace(/[^A-Za-z0-9]+/g, '-');
  async function monthPack() {
    if (!month) return;
    setPacking(true);
    const groups = live.filter((r) => r.month === month && r.status === 'approved' && (!category || r.category === category))
      .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''))
      .map((r) => packGroup(org, r, receiptsOf(r.id)));
    await savePack(org, `Receipts for ${monthName(month)}${category ? `, ${category}` : ''}`, `${prefix}-receipts-${month}.pdf`, groups, toast);
    setPacking(false);
  }
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Receipts</h1>
        <span className="row-actions no-print">
          <button type="button" className="btn btn-primary" disabled={!month || packing || !approved.length} onClick={() => void monthPack()}
            title={month ? undefined : 'Pick a month first'}>{packing ? 'Making PDF…' : "Download month's receipts (PDF)"}</button>
        </span>
      </div>
      <PettyNav org={org} />
      <div className="row-actions petty-filters">
        <label className="field"><span>Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <label className="field"><span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {pettyCashCategoriesFor(org.type).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {!month && <p className="small muted">Pick a month to download all its approved requisitions' receipts in one PDF.</p>}
      <KpiRow label="Receipts">
        <KpiCard label="Receipts kept" value={String(inView.reduce((n, r) => n + receiptsOf(r.id).length, 0))} />
        <KpiCard label="Complete" value={String(approved.length - missing.length)} tone="ok" note="Approved, with a receipt" />
        <KpiCard label="Receipt needed" value={String(missing.length)} tone={missing.length ? 'warn' : 'ok'} note="Approved, no receipt yet" />
      </KpiRow>
      <div className="segmented" role="group" aria-label="Which requisitions">
        <button type="button" className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>Receipt needed ({missing.length})</button>
        <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All requisitions</button>
      </div>
      {list.length === 0 ? <p className="muted small">{show === 'missing' ? 'Every approved requisition here has a receipt.' : 'No requisitions here.'}</p> : (
        <ul className="petty-folders">
          {list.map((r) => {
            const mine = receiptsOf(r.id);
            const n = mine.length;
            const isOpen = open === r.id;
            return (
              <li key={r.id} className="card">
                <button type="button" className="petty-folder" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className="petty-folder-name">{r.number ?? 'New request'} · {r.requesterName}</span>
                  <span className="small muted">{money(org, r.totalCents)} · {categoryLabel(r)} · {receiptStatus(r, n, PETTY_CASH_STATUS_LABELS[r.status])}</span>
                  <span className={`badge${n || r.status !== 'approved' ? '' : ' badge-warn'}`}>{n ? `📎 ${n} receipt${n === 1 ? '' : 's'}` : 'No receipt yet'}</span>
                </button>
                {isOpen && <ReceiptsBox org={org} req={r} receipts={mine} locked={monthRecs[r.month]?.status === 'closed'} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The petty cash ledger: signed top-ups in, approved requests out, and the balance after each. */
export function PettyBalanceSheetPage() {
  return <PettyGate title="Balance sheet">{(org) => <BalanceSheet org={org} />}</PettyGate>;
}

function BalanceSheet({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const lines = useMemo(() => pettyLedger(p.funds, p.requisitions, millis), [p.funds, p.requisitions]);
  const [deleting, setDeleting] = useState<LedgerLine | null>(null);
  const { receipts } = useReceipts(org);
  const periods = useMemo(() => {
    const months = [...new Set(p.requisitions.map((r) => r.month))].sort().reverse();
    return [...new Set(months.map((m) => m.slice(0, 4)))].flatMap((y) => [y, ...months.filter((m) => m.startsWith(y))]);
  }, [p.requisitions]);
  const [period, setPeriod] = useState('');
  const [excelBusy, setExcelBusy] = useState(false);
  if (!p.seesAll) return <NoAccess />;
  async function excel() {
    const chosen = period || periods[1] || periods[0];
    if (!chosen) return;
    setExcelBusy(true);
    try {
      const { pettyWorkbook } = await import('../../lib/pettyExcel');
      downloadFile(await pettyWorkbook(org.name, chosen, p.requisitions, receipts, lines));
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setExcelBusy(false);
    }
  }
  const periodName = (x: string) => (x.length === 4 ? `Whole year ${x}` : new Date(`${x}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }));
  // Totals for the current budget period (since the last reset).
  const current = lines.filter((l) => l.at > p.periodStart);
  const totals = {
    in: current.reduce((s, l) => s + l.creditCents, 0),
    out: current.reduce((s, l) => s + l.debitCents, 0),
    balance: lines.length ? lines[lines.length - 1]!.balanceCents : 0,
  };
  async function pdf() {
    try {
      downloadFile(await balanceSheetPdf(org, lines, day, totals));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }
  const csv = () => toCsv(['Date', 'Description', 'Money in (KES)', 'Money out (KES)', 'Balance (KES)'],
    lines.map((l) => [day(l.at), l.description, l.creditCents ? (l.creditCents / 100).toFixed(2) : '', l.debitCents ? (l.debitCents / 100).toFixed(2) : '', (l.balanceCents / 100).toFixed(2)]));

  return (
    <div className="page narrow wide-table">
      <div className="page-head">
        <h1>Balance sheet</h1>
        <span className="row-actions no-print">
          <button type="button" className="btn btn-primary" onClick={() => void pdf()} disabled={!lines.length}>Download PDF</button>
          <CsvButton name="petty-cash-balance-sheet.csv" csv={csv} />
        </span>
      </div>
      <PettyNav org={org} />
      <section className="card stack no-print">
        <h2>Excel for the accountant</h2>
        <p className="small muted">Every requisition, every expense line and the cash book, with amounts as numbers ready for the books or QuickBooks.</p>
        <div className="field-row">
          <label className="field"><span>Period</span>
            <select value={period || periods[1] || periods[0] || ''} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((x) => <option key={x} value={x}>{periodName(x)}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary align-start" disabled={!periods.length || excelBusy} onClick={() => void excel()}>{excelBusy ? 'Making Excel…' : 'Download Excel'}</button>
        </div>
      </section>
      <KpiRow label="Since the last reset">
        <KpiCard label="Money in" value={money(org, totals.in)} tone="ok" note="Signed top-ups" />
        <KpiCard label="Money out" value={money(org, totals.out)} tone="warn" note="Approved requests" />
        <KpiCard label="Balance now" value={money(org, totals.balance)} tone="gold" />
      </KpiRow>
      {lines.length === 0 ? <p className="muted small">Nothing yet. Top-ups appear as soon as they are made, and requests once they are approved.</p> : (
        <div className="card exam-table-wrap">
          <table className="table petty-ledger">
            <thead><tr><th>Date</th><th>Description</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th>{p.canSign && <th className="no-print" aria-label="Delete" />}</tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.kind === 'reset' ? 'petty-ledger-reset' : ''}>
                  <td className="nowrap">{day(l.at)}</td>
                  <td>{l.kind === 'request' ? <Link to={`${pettyCashBase(org.type)}/${l.id}`}>{l.description}</Link> : l.description}</td>
                  <td className="num nowrap ok-text">{l.creditCents ? money(org, l.creditCents) : ''}</td>
                  <td className="num nowrap danger-text">{l.debitCents ? money(org, l.debitCents) : ''}</td>
                  <td className="num nowrap"><strong>{money(org, l.balanceCents)}</strong></td>
                  {p.canSign && (
                    <td className="no-print">
                      <BinButton label={`Delete ${l.description}`} onClick={() => setDeleting(l)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AskDeleteDialog org={org} kind={deleting?.kind === 'request' ? 'request' : 'fund'} targetId={deleting?.id ?? ''} open={!!deleting} onClose={() => setDeleting(null)}
        title={deleting?.kind === 'request' ? 'Delete this requisition?' : deleting?.kind === 'reset' ? 'Delete this budget reset?' : 'Delete this top-up?'}
        body={deleting ? `${day(deleting.at)} · ${deleting.kind === 'request' ? `${deleting.description} · ${money(org, deleting.debitCents)}` : deleting.kind === 'topup' ? money(org, deleting.creditCents) : 'Reset to zero'}.` : ''} />
    </div>
  );
}

/** How much of the budget each category may use, and how much it has used since the last reset. */
export function PettyBudgetPage() {
  return <PettyGate title="Budget tracker">{(org) => <BudgetTracker org={org} />}</PettyGate>;
}

function BudgetTracker({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const cats = pettyCashCategoriesFor(org.type);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const rows = useMemo(() => categoryBudgets(cats, p.allocations, p.requisitions, p.periodStart, millis), [cats, p.allocations, p.requisitions, p.periodStart]);
  if (!p.seesAll) return <NoAccess />;
  const allocated = rows.reduce((s, r) => s + r.allocatedCents, 0);

  function edit() {
    setDraft(Object.fromEntries(cats.map((c) => [c, p.allocations[c] ? String(p.allocations[c]! / 100) : ''])));
  }
  function save() {
    if (!draft) return;
    const out: Record<string, number> = {};
    for (const c of cats) {
      const text = (draft[c] ?? '').trim();
      if (!text) continue;
      const cents = parseAmountCents(text);
      if (cents == null) { toast.show(`Check the amount for ${c}.`); return; }
      if (cents > 0) out[c] = cents;
    }
    saveAllocations(org.id, out).catch((err) => toast.show(friendlyError(err)));
    setDraft(null);
    toast.show('Category budgets saved');
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Budget tracker</h1>
        {p.canAuthorize && !draft && <button type="button" className="btn btn-primary" onClick={edit}>Set category budgets</button>}
      </div>
      <PettyNav org={org} />
      <KpiRow label="Budget">
        <KpiCard label="Total budget" value={money(org, p.summary.budgetCents)} note="Signed top-ups since the last reset" />
        <KpiCard label="Shared out to categories" value={money(org, allocated)} tone={allocated > p.summary.budgetCents ? 'warn' : 'ok'} note={allocated > p.summary.budgetCents ? 'More than the budget' : `${money(org, p.summary.budgetCents - allocated)} not shared out`} />
        <KpiCard label="Spent" value={money(org, p.summary.spentCents)} />
        <KpiCard label="Waiting for signatures" value={money(org, p.summary.pendingCents)} />
      </KpiRow>
      {draft ? (
        <section className="card stack">
          <h2>Category budgets</h2>
          <p className="small muted">How much of the petty cash budget each category may use until the next reset. Leave a box empty for no limit.</p>
          {cats.map((c) => (
            <label key={c} className="field"><span>{c} (KES)</span>
              <input inputMode="decimal" value={draft[c] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))} placeholder="No limit" />
            </label>
          ))}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </section>
      ) : (
        <>
          <BudgetHealth org={org} rows={rows} />
          <div className="card exam-table-wrap">
            <table className="table">
              <thead><tr><th>Category</th><th className="num">Budget</th><th className="num">Spent</th><th className="num">Waiting</th><th className="num">Left</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.category}>
                    <td>{r.category}</td>
                    <td className="num nowrap">{r.allocatedCents ? money(org, r.allocatedCents) : <span className="muted">No limit</span>}</td>
                    <td className="num nowrap">{money(org, r.spentCents)}</td>
                    <td className="num nowrap">{money(org, r.pendingCents)}</td>
                    <td className={`num nowrap${r.allocatedCents && r.allocatedCents - r.spentCents < 0 ? ' danger-text' : ''}`}>{r.allocatedCents ? money(org, r.allocatedCents - r.spentCents) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!p.canAuthorize && <p className="small muted">The signing stakeholders set the category budgets.</p>}
        </>
      )}
    </div>
  );
}

/** Month-end close (Andy, 2026-10-24): two stakeholders close an ended month, then nothing in it changes; the Director reopens. */
export function PettyMonthEndPage() {
  return <PettyGate title="Month end">{(org) => <MonthEnd org={org} />}</PettyGate>;
}

function MonthEnd({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const { receipts } = useReceipts(org);
  const { months } = usePettyMonths(org);
  const lines = useMemo(() => pettyLedger(p.funds, p.requisitions, millis), [p.funds, p.requisitions]);
  const [reopening, setReopening] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!p.seesAll) return <NoAccess />;
  const thisMonth = p.month;
  const list = [...new Set([...p.requisitions.map((r) => r.month), ...Object.keys(months)])].filter((m) => m < thisMonth).sort().reverse();
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const monthOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const facts = (m: string) => {
    const reqs = p.requisitions.filter((r) => r.month === m);
    const approved = reqs.filter((r) => r.status === 'approved').sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''));
    const waiting = reqs.filter((r) => r.status === 'submitted' || r.status === 'checked');
    const count = (id: string) => receipts.filter((x) => x.reqId === id).length;
    const book = lines.filter((l) => monthOf(l.at) === m);
    const before = lines.filter((l) => monthOf(l.at) < m);
    const opening = before.length ? before[before.length - 1]!.balanceCents : 0;
    return { approved, waiting, count, missing: approved.filter((r) => count(r.id) === 0).length, opening,
      in: book.reduce((n, l) => n + l.creditCents, 0), out: book.reduce((n, l) => n + l.debitCents, 0), closing: book.length ? book[book.length - 1]!.balanceCents : opening };
  };
  async function report(m: string) {
    const f = facts(m);
    const rec = months[m];
    const cats = new Map<string, { count: number; cents: number }>();
    f.approved.forEach((r) => { const c = cats.get(categoryLabel(r)) ?? { count: 0, cents: 0 }; cats.set(categoryLabel(r), { count: c.count + 1, cents: c.cents + r.totalCents }); });
    try {
      downloadFile(await monthReportPdf(org, {
        month: m, monthName: monthName(m), status: rec?.status === 'closed' ? 'Closed' : 'Not closed yet',
        openingCents: f.opening, inCents: f.in, outCents: f.out, closingCents: f.closing,
        byCategory: [...cats].map(([category, v]) => ({ category, ...v })),
        requests: f.approved.map((r) => ({ number: r.number ?? 'New', date: day(millis(r.createdAt) ?? Date.now()), requester: r.requesterName, category: categoryLabel(r), payee: r.payee ?? '', cents: r.totalCents, receipts: f.count(r.id) })),
        closedBy: rec?.status === 'closed' ? Object.values(rec.signatures).map((s) => ({ name: s.name, role: s.role, when: millis(s.at) ? day(millis(s.at)!) : '' })) : [],
        missingReceipts: f.missing,
      }));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }
  async function reopen(m: string) {
    if (!reason.trim()) { toast.show('Give a reason for reopening.'); return; }
    setBusy(true);
    try {
      await reopenPettyMonth(org.id, m, reason.trim());
      toast.show(`${monthName(m)} is open again.`);
      setReopening(null); setReason('');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      toast.show(e?.code?.startsWith('functions/') && e.message ? e.message : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Month end</h1></div>
      <PettyNav org={org} />
      <p className="small muted">Once a month has ended, any two stakeholders close it. After that no requisition, signature, receipt or deletion in that month can change. Only the Director can reopen a closed month, and must give a reason.</p>
      {list.length === 0 && <p className="muted small">No past months yet.</p>}
      {list.map((m) => {
        const f = facts(m);
        const rec = months[m];
        const closed = rec?.status === 'closed';
        const signed = rec?.status === 'closing' ? Object.entries(rec.signatures) : [];
        return (
          <section key={m} className="card stack">
            <div className="card-head">
              <h2>{monthName(m)}</h2>
              <span className={`badge${closed ? '' : ' badge-warn'}`}>{closed ? '🔒 Closed' : rec?.status === 'closing' ? `${signed.length} of ${MONTH_CLOSE_SIGNATURES} signed` : 'Open'}</span>
            </div>
            <ul className="petty-figures">
              <li><span>Opening</span><strong>{money(org, f.opening)}</strong></li>
              <li><span>In</span><strong>{money(org, f.in)}</strong></li>
              <li><span>Out</span><strong>{money(org, f.out)}</strong></li>
              <li><span>Closing</span><strong>{money(org, f.closing)}</strong></li>
            </ul>
            <p className="small">{f.approved.length} approved requisition{f.approved.length === 1 ? '' : 's'}{f.missing ? `, ${f.missing} without a receipt` : ''}{f.waiting.length ? `. ${f.waiting.length} still waiting for signatures` : ''}.</p>
            {closed && <p className="small muted">Closed by {Object.values(rec.signatures).map((s) => `${s.name}${s.enteredBy ? ` (entered by ${s.enteredBy})` : ''}`).join(' and ')}{millis(rec.closedAt) ? `, ${day(millis(rec.closedAt)!)}` : ''}.</p>}
            <div className="row-actions">
              <button type="button" className="btn btn-quiet" onClick={() => void report(m)}>Download month report (PDF)</button>
              {closed && p.isPastor && reopening !== m && <button type="button" className="btn btn-quiet danger-text" onClick={() => setReopening(m)}>Reopen</button>}
            </div>
            {reopening === m && (
              <div className="field-row">
                <label className="field"><span>Why reopen {monthName(m)}?</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
                <button type="button" className="btn btn-danger align-start" disabled={busy || !reason.trim()} onClick={() => void reopen(m)}>Reopen</button>
                <button type="button" className="btn btn-quiet align-start" onClick={() => { setReopening(null); setReason(''); }}>Cancel</button>
              </div>
            )}
            {!closed && (f.waiting.length ? (
              <p className="petty-warn small">Approve or reject the waiting requisitions ({f.waiting.map((r) => r.number ?? 'new').join(', ')}) before closing this month.</p>
            ) : (
              <>
                {f.missing > 0 && <p className="petty-warn small">{f.missing} approved requisition{f.missing === 1 ? ' has' : 's have'} no receipt. Receipts cannot be added after the month is closed, so add them first if you can.</p>}
                <PettySignBox label={`Close ${monthName(m)}: signature ${signed.length + 1} of ${MONTH_CLOSE_SIGNATURES}. Choose your name and type your own signing PIN.`} orgId={org.id}
                  exclude={signed.map(([uid]) => uid)} confirmLabel="Close the month"
                  sign={async (uid, pin) => {
                    const res = await closePettyMonth(org.id, m, uid, pin);
                    return res.status === 'closed' ? `${monthName(m)} is closed. Signed by ${res.name}.` : `Signed by ${res.name}. One more signature closes the month.`;
                  }} />
              </>
            ))}
            {rec?.history?.length ? (
              <details className="small"><summary>History</summary>
                <ul>{rec.history.map((h, i) => <li key={i}>{h.action === 'started' ? 'Close started' : h.action === 'closed' ? 'Closed' : h.action === 'reopened' ? 'Reopened' : 'Closing cancelled'} by {h.name}, {new Date(h.at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
