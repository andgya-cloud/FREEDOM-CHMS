import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { millis, usePettyCash, useReceipts } from '../../state/usePettyCash';
import { saveAllocations } from '../../lib/pettyCashWrites';
import { AskDeleteDialog, BinButton } from './PettyBin';
import { balanceSheetPdf } from '../../lib/pettyPdf';
import { downloadFile } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { type LedgerLine, categoryBudgets, categoryLabel, parseAmountCents, pettyCashBase, pettyCashCategoriesFor, pettyLedger, PETTY_CASH_STATUS_LABELS } from '../../../functions/src/shared/pettyCash';
import { CsvButton, KpiCard, KpiRow } from '../../components/charts';
import { money } from './common';
import { BudgetHealth, NoAccess, PettyGate, PettyNav, ReceiptsBox } from './PettyCashPage';
import type { Organization } from '../../state/OrgContext';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });

/** Every requisition's receipts in one place, one folder per requisition, for those who see all requisitions. */
export function PettyReceiptsPage() {
  return <PettyGate title="Receipts">{(org) => <Receipts org={org} />}</PettyGate>;
}

function Receipts({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const { receipts } = useReceipts(org);
  const [show, setShow] = useState<'missing' | 'all'>('missing');
  const [open, setOpen] = useState<string | null>(null);
  if (!p.seesAll) return <NoAccess />;
  const countFor = (id: string) => receipts.filter((r) => r.reqId === id).length;
  const approved = p.requisitions.filter((r) => r.status === 'approved');
  const list = (show === 'missing' ? approved.filter((r) => countFor(r.id) === 0) : p.requisitions.filter((r) => r.status !== 'rejected'));
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Receipts</h1></div>
      <PettyNav org={org} />
      <KpiRow label="Receipts">
        <KpiCard label="Receipts kept" value={String(receipts.length)} />
        <KpiCard label="Approved requests" value={String(approved.length)} />
        <KpiCard label="Approved without a receipt" value={String(approved.filter((r) => countFor(r.id) === 0).length)} tone={approved.some((r) => countFor(r.id) === 0) ? 'warn' : 'ok'} />
      </KpiRow>
      <div className="segmented" role="group" aria-label="Which requisitions">
        <button type="button" className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')}>Approved, no receipt yet</button>
        <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All requisitions</button>
      </div>
      {list.length === 0 ? <p className="muted small">{show === 'missing' ? 'Every approved request has a receipt.' : 'No requisitions yet.'}</p> : (
        <ul className="petty-folders">
          {list.map((r) => {
            const n = countFor(r.id);
            const isOpen = open === r.id;
            return (
              <li key={r.id} className="card">
                <button type="button" className="petty-folder" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className="petty-folder-name">{r.number ?? 'New request'} · {r.requesterName}</span>
                  <span className="small muted">{money(org, r.totalCents)} · {categoryLabel(r)} · {PETTY_CASH_STATUS_LABELS[r.status]}</span>
                  <span className={`badge${n ? '' : ' badge-warn'}`}>{n} receipt{n === 1 ? '' : 's'}</span>
                </button>
                {isOpen && <ReceiptsBox org={org} req={r} receipts={receipts.filter((x) => x.reqId === r.id)} />}
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
  if (!p.seesAll) return <NoAccess />;
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
