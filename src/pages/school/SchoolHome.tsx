import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { setupSchool } from '../../lib/schoolWrites';
import { useFunds } from '../../state/useGiving';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { arrearsList, attendanceAlerts, capacityOf, collectionRate, OUTCOME_LABELS, schoolMetrics } from '../../../functions/src/shared/school';
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

  const tiles: [string, string][] = [
    ['Enrolled', String(metrics.enrolled)], ['Attendance', pct(metrics.attendanceRate)], ['Pass rate', pct(metrics.passRate)],
    ['Retention', pct(metrics.retentionRate)], ['Graduation rate', pct(metrics.graduationRate)], ['Working at 6 months', pct(metrics.employmentRate)],
  ];
  if (s.feesAllowed) tiles.push(['Fees collected', pct(collectionRate(billed, paid))], ['Arrears', money(org, arrears.reduce((a, b) => a + b.balanceCents, 0))]);

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
      <ul className="tiles" aria-label="School numbers">
        {tiles.map(([label, value]) => (
          <li key={label}><div className="tile"><span className="tile-label">{label}</span><span className="tile-value">{value}</span></div></li>
        ))}
      </ul>

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
        <h2>Places in each intake</h2>
        {s.intakes.filter((i) => i.active !== false).length === 0 ? <p className="muted small">No intakes yet. Add one under <Link to="/school/courses">Courses</Link>.</p> : (
          <ul className="link-list">
            {s.intakes.filter((i) => i.active !== false).map((i) => {
              const c = capacityOf(i, s.students);
              return <li key={i.id}><div><span className="link-title">{s.courseName(i.courseId)} · {i.name}</span><span className="link-detail">{c.taken}{i.capacity != null ? ` of ${i.capacity}` : ''} places taken{c.full ? ' · full' : ''}</span></div></li>;
            })}
          </ul>
        )}
      </section>

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
