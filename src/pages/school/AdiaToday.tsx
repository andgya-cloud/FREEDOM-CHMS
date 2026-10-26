import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { setupSchool } from '../../lib/schoolWrites';
import { useFunds } from '../../state/useGiving';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { attendanceAlerts, arrearsList, capacityOf, collectionRate, schoolMetrics, STUDENT_STATUSES, STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';
import { ADIA_PROGRAMMES } from '../../../functions/src/shared/schoolSetup';
import { LineChart, Sparkline } from '../../components/charts';
import { FirstRunChecklist } from '../../components/FirstRunChecklist';
import { AdiaIcon, type AdiaIconName } from '../../components/icons';
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
 * ADIA's Today, from Andy's design (2026-10-26): a welcome card, four actions, the key figures, outcome
 * rings, charts, and "Needs attention" lists folded to one line each. It is ADIA's one dashboard (1A).
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

  if (s.loading) return <div className="page lav-today" />;

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
  const depts = metrics.byCourse.filter((c) => c.enrolled > 0);

  // Cohorts down the side, departments across: how many students hold a place in each class.
  const intakes = s.intakes.filter((i) => i.active !== false).map((i) => ({ i, c: capacityOf(i, s.students) }));
  const cohortNames = [...new Set(intakes.map(({ i }) => i.name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const deptIds = s.courses.filter((c) => intakes.some(({ i }) => i.courseId === c.id)).map((c) => c.id);
  const placeCell = (cohort: string, courseId: string) => intakes.filter(({ i }) => i.name === cohort && i.courseId === courseId);
  const placesIn = (list: typeof intakes) => list.reduce((n, { c }) => n + c.taken, 0);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: org.timeZone || 'Africa/Nairobi' }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const summary = `${metrics.enrolled} ${metrics.enrolled === 1 ? 'student is' : 'students are'} enrolled across ${depts.length} ${depts.length === 1 ? 'department' : 'departments'}.`
    + (thisWeek == null ? ' Mark today’s register to start tracking the weekly attendance trend.' : ` Attendance this week is ${thisWeek}%.`);
  const canRegister = can('attendance.write') || can('people.read');
  const actions: { to: string; icon: AdiaIconName; label: string; sub: string; go: string; tone: number; show: boolean }[] = [
    { to: '/attendance', icon: 'register', label: 'Class register', sub: 'Mark today’s attendance', go: 'Open', tone: 1, show: canRegister },
    { to: '/school/students/new', icon: 'addStudent', label: 'Add student', sub: 'Enrol into a cohort', go: 'Start', tone: 2, show: can('people.write') },
    { to: '/school/fees', icon: 'fees', label: 'Record fees', sub: 'M-Pesa or cash receipt', go: 'Record', tone: 3, show: s.feesAllowed },
    { to: '/school/exams', icon: 'exams', label: 'Exam Records', sub: 'Marks and result slips', go: 'View', tone: 4, show: can('exams.mark') || can('exams.manage') || can('users.manage') },
  ];
  const attendanceChange = thisWeek != null && lastWeek != null ? Math.round(thisWeek - lastWeek) : null;

  return (
    <div className="page lav-today">
      {needsSetup && (
        <section className="card stack">
          <h2>Set up the school</h2>
          <p className="small">This adds the four programmes ({ADIA_PROGRAMMES.join(', ')}), the grading settings and a School fees fund. Levels, units, trainers and timetables are for the school to enter. Nothing else is filled in for you.</p>
          {can('settings.manage') ? <button type="button" className="btn btn-primary align-start" disabled={busy} onClick={() => void setup()}>{busy ? 'Setting up…' : 'Set up now'}</button>
            : <p className="muted small">Ask the pastor to set this up.</p>}
        </section>
      )}

      <section className="card lav-hero">
        <div className="lav-hero-text">
          <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: org.timeZone || 'Africa/Nairobi' }).format(new Date())}</span>
          <h1>{greet},<br /><em>{org.name}</em></h1>
          <p>{summary}</p>
          <div className="lav-cta">
            {canRegister && <Link to="/attendance" className="lav-btn dark">Open class register</Link>}
            {can('people.write') && <Link to="/school/students/new" className="lav-btn ghost">Add student</Link>}
          </div>
        </div>
        <div className="lav-scene">
          <Mountains />
          <FirstRunChecklist variant="scene" />
        </div>
      </section>

      <section className="lav-quick" aria-label="Quick actions">
        {actions.filter((a) => a.show).map((a) => (
          <Link key={a.to} to={a.to} className="card lav-qa">
            <span className={`lav-ico i${a.tone}`}><AdiaIcon name={a.icon} /></span>
            <span><b>{a.label}</b><span className="lav-sub">{a.sub}</span></span>
            <span className="lav-go">{a.go} →</span>
          </Link>
        ))}
      </section>

      <section className="lav-kpis" aria-label="ADIA key figures">
        <Kpi to="/school/students" label="Students enrolled" chip={`${depts.length} ${depts.length === 1 ? 'dept' : 'depts'}`} value={String(metrics.enrolled)}
          sub={`${statusCount('applicant')} ${statusCount('applicant') === 1 ? 'applicant' : 'applicants'} waiting`} />
        <Kpi to="/attendance" label="Attendance this week" chip={attendanceChange == null ? 'This week' : `${attendanceChange >= 0 ? '▲' : '▼'} ${Math.abs(attendanceChange)}%`}
          tone={attendanceChange == null ? undefined : attendanceChange >= 0 ? 'ok' : 'warn'} value={pct(thisWeek)}
          sub={lastWeek == null ? 'No figure for last week' : `Last week ${lastWeek}%`} spark={marked.length > 1 ? marked : undefined} />
        <Kpi to="/school/graduation" label="Graduated" chip={metrics.graduationRate == null ? undefined : `${metrics.graduationRate}%`} tone="ok" value={String(statusCount('graduated'))}
          sub={`Working at 6 months: ${pct(metrics.employmentRate)}`} />
        {s.feesAllowed
          ? <Kpi to="/school/fees" label="Fee arrears" chip={arrears.length ? `${arrears.length} owe` : 'Clear'} tone={arrears.length ? 'warn' : 'ok'}
              value={money(org, arrearsCents)} sub={`${arrears.length} ${arrears.length === 1 ? 'student owes' : 'students owe'}`} />
          : <Kpi label="Below attendance" chip={alerts.length ? 'Check' : 'Clear'} tone={alerts.length ? 'warn' : 'ok'} value={String(alerts.length)}
              sub={`Under ${s.settings.attendanceThreshold}% of classes`} />}
      </section>

      <section className="card lav-panel">
        <div className="lav-head"><div><h2>How the school is doing</h2><p className="lav-sub">Key outcomes across every cohort</p></div></div>
        <div className="lav-rings">
          <Ring label="Attendance" value={metrics.attendanceRate} />
          <Ring label="Pass rate" value={metrics.passRate} />
          <Ring label="Retention" value={metrics.retentionRate} />
          <Ring label="Graduation" value={metrics.graduationRate} />
          <Ring label="Working at 6 months" value={metrics.employmentRate} />
          {s.feesAllowed && <Ring label="Fees collected" value={collected} note={billed ? `${money(org, paid)} of ${money(org, billed)}` : undefined} />}
        </div>
      </section>

      <section className="lav-grid2">
        <div className="card lav-panel">
          <div className="lav-head"><div><h2>Weekly attendance</h2><p className="lav-sub">Trend across all classes</p></div></div>
          {marked.length === 0 ? (
            <div className="lav-empty">
              <span className="lav-ico i5"><AdiaIcon name="trend" /></span>
              <b>No attendance yet</b>
              <span>The trend appears once classes are marked in the register.</span>
              {canRegister && <Link to="/attendance" className="lav-btn dark small">Mark register</Link>}
            </div>
          ) : <LineChart label="Attendance rate in each of the last eight weeks" labels={weeks.map((w) => w.label)} series={[{ name: 'Attendance', values: weekly }]} format={(v) => `${v}%`} axis={(v) => `${v}%`} />}
        </div>
        <div className="card lav-panel">
          <div className="lav-head"><div><h2>Students by department</h2><p className="lav-sub">Enrolled students in each department</p></div><span className="lav-chip">{metrics.enrolled} total</span></div>
          <DeptBars rows={metrics.byCourse.map((c) => ({ label: c.name.split(/[ &/]/)[0] || c.name, title: c.name, value: c.enrolled }))} />
        </div>
      </section>

      <StatusDonut rows={STUDENT_STATUSES.map((k) => ({ label: STUDENT_STATUS_LABELS[k], value: statusCount(k) }))} />

      <section className="stack">
        <div className="lav-head"><div><h2>Needs attention</h2><p className="lav-sub">Lists that update as records come in</p></div></div>
        <div className="lav-watch">
          <Watch icon="cohorts" tone={1} title="Students in each cohort and department" badge={`${placesIn(intakes)} places`}>
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
          </Watch>
          <Watch icon="clock" tone={2} title={`Attendance below ${s.settings.attendanceThreshold}%`} badge={alerts.length ? String(alerts.length) : 'Nobody'} alert={alerts.length > 0}>
            {alerts.length === 0 ? <p className="muted small">Nobody, from the classes marked so far (needs at least 3 classes).</p> : (
              <ul className="link-list">
                {alerts.map((a) => (
                  <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{a.percent}% of {a.held} classes</span></Link></li>
                ))}
              </ul>
            )}
          </Watch>
          {s.feesAllowed && (
            <Watch icon="fees" tone={3} title="Fee arrears" badge={arrears.length ? String(arrears.length) : 'Nobody'} alert={arrears.length > 0}>
              {arrears.length === 0 ? <p className="muted small">All fees are up to date.</p> : (
                <ul className="link-list">
                  {arrears.slice(0, 10).map((a) => (
                    <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{money(org, a.balanceCents)}{a.overdue ? ' · overdue' : ''}</span></Link></li>
                  ))}
                </ul>
              )}
              <Link to="/school/fees" className="btn btn-quiet align-start">All fees</Link>
            </Watch>
          )}
          <Watch icon="programmes" tone={4} title="Graduate follow-ups due" badge={due.length ? String(due.length) : 'None'} alert={due.length > 0}>
            {due.length === 0 ? <p className="muted small">None due.</p> : (
              <ul className="link-list">
                {due.slice(0, 10).map((o) => <li key={o.id}><Link to="/school/graduation"><span className="link-title">{s.nameOf(o.studentId)}</span><span className="link-detail">{o.months}-month check · due {formatDateKey(o.due)}</span></Link></li>)}
              </ul>
            )}
          </Watch>
        </div>
      </section>
    </div>
  );
}

