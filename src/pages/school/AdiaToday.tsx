import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { setupSchool } from '../../lib/schoolWrites';
import { useFunds } from '../../state/useGiving';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { attendanceAlerts, arrearsList, capacityOf, collectionRate, schoolMetrics, STUDENT_STATUSES, STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';
import { ADIA_PROGRAMMES } from '../../../functions/src/shared/schoolSetup';
import { ColumnChart, Donut, Gauge, KpiCard, KpiRow, LineChart, Panel } from '../../components/charts';
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
 * ADIA's one dashboard, on Today (Andy, 2026-10-26, 1A): the school's figures, gauges and charts, and
 * underneath, folded away, who needs attention. It replaced the School Overview page, which repeated it.
 */
export function AdiaToday({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const { funds } = useFunds(org.id);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const input = useMemo(() => ({
    courses: s.courses, students: s.students, events: s.events, records: s.records, assessments: s.assessments, marks: s.marks,
    invoices: [], payments: [], outcomes: s.outcomes.map((o) => ({ studentId: o.studentId, months: o.months, status: o.status })), settings: s.settings,
  }), [s.courses, s.students, s.events, s.records, s.assessments, s.marks, s.outcomes, s.settings]);
  const metrics = useMemo(() => schoolMetrics(input), [input]);
  const weeks = useMemo(() => lastWeeks(s.today), [s.today]);
  const weekly = useMemo(() => weeks.map((w) => schoolMetrics(input, w).attendanceRate), [input, weeks]);
  const alerts = useMemo(() => attendanceAlerts(s.students, s.courses, s.events, s.records, s.settings.attendanceThreshold), [s.students, s.courses, s.events, s.records, s.settings]);

  if (s.loading) return null;

  const needsSetup = s.courses.length === 0 || !s.settingsSaved || !funds.some((f) => f.id === 'school_fees');
  async function setup() {
    setBusy(true);
    try {
      await setupSchool(org.id, { courses: s.courses.map((c) => c.id), hasSettings: s.settingsSaved, hasFund: funds.some((f) => f.id === 'school_fees') });
      toast.show('ADIA is set up.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const live = s.students.filter((x) => !x.deletedAt);
  const statusCount = (k: (typeof STUDENT_STATUSES)[number]) => live.filter((x) => x.status === k).length;
  const billed = s.balances.reduce((a, b) => a + b.billedCents, 0);
  const paid = s.balances.reduce((a, b) => a + b.paidCents, 0);
  const collected = collectionRate(billed, paid);
  const arrears = arrearsList(s.balances, s.today);
  const arrearsCents = arrears.reduce((a, b) => a + b.balanceCents, 0);
  const due = s.outcomes.filter((o) => o.status == null && o.due <= s.today).sort((a, b) => a.due.localeCompare(b.due));
  const thisWeek = weekly[WEEKS - 1] ?? null;
  const lastWeek = weekly[WEEKS - 2] ?? null;
  const marked = weekly.filter((v): v is number => v != null);
  const gauge = (label: string, v: number | null, caption?: string) => (
    <Gauge key={label} value={v ?? 0} max={100} label={label} display={pct(v)} caption={caption} bands={[0.5, 0.75]} />
  );

  // Cohorts down the side, departments across: how many students hold a place in each class.
  const intakes = s.intakes.filter((i) => i.active !== false).map((i) => ({ i, c: capacityOf(i, s.students) }));
  const cohortNames = [...new Set(intakes.map(({ i }) => i.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const deptIds = s.courses.filter((c) => intakes.some(({ i }) => i.courseId === c.id)).map((c) => c.id);
  const placeCell = (cohort: string, courseId: string) => intakes.filter(({ i }) => i.name === cohort && i.courseId === courseId);
  const placesIn = (list: typeof intakes) => list.reduce((n, { c }) => n + c.taken, 0);

  return (
    <section className="stack adia-dash">
      {needsSetup && (
        <section className="card stack">
          <h2>Set up the school</h2>
          <p className="small">This adds the four programmes ({ADIA_PROGRAMMES.join(', ')}), the grading settings and a School fees fund. Levels, units, trainers and timetables are for the school to enter. Nothing else is filled in for you.</p>
          {can('settings.manage') ? <button type="button" className="btn btn-primary align-start" disabled={busy} onClick={() => void setup()}>{busy ? 'Setting up…' : 'Set up now'}</button>
            : <p className="muted small">Ask the pastor to set this up.</p>}
        </section>
      )}

      <KpiRow label="ADIA key figures">
        <KpiCard label="Students enrolled" value={String(metrics.enrolled)} tone="gold" note={`${statusCount('applicant')} ${statusCount('applicant') === 1 ? 'applicant' : 'applicants'} waiting`} to="/school/students" />
        <KpiCard label="Attendance this week" value={pct(thisWeek)} changes={[{ now: thisWeek, before: lastWeek, since: 'last week' }]} spark={marked.length > 1 ? marked : undefined} to="/attendance" />
        <KpiCard label="Graduated" value={String(statusCount('graduated'))} tone="ok" note={`Working at 6 months: ${pct(metrics.employmentRate)}`} to="/school/graduation" />
        {s.feesAllowed
          ? <KpiCard label="Fee arrears" value={money(org, arrearsCents)} tone={arrearsCents ? 'warn' : 'ok'} note={`${arrears.length} ${arrears.length === 1 ? 'student owes' : 'students owe'}`} to="/school/fees" />
          : <KpiCard label="Below attendance" value={String(alerts.length)} tone={alerts.length ? 'warn' : 'ok'} note={`Under ${s.settings.attendanceThreshold}% of classes`} />}
      </KpiRow>

      <div className="dash-grid">
        <Panel title="How the school is doing" wide>
          <div className="gauges gauges-3">
            {gauge('Attendance', metrics.attendanceRate)}
            {gauge('Pass rate', metrics.passRate)}
            {gauge('Retention', metrics.retentionRate)}
            {gauge('Graduation', metrics.graduationRate)}
            {gauge('Working at 6 months', metrics.employmentRate)}
            {s.feesAllowed && gauge('Fees collected', collected, billed ? `${money(org, paid)} of ${money(org, billed)}` : undefined)}
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
        <Panel title="Where every student is" wide>
          <Donut label="Students by status" rows={STUDENT_STATUSES.map((k) => ({ label: STUDENT_STATUS_LABELS[k], value: statusCount(k) }))} center={String(live.length)} centerNote="students" />
        </Panel>
      </div>

      {/* Lists, folded to one line each until opened (Andy, 2026-10-26, 1A). */}
      <details className="card fold-card">
        <summary><span>Students in each cohort and department</span><span className="muted small">{placesIn(intakes)} places</span></summary>
        {intakes.length === 0 ? <p className="muted small">No intakes yet. Add one under <Link to="/school/courses">School → Programmes</Link>.</p> : (
          <div className="exam-table-wrap">
            <table className="table">
              <thead><tr><th>Cohort</th>{deptIds.map((id) => <th key={id} className="num">{s.courseName(id)}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                {cohortNames.map((name) => {
                  const row = intakes.filter(({ i }) => i.name === name);
                  return (
                    <tr key={name}>
                      <td className="nowrap"><Link to="/school/students">{name}</Link></td>
                      {deptIds.map((id) => {
                        const cell = placeCell(name, id);
                        const cap = cell.reduce((n, { i }) => (i.capacity != null ? n + i.capacity : n), 0);
                        return <td key={id} className="num">{cell.length ? <>{placesIn(cell)}{cap > 0 && <span className="muted small"> of {cap}</span>}</> : <span className="muted">–</span>}</td>;
                      })}
                      <td className="num"><strong>{placesIn(row)}</strong></td>
                    </tr>
                  );
                })}
                <tr>
                  <td><strong>Total</strong></td>
                  {deptIds.map((id) => <td key={id} className="num"><strong>{placesIn(intakes.filter(({ i }) => i.courseId === id))}</strong></td>)}
                  <td className="num"><strong>{placesIn(intakes)}</strong></td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">Counts enrolled students and applicants. Students who have graduated, withdrawn or deferred don't hold a place.</p>
          </div>
        )}
      </details>

      <details className="card fold-card">
        <summary><span>Attendance below {s.settings.attendanceThreshold}%</span><span className={alerts.length ? 'badge badge-warn' : 'muted small'}>{alerts.length || 'Nobody'}</span></summary>
        {alerts.length === 0 ? <p className="muted small">Nobody, from the classes marked so far (needs at least 3 classes).</p> : (
          <ul className="link-list">
            {alerts.map((a) => (
              <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{a.percent}% of {a.held} classes</span></Link></li>
            ))}
          </ul>
        )}
      </details>

      {s.feesAllowed && (
        <details className="card fold-card">
          <summary><span>Fee arrears</span><span className={arrears.length ? 'badge badge-warn' : 'muted small'}>{arrears.length || 'Nobody'}</span></summary>
          {arrears.length === 0 ? <p className="muted small">Nobody owes fees.</p> : (
            <ul className="link-list">
              {arrears.slice(0, 10).map((a) => (
                <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{money(org, a.balanceCents)}{a.overdue ? ' · overdue' : ''}</span></Link></li>
              ))}
            </ul>
          )}
          <Link to="/school/fees" className="btn btn-quiet align-start">All fees</Link>
        </details>
      )}

      <details className="card fold-card">
        <summary><span>Graduate follow-ups due</span><span className={due.length ? 'badge badge-warn' : 'muted small'}>{due.length || 'None'}</span></summary>
        {due.length === 0 ? <p className="muted small">None due.</p> : (
          <ul className="link-list">
            {due.slice(0, 10).map((o) => <li key={o.id}><Link to="/school/graduation"><span className="link-title">{s.nameOf(o.studentId)}</span><span className="link-detail">{o.months}-month check · due {formatDateKey(o.due)}</span></Link></li>)}
          </ul>
        )}
      </details>
    </section>
  );
}
