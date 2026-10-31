import { useState } from 'react';
import type { Organization } from '../state/OrgContext';
import type { RequisitionRow } from '../state/usePettyCash';
import type { FundSummary } from '../../functions/src/shared/pettyCash';
import { formatMoney } from '../../functions/src/shared/giving';
import { Bars } from './Scorecard';
import { ColumnChart, CsvButton, Donut, Gauge, KpiCard, KpiRow, Panel } from './charts';
import { addMonths, monthsEnding, shortMonth, toCsv } from '../lib/analytics';

/**
 * Petty cash at a glance, for the people who see every requisition: how much
 * of the budget is used, approved spending month by month, where it went by
 * category, and who asked for most. Only this organization's requisitions.
 */
export function PettyInsights({ org, month, requisitions, summary }: { org: Organization; month: string; requisitions: RequisitionRow[]; summary: FundSummary }) {
  const [span, setSpan] = useState<6 | 12>(6);
  const kes = (c: number) => formatMoney(Math.round(c / 100) * 100, org.currency || 'KES');
  const months = monthsEnding(month, span);
  const approved = requisitions.filter((r) => r.status === 'approved' && r.month >= months[0]! && r.month <= month);
  const perMonth = (m: string) => approved.filter((r) => r.month === m).reduce((s, r) => s + r.totalCents, 0);
  const countIn = (m: string) => approved.filter((r) => r.month === m).length;
  const byCategory = new Map<string, number>();
  const byPerson = new Map<string, number>();
  for (const r of approved) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.totalCents);
    byPerson.set(r.requesterName, (byPerson.get(r.requesterName) ?? 0) + r.totalCents);
  }
  const total = approved.reduce((s, r) => s + r.totalCents, 0);
  const waiting = requisitions.filter((r) => r.status === 'submitted' || r.status === 'checked');
  const last = addMonths(month, -1);
  const used = summary.budgetCents > 0 ? summary.spentCents / summary.budgetCents : 0;

  return (
    <section className="stack petty-insights">
      <div className="page-head">
        <h2>Spending at a glance</h2>
        <span className="row-actions">
          <div className="segmented no-print" role="group" aria-label="How many months">
            {([6, 12] as const).map((n) => <button key={n} type="button" className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n} months</button>)}
          </div>
          <CsvButton name={`Petty-cash-${month}.csv`} csv={() => toCsv(
            ['Number', 'Month', 'Requested by', 'Category', 'Amount', 'Checked by', 'Approved by'],
            approved.map((r) => [r.number, r.month, r.requesterName, r.category, (r.totalCents / 100).toFixed(2), r.checked?.name ?? '', r.approved?.name ?? '']),
          )} />
        </span>
      </div>
      <KpiRow label="Petty cash figures">
        <KpiCard label={`Approved in ${shortMonth(month)}`} value={kes(perMonth(month))} tone="gold" spark={months.map(perMonth)}
          changes={[{ now: perMonth(month), before: perMonth(last) || null, since: shortMonth(last) }]} note={`${countIn(month)} requisitions`} />
        <KpiCard label="Waiting for a signature" value={kes(summary.pendingCents)} tone={waiting.length ? 'warn' : 'ok'} note={`${waiting.length} ${waiting.length === 1 ? 'request' : 'requests'}`} />
        <KpiCard label={`Average a month, last ${span}`} value={kes(total / span)} note={`${kes(total)} in all`} />
        <KpiCard label="Average request" value={kes(approved.length ? total / approved.length : 0)} note={`${approved.length} approved`} />
      </KpiRow>
      <div className="dash-grid">
        <Panel title="Budget used">
          <Gauge value={summary.spentCents} max={summary.budgetCents} label="Since the last reset"
            display={summary.budgetCents ? `${Math.round(used * 100)}%` : '–'}
            caption={summary.budgetCents ? `${kes(summary.spentCents)} of ${kes(summary.budgetCents)}` : 'No budget added yet'} />
          {summary.remainingCents < 0 && <p className="notice notice-warn small">Spending is {kes(-summary.remainingCents)} over the budget.</p>}
        </Panel>
        <Panel title="Approved each month">
          <ColumnChart label="Approved petty cash each month" rows={months.map((m) => ({ label: shortMonth(m), value: perMonth(m) / 100 }))} format={(v) => kes(v * 100)} height={170} />
        </Panel>
        <Panel title="By category">
          <Donut label="Approved spending by category" rows={[...byCategory].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} format={kes} />
        </Panel>
        <Panel title="Who asked for most">
          {byPerson.size === 0 ? <p className="muted">Nothing approved yet.</p>
            : <Bars rows={[...byPerson].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))} format={kes} />}
        </Panel>
      </div>
    </section>
  );
}
