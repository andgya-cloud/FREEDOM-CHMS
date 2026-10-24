import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { setupSchool } from '../../lib/schoolWrites';
import { useFunds } from '../../state/useGiving';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { arrearsList, attendanceAlerts, capacityOf, collectionRate, OUTCOME_LABELS, schoolMetrics, STUDENT_STATUSES, STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';
import { Donut, Gauge, KpiCard, KpiRow, Panel } from '../../components/charts';
import { ADIA_PROGRAMMES } from '../../../functions/src/shared/schoolSetup';
import { SchoolGate, SchoolNav, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

/** ADIA home: the school's numbers, who needs attention, and first-time setup. */
export function SchoolHome() {
  return <SchoolGate title="Training centre">{(org) => <Home org={org} />}</SchoolGate>;
}

function Home({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const { funds } = useFunds(org.id);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const metrics = useMemo(() => schoolMetrics({
    courses: s.courses, students: s.students, events: s.events, records: s.records, assessments: s.assessments, marks: s.marks,
    invoices: [], payments: [], outcomes: s.outcomes.map((o) => ({ studentId: o.studentId, months: o.months, status: o.status })), settings: s.settings,
  }), [s.courses, s.students, s.events, s.records, s.assessments, s.marks, s.outcomes, s.settings]);
  const alerts = useMemo(() => attendanceAlerts(s.students, s.courses, s.events, s.records, s.settings.attendanceThreshold), [s.students, s.courses, s.events, s.records, s.settings]);
  const billed = s.balances.reduce((a, b) => a + b.billedCents, 0);
  const paid = s.balances.reduce((a, b) => a + b.paidCents, 0);
  const arrears = arrearsList(s.balances, s.today);
  const due = s.outcomes.filter((o) => o.status == null && o.due <= s.today).sort((a, b) => a.due.localeCompare(b.due));
  const needsSetup = !s.loading && (s.courses.length === 0 || !s.settingsSaved || !funds.some((f) => f.id === 'school_fees'));

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
  const arrearsCents = arrears.reduce((a, b) => a + b.balanceCents, 0);
  const collected = collectionRate(billed, paid);
  const rate = (label: string, v: number | null, caption?: string) => (
    <Gauge key={label} value={v ?? 0} max={100} label={label} display={pct(v)} caption={caption} bands={[0.5, 0.75]} />
  );
  const intakes = s.intakes.filter((i) => i.active !== false).map((i) => ({ i, c: capacityOf(i, s.students) }));
  // Cohorts down the side, departments across: how many students hold a place in each class.
  const cohortNames = [...new Set(intakes.map(({ i }) => i.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const deptIds = s.courses.filter((c) => intakes.some(({ i }) => i.courseId === c.id)).map((c) => c.id);
  const placeCell = (cohort: string, courseId: string) => intakes.filter(({ i }) => i.name === cohort && i.courseId === courseId);
  const placesIn = (list: typeof intakes) => list.reduce((n, { c }) => n + c.taken, 0);

  return (
    <div className="page narrow">
      <div className="page-head"><h1>{org.name}</h1></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      {needsSetup && (
        <section className="card stack">
          <h2>Set up the school</h2>
          <p className="small">This adds the four programmes ({ADIA_PROGRAMMES.join(', ')}), the grading settings and a School fees fund. Levels, units, trainers and timetables are for the school to enter. Nothing else is filled in for you.</p>
          {can('settings.manage') ? <button type="button" className="btn btn-primary align-start" disabled={busy} onClick={() => void setup()}>{busy ? 'Setting up…' : 'Set up now'}</button>
            : <p className="muted small">Ask the pastor to set this up.</p>}
        </section>
      )}
      <KpiRow label="School numbers">
        <KpiCard label="Enrolled" value={String(metrics.enrolled)} tone="gold" note={`${statusCount('applicant')} applicants waiting`} to="/school/students" />
        <KpiCard label="Graduated" value={String(statusCount('graduated'))} tone="ok" note={`Working at 6 months: ${pct(metrics.employmentRate)}`} to="/school/graduation" />
        <KpiCard label="Withdrawn" value={String(metrics.withdrawn)} tone={metrics.withdrawn ? 'warn' : 'ok'} note={`Retention ${pct(metrics.retentionRate)}`} />
        {s.feesAllowed
          ? <KpiCard label="Fee arrears" value={money(org, arrearsCents)} tone={arrearsCents ? 'warn' : 'ok'} note={`${arrears.length} ${arrears.length === 1 ? 'student owes' : 'students owe'}`} to="/school/fees" />
          : <KpiCard label="Below attendance" value={String(alerts.length)} tone={alerts.length ? 'warn' : 'ok'} note={`Under ${s.settings.attendanceThreshold}% of classes`} />}
      </KpiRow>

      <div className="dash-grid">
        <Panel title="How the school is doing" wide>
          <div className="gauges gauges-3">
            {rate('Attendance', metrics.attendanceRate)}
            {rate('Pass rate', metrics.passRate)}
            {rate('Retention', metrics.retentionRate)}
            {rate('Graduation', metrics.graduationRate)}
            {rate('Working at 6 months', metrics.employmentRate)}
            {s.feesAllowed && rate('Fees collected', collected, billed ? `${money(org, paid)} of ${money(org, billed)}` : undefined)}
          </div>
        </Panel>
        <Panel title="Students by programme">
          <Donut label="Enrolled students by programme" rows={metrics.byCourse.map((c) => ({ label: c.name, value: c.enrolled }))} center={String(metrics.enrolled)} centerNote="enrolled" />
        </Panel>
        <Panel title="Where every student is">
          <Donut label="Students by status" rows={STUDENT_STATUSES.map((k) => ({ label: STUDENT_STATUS_LABELS[k], value: statusCount(k) }))} center={String(live.length)} centerNote="students" />
        </Panel>
        <Panel title="Students in each cohort and department" wide>
          {intakes.length === 0 ? <p className="muted small">No intakes yet. Add one under <Link to="/school/courses">Courses</Link>.</p> : (
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
        </Panel>
      </div>

      <section className="card stack">
        <h2>Attendance below {s.settings.attendanceThreshold}%</h2>
        {alerts.length === 0 ? <p className="muted small">Nobody, from the classes marked so far (needs at least 3 classes).</p> : (
          <ul className="link-list">
            {alerts.map((a) => (
              <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{a.percent}% of {a.held} classes</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      {s.feesAllowed && (
        <section className="card stack">
          <div className="card-head"><h2>Fee arrears</h2><Link to="/school/fees" className="btn btn-quiet">All fees</Link></div>
          {arrears.length === 0 ? <p className="muted small">Nobody owes fees.</p> : (
            <ul className="link-list">
              {arrears.slice(0, 5).map((a) => (
                <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{money(org, a.balanceCents)}{a.overdue ? ' · overdue' : ''}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card stack">
        <div className="card-head"><h2>Graduate follow-ups due</h2><Link to="/school/graduation" className="btn btn-quiet">Open</Link></div>
        {due.length === 0 ? <p className="muted small">None due.</p> : (
          <ul className="link-list">
            {due.slice(0, 5).map((o) => <li key={o.id}><Link to="/school/graduation"><span className="link-title">{s.nameOf(o.studentId)}</span><span className="link-detail">{o.months}-month check · due {formatDateKey(o.due)}</span></Link></li>)}
          </ul>
        )}
        <p className="small muted">Answers: {Object.values(OUTCOME_LABELS).join(', ')}.</p>
      </section>
    </div>
  );
}
