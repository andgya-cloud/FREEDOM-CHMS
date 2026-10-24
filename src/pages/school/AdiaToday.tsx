import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { attendanceAlerts, arrearsList, collectionRate, schoolMetrics } from '../../../functions/src/shared/school';
import { ColumnChart, Gauge, KpiCard, KpiRow, LineChart, Panel } from '../../components/charts';
import { money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

const WEEKS = 8;

/** "2026-10-22" moved by whole days, worked in UTC so it never slips across a time zone. */
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last eight Monday-to-Sunday weeks up to today, oldest first. */
function lastWeeks(today: string): { from: string; to: string; label: string }[] {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftKey(today, -dow);
  return Array.from({ length: WEEKS }, (_, i) => {
    const from = shiftKey(monday, -7 * (WEEKS - 1 - i));
    const [, m, d] = from.split('-');
    return { from, to: shiftKey(from, 6), label: `${d}/${m}` };
  });
}

/**
 * ADIA's Today dashboard: KPI cards, performance gauges and charts drawn from the
 * school's own records, in place of the church's weekly scorecard.
 */
export function AdiaToday({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();

  const input = useMemo(() => ({
    courses: s.courses, students: s.students, events: s.events, records: s.records, assessments: s.assessments, marks: s.marks,
    invoices: [], payments: [], outcomes: s.outcomes.map((o) => ({ studentId: o.studentId, months: o.months, status: o.status })), settings: s.settings,
  }), [s.courses, s.students, s.events, s.records, s.assessments, s.marks, s.outcomes, s.settings]);
  const metrics = useMemo(() => schoolMetrics(input), [input]);
  const weeks = useMemo(() => lastWeeks(s.today), [s.today]);
  const weekly = useMemo(() => weeks.map((w) => schoolMetrics(input, w).attendanceRate), [input, weeks]);
  const alerts = useMemo(() => attendanceAlerts(s.students, s.courses, s.events, s.records, s.settings.attendanceThreshold), [s.students, s.courses, s.events, s.records, s.settings]);

  if (s.loading) return null;

  const live = s.students.filter((x) => !x.deletedAt);
  const applicants = live.filter((x) => x.status === 'applicant').length;
  const billed = s.balances.reduce((a, b) => a + b.billedCents, 0);
  const paid = s.balances.reduce((a, b) => a + b.paidCents, 0);
  const collected = collectionRate(billed, paid);
  const arrears = arrearsList(s.balances, s.today);
  const arrearsCents = arrears.reduce((a, b) => a + b.balanceCents, 0);
  const thisWeek = weekly[WEEKS - 1] ?? null;
  const lastWeek = weekly[WEEKS - 2] ?? null;
  const marked = weekly.filter((v): v is number => v != null);
  const gauge = (label: string, v: number | null, caption?: string) => (
    <Gauge key={label} value={v ?? 0} max={100} label={label} display={pct(v)} caption={caption} bands={[0.5, 0.75]} />
  );

  return (
    <section className="stack adia-dash">
      <div className="page-head">
        <h2>At a glance</h2>
        <span className="row-actions">
          <Link to="/school" className="btn btn-primary">Full overview</Link>
          {can('finance.reports') && <Link to="/school/reports" className="btn btn-quiet">Reports</Link>}
        </span>
      </div>

      <KpiRow label="ADIA key figures">
        <KpiCard label="Students enrolled" value={String(metrics.enrolled)} tone="gold" note={`${applicants} ${applicants === 1 ? 'applicant' : 'applicants'} waiting`} to="/school/students" />
        <KpiCard label="Attendance this week" value={pct(thisWeek)} changes={[{ now: thisWeek, before: lastWeek, since: 'last week' }]} spark={marked.length > 1 ? marked : undefined} to="/attendance" />
        {s.feesAllowed
          ? <KpiCard label="Fees collected" value={pct(collected)} note={billed ? `${money(org, paid)} of ${money(org, billed)}` : 'No fees billed yet'} to="/school/fees" />
          : <KpiCard label="Pass rate" value={pct(metrics.passRate)} note="From marks entered so far" to="/school/results" />}
        {s.feesAllowed
          ? <KpiCard label="Fee arrears" value={money(org, arrearsCents)} tone={arrearsCents ? 'warn' : 'ok'} note={`${arrears.length} ${arrears.length === 1 ? 'student owes' : 'students owe'}`} to="/school/fees" />
          : <KpiCard label="Below attendance" value={String(alerts.length)} tone={alerts.length ? 'warn' : 'ok'} note={`Under ${s.settings.attendanceThreshold}% of classes`} to="/school" />}
      </KpiRow>

      <div className="dash-grid">
        <Panel title="Performance indicators" wide>
          <div className="gauges gauges-3">
            {gauge('Attendance', metrics.attendanceRate)}
            {gauge('Pass rate', metrics.passRate)}
            {gauge('Retention', metrics.retentionRate)}
            {s.feesAllowed && gauge('Fees collected', collected)}
          </div>
        </Panel>
        <Panel title="Weekly attendance">
          {marked.length === 0
            ? <p className="muted small">The trend appears once classes are marked in the register.</p>
            : <LineChart label="Attendance rate in each of the last eight weeks" labels={weeks.map((w) => w.label)} series={[{ name: 'Attendance', values: weekly }]} format={(v) => `${v}%`} axis={(v) => `${v}%`} />}
        </Panel>
        <Panel title="Students by department">
          <ColumnChart label="Enrolled students in each department" rows={metrics.byCourse.map((c) => ({ label: c.name.split(/[ &]/)[0] ?? c.name, value: c.enrolled }))} />
        </Panel>
      </div>
    </section>
  );
}
