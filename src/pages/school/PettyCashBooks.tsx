import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { millis, usePettyCash, usePettyMonths, useReceipts } from '../../state/usePettyCash';
import { downloadFile } from '../../lib/givingPdf';
import { categoryLabel, pettyCashBase, pettyCashCategoriesFor, PETTY_CASH_STATUS_LABELS } from '../../../functions/src/shared/pettyCash';
import { KpiCard, KpiRow } from '../../components/charts';
import { money } from './common';
import { NoAccess, packGroup, PettyGate, PettyNav, ReceiptsBox, RequisitionList, savePack } from './PettyCashPage';
import { needsReceipt, receiptStatus } from '../../lib/receiptNames';
import type { Organization } from '../../state/OrgContext';
import { pettyReport, periodName, REPORT_APPROVERS, REPORT_PREPARED_BY } from '../../../functions/src/shared/pettyReport';
import { PettyInsights } from '../../components/PettyInsights';
import { BankMatchCard } from './BankMatchCard';

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
      <BankMatchCard org={org} />
      <KpiRow label="Receipts">
        <KpiCard label="Receipts kept" value={String(inView.reduce((n, r) => n + receiptsOf(r.id).length, 0))} />
        <KpiCard label="Complete" value={String(approved.length - missing.length)} tone="ok" note="Approved, with a receipt" />
        <KpiCard label="Receipt needed" value={String(missing.length)} tone={missing.length ? 'warn' : 'ok'} note="Approved, no receipt yet" />
      </KpiRow>
      <div className="segmented" role="group" aria-label="Which requisitions">
        <button type="button" className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>Receipt needed ({missing.length})</button>
        <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All requisitions</button>
      </div>
      {list.length === 0 ? <p className="muted small">{show === 'missing' ? 'Every approved requisition here has a receipt.' : '🌱 Nothing here yet.'}</p> : (
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
                  <span className={`badge${n || r.bankProof || r.status !== 'approved' ? '' : ' badge-warn'}`}>{n ? `📎 ${n} receipt${n === 1 ? '' : 's'}` : r.bankProof ? '🏦 Bank payment' : 'No receipt yet'}</span>
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

/** The old Balance sheet, Budget tracker and Month end pages now open Reports (Andy, 2026-11-09, 1A 2A 3A). */
export function PettyBalanceSheetPage() { return <PettyReportsPage />; }
export const PettyBudgetPage = PettyBalanceSheetPage;
export const PettyMonthEndPage = PettyBalanceSheetPage;

/**
 * The professional monthly report (Andy, 2026-11-08): pick a month or a whole year and who approves it,
 * then download it as PDF or Excel. Same in ADIA, Freedom Church and Hope.
 */
function MonthlyReportCard({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const { receipts } = useReceipts(org);
  const periods = useMemo(() => {
    const ms = [...p.requisitions.filter((r) => r.status === 'approved').map((r) => millis(r.approved?.at)), ...p.funds.filter((f) => f.status === 'done').map((f) => millis(f.doneAt))]
      .filter((x): x is number => x != null);
    const months = [...new Set(ms.map((x) => new Date(x + 3 * 3_600_000).toISOString().slice(0, 7)))].sort().reverse();
    return [...new Set(months.map((x) => x.slice(0, 4)))].flatMap((y) => [...months.filter((x) => x.startsWith(y)), y]);
  }, [p.requisitions, p.funds]);
  const [period, setPeriod] = useState('');
  const [approver, setApprover] = useState<string>(REPORT_APPROVERS[0]);
  const [busy, setBusy] = useState<'' | 'pdf' | 'excel'>('');
  const chosen = period || periods[0] || '';
  async function make(kind: 'pdf' | 'excel') {
    if (!chosen) return;
    setBusy(kind);
    try {
      const counts = receipts.reduce<Record<string, number>>((n, rc) => ({ ...n, [rc.reqId]: (n[rc.reqId] ?? 0) + 1 }), {});
      const rep = pettyReport(chosen, p.funds, p.requisitions, counts, millis);
      if (kind === 'pdf') {
        const { pettyReportPdf } = await import('../../lib/pettyPdf');
        downloadFile(await pettyReportPdf(org, rep, approver));
      } else {
        const { pettyReportWorkbook } = await import('../../lib/pettyExcel');
        downloadFile(await pettyReportWorkbook(org.name, rep, approver));
      }
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="card stack no-print">
      <h2>Monthly report</h2>
      <p className="small muted">Opening and closing balance, money in and out, spending by category against the period before, every voucher and top-up, the checks and the sign-off lines.</p>
      <div className="field-row">
        <label className="field"><span>Period</span>
          <select value={chosen} onChange={(e) => setPeriod(e.target.value)} disabled={!periods.length}>
            {periods.map((x) => <option key={x} value={x}>{x.length === 4 ? `Whole year ${x}` : periodName(x)}</option>)}
          </select>
        </label>
        <label className="field"><span>Approved by</span>
          <select value={approver} onChange={(e) => setApprover(e.target.value)}>
            {REPORT_APPROVERS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className="small muted">Prepared by {REPORT_PREPARED_BY.name} ({REPORT_PREPARED_BY.role}).</p>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={!chosen || !!busy} onClick={() => void make('pdf')}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</button>
        <button type="button" className="btn" disabled={!chosen || !!busy} onClick={() => void make('excel')}>{busy === 'excel' ? 'Making Excel…' : 'Download Excel'}</button>
      </div>
    </section>
  );
}

/** Reports: approved requisitions by month (moved off the Overview, Andy 2026-10-24), with the other reports one tap away. */
export function PettyReportsPage() {
  return <PettyGate title="Reports">{(org) => <Reports org={org} />}</PettyGate>;
}

function Reports({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const approved = p.requisitions.filter((r) => r.status === 'approved');
  const months = useMemo(() => [...new Set(approved.map((r) => r.month))].sort().reverse(), [approved]);
  const [month, setMonth] = useState('');
  if (!p.seesAll) return <NoAccess />;
  const shown = month || months[0] || '';
  const rows = approved.filter((r) => r.month === shown);
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Reports</h1></div>
      <PettyNav org={org} />
      <MonthlyReportCard org={org} />
      <section className="card stack">
        <div className="card-head">
          <h2>Approved requisitions</h2>
          {months.length > 0 && (
            <select aria-label="Month" value={shown} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          )}
        </div>
        {rows.length > 0 && <p className="small muted">{rows.length} approved, {money(org, rows.reduce((n, r) => n + r.totalCents, 0))} in total.</p>}
        <RequisitionList org={org} rows={rows} empty="Nothing approved yet." />
      </section>
      {/* The spending charts moved here from the Overview (Andy, 2026-11-09, 4A). */}
      {!p.loading && (
        <details className="card fold-card">
          <summary>See spending charts</summary>
          <PettyInsights org={org} month={p.month} requisitions={p.requisitions} summary={p.summary} />
        </details>
      )}
      {(p.isPastor || p.seesRegister) && <p className="small"><Link to={`${pettyCashBase(org.type)}/bin`}>Bin and deletion register</Link></p>}
    </div>
  );
}
