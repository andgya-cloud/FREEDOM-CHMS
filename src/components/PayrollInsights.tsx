import type { Organization } from '../state/OrgContext';
import type { PayRun, StaffRow } from '../state/usePayroll';
import { loanRepaidCents } from '../../functions/src/shared/payroll';
import { formatMoney } from '../../functions/src/shared/giving';
import { Bars } from './Scorecard';
import { Donut, KpiCard, KpiRow, LineChart, Panel } from './charts';
import { addMonths, monthsEnding, shortMonth } from '../lib/analytics';

/**
 * Payroll at a glance, from approved pay runs: what each month cost ADIA,
 * where the latest month's money went, and what staff still owe on loans.
 */
export function PayrollInsights({ org, runs, staff }: { org: Organization; runs: PayRun[]; staff: StaffRow[] }) {
  const kes = (c: number) => formatMoney(Math.round(c / 100) * 100, org.currency || 'KES');
  const approved = runs.filter((r) => r.status === 'approved');
  const latest = approved[0];
  if (!latest) return null;
  const byMonth = new Map(approved.map((r) => [r.month, r]));
  const months = monthsEnding(latest.month, 12);
  const prev = byMonth.get(addMonths(latest.month, -1));
  const t = latest.totals;
  const statutory = (x: PayRun['totals']) => x.payeCents + x.nssfCents + x.shifCents + x.housingCents + x.employerNssfCents + x.employerHousingCents;
  const ytd = approved.filter((r) => r.month.startsWith(latest.month.slice(0, 4))).reduce((s, r) => s + r.totals.employerCostCents, 0);
  const loans = staff.flatMap((s) => (s.loans ?? []).map((l) => ({ name: s.name, left: Math.max(0, l.principalCents - loanRepaidCents(s.id, l.id, runs)) }))).filter((l) => l.left > 0);
  const loanByStaff = new Map<string, number>();
  for (const l of loans) loanByStaff.set(l.name, (loanByStaff.get(l.name) ?? 0) + l.left);
  const owed = loans.reduce((s, l) => s + l.left, 0);
  const val = (f: (x: PayRun['totals']) => number) => months.map((m) => { const r = byMonth.get(m); return r ? f(r.totals) / 100 : null; });

  return (
    <section className="stack petty-insights">
      <h2>Payroll at a glance</h2>
      <KpiRow label="Payroll figures">
        <KpiCard label={`Cost to ADIA, ${shortMonth(latest.month, true)}`} value={kes(t.employerCostCents)} tone="gold"
          spark={months.map((m) => byMonth.get(m)?.totals.employerCostCents ?? 0)}
          changes={[{ now: t.employerCostCents, before: prev?.totals.employerCostCents ?? null, since: shortMonth(addMonths(latest.month, -1)) }]} />
        <KpiCard label="Net pay to staff" value={kes(t.netCents)} note={`${t.staff} staff`}
          changes={[{ now: t.netCents, before: prev?.totals.netCents ?? null, since: shortMonth(addMonths(latest.month, -1)) }]} />
        <KpiCard label="Taxes and statutory" value={kes(statutory(t))} note="PAYE, NSSF, SHIF and Housing Levy, both shares" />
        <KpiCard label={`Payroll cost in ${latest.month.slice(0, 4)}`} value={kes(ytd)} note={owed ? `Staff loans still owed: ${kes(owed)}` : 'No staff loans owed'} />
      </KpiRow>
      <div className="dash-grid">
        <Panel title="Twelve months of payroll" wide>
          <LineChart label="Payroll cost, gross pay and net pay each month" labels={months.map((m) => shortMonth(m))} format={(v) => kes(v * 100)}
            series={[{ name: 'Cost to ADIA', values: val((x) => x.employerCostCents) }, { name: 'Gross pay', values: val((x) => x.grossCents) }, { name: 'Net pay', values: val((x) => x.netCents) }]} />
        </Panel>
        <Panel title={`Where ${shortMonth(latest.month)}'s money went`}>
          <Donut label="Payroll cost split" format={kes} center={kes(t.employerCostCents).replace(/^\w+ /, '')} centerNote="cost to ADIA" rows={[
            { label: 'Net pay', value: t.netCents },
            { label: 'PAYE', value: t.payeCents },
            { label: 'NSSF', value: t.nssfCents + t.employerNssfCents },
            { label: 'Housing Levy', value: t.housingCents + t.employerHousingCents },
            { label: 'SHIF', value: t.shifCents },
            { label: 'Loans and other', value: t.otherDeductionsCents },
          ]} />
        </Panel>
        <Panel title="Staff loans owed">
          {loanByStaff.size === 0 ? <p className="muted">No staff owe anything on loans.</p>
            : <Bars rows={[...loanByStaff].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} format={kes} />}
        </Panel>
      </div>
    </section>
  );
}