/** A key figure: its name and a small chip, the figure, a line under it, and a trend when there is one. */
function Kpi({ label, chip, tone, value, sub, spark, to }: { label: string; chip?: string; tone?: 'ok' | 'warn'; value: string; sub: string; spark?: number[]; to?: string }) {
  const body = (
    <>
      <span className="lav-lbl">{label}{chip && <span className={`lav-chip${tone ? ` ${tone}` : ''}`}>{chip}</span>}</span>
      <span className="lav-val">{value}</span>
      <span className="lav-sub">{sub}</span>
      {spark && <span className="lav-spark"><Sparkline values={spark} /></span>}
    </>
  );
  return to ? <Link to={to} className="card lav-kpi">{body}</Link> : <div className="card lav-kpi">{body}</div>;
}

/** An outcome as a full ring, drawn in ADIA's gradient; "No data" until there are records. */
function Ring({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const id = useId();
  const C = 2 * Math.PI * 36;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  return (
    <figure className="lav-ring">
      <svg viewBox="0 0 92 92" role="img" aria-label={`${label}: ${v == null ? 'no data yet' : `${Math.round(v)}%`}`}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="lg-a" /><stop offset="0.6" className="lg-b" /><stop offset="1" className="lg-c" /></linearGradient></defs>
        <circle cx={46} cy={46} r={36} className="lav-ring-track" />
        {v != null && v > 0 && <circle cx={46} cy={46} r={36} className="lav-ring-fill" stroke={`url(#${id})`} strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform="rotate(-90 46 46)" />}
        <text x={46} y={v == null ? 50 : 52} textAnchor="middle" className={v == null ? 'lav-ring-none' : 'lav-ring-val'}>{v == null ? 'No data' : `${Math.round(v)}%`}</text>
      </svg>
      <figcaption><b>{label}</b><span>{v == null ? 'Waiting for records' : note ?? ''}</span></figcaption>
    </figure>
  );
}

/** Students in each department as rounded gradient columns, each with its count on top. */
function DeptBars({ rows }: { rows: { label: string; title: string; value: number }[] }) {
  const shown = rows.filter((r) => r.value > 0);
  if (shown.length === 0) return <p className="muted small">Nothing recorded yet.</p>;
  const max = Math.max(...shown.map((r) => r.value)) * 1.15;
  return (
    <div className="lav-bars" role="img" aria-label={`Enrolled students in each department: ${shown.map((r) => `${r.title} ${r.value}`).join(', ')}`}>
      {shown.map((r, i) => (
        <div key={r.title} className="lav-bar" title={`${r.title}: ${r.value}`}>
          <span className="lav-bar-v">{r.value}</span>
          <span className="lav-bar-col" style={{ height: `${(r.value / max) * 100}%`, animationDelay: `${i * 0.08}s` }} />
          <span className="lav-bar-l">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLOURS: [string, string][] = [['#1f2a5c', '#3a4a8c'], ['#c99a3c', '#e9c977'], ['#34c38f', '#7fdcb5'], ['#5b6aa8', '#8c97c9'], ['#8a6d2f', '#b8923f'], ['#9497b3', '#c3c5d8']];

/** Where every student is: a thick gradient ring and a legend of statuses with bars. */
function StatusDonut({ rows }: { rows: { label: string; value: number }[] }) {
  const id = useId();
  const shown = rows.filter((r) => r.value > 0);
  const total = shown.reduce((n, r) => n + r.value, 0);
  const C = 2 * Math.PI * 78;
  const gap = shown.length > 1 ? 16 : 0;
  let at = 0;
  return (
    <section className="card lav-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`Students by status: ${shown.map((r) => `${r.label} ${r.value}`).join(', ') || 'none yet'}`}>
        <defs>{DONUT_COLOURS.map(([a, b], i) => <linearGradient key={a} id={`${id}${i}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>)}</defs>
        <circle cx={100} cy={100} r={78} className="lav-donut-track" />
        {total > 0 && shown.map((r, i) => {
          const len = (r.value / total) * C;
          const seg = <circle key={r.label} cx={100} cy={100} r={78} fill="none" stroke={`url(#${id}${i % DONUT_COLOURS.length})`} strokeWidth={22} strokeLinecap={shown.length > 1 ? 'round' : 'butt'}
            strokeDasharray={`${Math.max(0.1, len - gap)} ${C}`} strokeDashoffset={-(at + gap / 2)} transform="rotate(-90 100 100)" />;
          at += len;
          return seg;
        })}
        <circle cx={100} cy={100} r={56} className="lav-donut-hole" />
        <text x={100} y={98} textAnchor="middle" className="lav-donut-n">{total}</text>
        <text x={100} y={120} textAnchor="middle" className="lav-donut-t">students</text>
      </svg>
      <div>
        <h2>Where every student is</h2>
        <p className="lav-sub">Students by status</p>
        <div className="lav-legend">
          {shown.length === 0 && <p className="muted small">No students yet.</p>}
          {shown.map((r, i) => {
            const [a, b] = DONUT_COLOURS[i % DONUT_COLOURS.length]!;
            const p = total ? Math.round((r.value / total) * 100) : 0;
            return (
              <div key={r.label} className="lav-lg">
                <span className="lav-sw" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                <span className="lav-lg-name"><b>{r.label}</b><span className="lav-meter"><i style={{ width: `${p}%`, background: `linear-gradient(90deg, ${a}, ${b})` }} /></span></span>
                <span className="lav-lg-num">{r.value}</span>
                <span className="lav-lg-pc">{p}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** One "Needs attention" list, folded to a line until opened. */
function Watch({ icon, tone, title, badge, alert, children }: { icon: AdiaIconName; tone: number; title: string; badge: string; alert?: boolean; children: ReactNode }) {
  return (
    <details className="card lav-watch-item">
      <summary>
        <span className={`lav-ico small i${tone}`}><AdiaIcon name={icon} /></span>
        <b>{title}</b>
        <span className={`lav-badge${alert ? ' alert' : ''}`}>{badge}</span>
        <svg className="lav-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </summary>
      <div className="lav-dbody">{children}</div>
    </details>
  );
}

/** The hills in the welcome card. */
function Mountains() {
  const id = useId();
  const g = (n: string) => `${id}${n}`;
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={g('sky')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f1838" /><stop offset="0.3" stopColor="#24336c" /><stop offset="0.52" stopColor="#c99a4c" /></linearGradient>
        <linearGradient id={g('m1')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b4a86" /><stop offset="1" stopColor="#56649c" /></linearGradient>
        <linearGradient id={g('m2')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#26336a" /><stop offset="1" stopColor="#3a4780" /></linearGradient>
        <linearGradient id={g('m3')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#18224d" /><stop offset="1" stopColor="#253062" /></linearGradient>
        <linearGradient id={g('m4')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1230" /><stop offset="1" stopColor="#141c44" /></linearGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#${g('sky')})`} />
      <circle cx="300" cy="80" r="34" fill="#e9c977" opacity="0.85" />
      <path d="M0 170 L60 120 L110 150 L170 90 L230 140 L290 100 L350 135 L400 110 V300 H0Z" fill={`url(#${g('m1')})`} />
      <path d="M0 200 L50 165 L100 185 L160 130 L215 180 L270 150 L330 190 L400 160 V300 H0Z" fill={`url(#${g('m2')})`} />
      <path d="M0 235 L70 190 L130 220 L190 180 L250 225 L320 200 L400 230 V300 H0Z" fill={`url(#${g('m3')})`} />
      <path d="M0 270 L80 235 L150 260 L230 228 L310 262 L400 245 V300 H0Z" fill={`url(#${g('m4')})`} />
    </svg>
  );
}
