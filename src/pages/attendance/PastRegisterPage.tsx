import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useSchool } from '../../state/useSchool';
import { useAllExamSheets } from '../../state/useExams';
import { useEvents, type AttendanceMark } from '../../state/useAttendance';
import { useLiveQuery } from '../../lib/useQuery';
import { createEvent, markAttendance, markMany, undoAttendance } from '../../lib/attendanceWrites';
import { friendlyError } from '../../lib/errors';
import { attended, eventIdFor } from '../../../functions/src/shared/attendance';
import { classDays, cohortStart, monthsBetween } from '../../../functions/src/shared/pastRecords';
import { commonClassName } from '../../../functions/src/shared/commonCourses';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';

const BACKDATE_ROLES = ['pastor', 'admin', 'principal'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const dayLabel = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()], n: t.getUTCDate() };
};

/**
 * Past registers (Andy, 2026-11-01, 1A-4A): pick a cohort, a class and a month, then tick a month grid of class
 * days. The cohort's students are listed as they were, graduated and withdrawn included, from the day the cohort
 * started. The Director, admin and the principal only.
 */
export function PastRegisterPage() {
  const { profile } = useAuth();
  const { current } = useOrg();
  if (!current || current.type !== 'college') return <div className="page narrow fin-wide"><p>Past registers are for ADIA Training Centre.</p></div>;
  if (!BACKDATE_ROLES.includes(profile?.roleId ?? '')) {
    return <div className="page narrow fin-wide"><p><Link to="/attendance">← Attendance</Link></p><p>Only the Director, admin and the principal fill in past registers.</p></div>;
  }
  return <PastRegister orgId={current.id} tz={current.timeZone || 'Africa/Nairobi'} />;
}

function PastRegister({ orgId, tz }: { orgId: string; tz: string }) {
  const [params, setParams] = useSearchParams();
  const school = useSchool(orgId);
  const { sheets } = useAllExamSheets(orgId);
  const { byId } = usePeople();
  const toast = useToast();
  const today = localDateKey(new Date(), tz);

  const cohorts = useMemo(() => {
    const names = [...new Set(school.intakes.map((i) => i.name.trim()).filter(Boolean))];
    return names.sort((a, b) => (cohortStart(school.intakes, b) ?? '').localeCompare(cohortStart(school.intakes, a) ?? ''));
  }, [school.intakes]);
  const cohort = params.get('cohort') && cohorts.includes(params.get('cohort')!) ? params.get('cohort')! : cohorts[0] ?? '';
  const start = cohortStart(school.intakes, cohort) ?? today;

  // Classes: each department with an intake of this cohort, then the cohort's common courses.
  const cohortIntakes = school.intakes.filter((i) => i.name.trim() === cohort);
  const departments = school.courses.filter((c) => cohortIntakes.some((i) => i.courseId === c.id));
  const commons = [...new Set(sheets.filter((s) => s.courseId == null && s.cohort.trim() === cohort).map((s) => s.courseName.trim()))].sort();
  const classes = [
    ...departments.map((c) => ({ key: `d:${c.id}`, label: c.name, register: c.name, courseId: c.id as string | null })),
    ...commons.map((n) => ({ key: `c:${n}`, label: `${n} (common course)`, register: commonClassName(n, cohort), courseId: null })),
  ];
  const chosen = classes.find((c) => c.key === params.get('class')) ?? classes[0];
  const months = monthsBetween(start, today);
  const month = params.get('month') && months.includes(params.get('month')!) ? params.get('month')! : months[0] ?? today.slice(0, 7);
  const days = classDays(month, start, today);
  const set = (k: string, v: string) => { const next = new URLSearchParams(params); next.set(k, v); if (k === 'cohort') { next.delete('class'); next.delete('month'); } setParams(next, { replace: true }); };

  // The cohort's students as they were: any status but applicant, so graduates and those who left still show.
  const intakeIds = new Set(cohortIntakes.filter((i) => !chosen?.courseId || i.courseId === chosen.courseId).map((i) => i.id));
  const students = school.students
    .filter((s) => intakeIds.has(s.intakeId) && s.status !== 'applicant' && (!chosen?.courseId || s.courseId === chosen.courseId))
    .map((s) => ({ ...s, name: byId(s.id)?.fullName ?? school.rosterNames.get(s.id) ?? 'Student' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const { events } = useEvents(orgId, monthStart);
  const register = chosen?.register ?? '';
  const dayEvents = new Map(events.filter((e) => e.name === register && e.date <= monthEnd).map((e) => [e.date, e]));
  // Only this register's days (at most 23, under the 30 an "in" query allows).
  const eventIds = register ? days.map((d) => eventIdFor(d, register)) : [];
  const idsKey = eventIds.join(',');
  const marks = useLiveQuery<AttendanceMark>(
    () => (orgId && eventIds.length ? query(collection(db, 'organizations', orgId, 'attendance'), where('eventId', 'in', eventIds)) : null),
    [orgId, idsKey],
  ).rows;
  const markOf = new Map(marks.map((m) => [m.id, m]));
  const [busyDay, setBusyDay] = useState('');

  function ensureEvent(date: string) {
    const id = eventIdFor(date, register);
    if (!dayEvents.has(date)) createEvent(orgId, { date, type: 'class', name: register, activity: register }).synced.catch((err) => toast.show(friendlyError(err)));
    return { id, date };
  }
  function toggle(date: string, personId: string) {
    const ev = ensureEvent(date);
    const m = markOf.get(`${ev.id}_${personId}`);
    const present = m && !m.deletedAt && attended(m.status);
    const save = present ? undoAttendance(orgId, ev.id, personId) : markAttendance(orgId, ev, personId, 'present', 'register', m ? { status: m.status, deletedAt: m.deletedAt } : undefined);
    save.catch((err) => toast.show(friendlyError(err)));
  }
  function allPresent(date: string) {
    setBusyDay(date);
    const ev = ensureEvent(date);
    const people = students.map((s) => {
      const m = markOf.get(`${ev.id}_${s.id}`);
      return { personId: s.id, existing: m ? { status: m.status, deletedAt: m.deletedAt } : undefined };
    }).filter((p) => !(p.existing && !p.existing.deletedAt && attended(p.existing.status)));
    markMany(orgId, ev, people, 'present').catch((err) => toast.show(friendlyError(err))).finally(() => setBusyDay(''));
  }

  return (
    <div className="page past-register">
      <p><Link to="/attendance">← Attendance</Link></p>
      <h1>Past registers</h1>
      <div className="filter-row">
        <label className="field"><span>Cohort</span>
          <select className="filter-select" value={cohort} onChange={(e) => set('cohort', e.target.value)}>
            {cohorts.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Class</span>
          <select className="filter-select" value={chosen?.key ?? ''} onChange={(e) => set('class', e.target.value)}>
            {classes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Month</span>
          <select className="filter-select" value={month} onChange={(e) => set('month', e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">Tap a box to tick a student present; tap again to take it back. Days with no ticks are not counted.</p>

      {!chosen ? <p className="muted">This cohort has no classes yet.</p> : students.length === 0 ? <p className="muted">No students in {cohort} for this class.</p> : days.length === 0 ? <p className="muted">No class days in this month for {cohort}.</p> : (
        <div className="grid-scroll card">
          <table className="past-grid">
            <thead>
              <tr>
                <th className="past-name">{students.length} students</th>
                {days.map((d) => {
                  const l = dayLabel(d);
                  return (
                    <th key={d} className={dayEvents.has(d) ? 'past-day has-register' : 'past-day'}>
                      <span>{l.wd}</span><b>{l.n}</b>
                      <button type="button" className="past-all" disabled={busyDay === d} onClick={() => allPresent(d)} title="Everyone present" aria-label={`Everyone present on ${d}`}>All</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const count = days.filter((d) => { const m = markOf.get(`${eventIdFor(d, register)}_${s.id}`); return m && !m.deletedAt && attended(m.status); }).length;
                return (
                  <tr key={s.id}>
                    <th className="past-name" scope="row">
                      {s.name}
                      {s.status !== 'enrolled' && <span className="badge badge-muted">{STUDENT_STATUS_LABELS[s.status]}</span>}
                      <span className="muted small"> {count}/{days.filter((d) => dayEvents.has(d)).length}</span>
                    </th>
                    {days.map((d) => {
                      const m = markOf.get(`${eventIdFor(d, register)}_${s.id}`);
                      const on = !!m && !m.deletedAt && attended(m.status);
                      return (
                        <td key={d}>
                          <button type="button" className={`past-cell${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${s.name}, ${d}`} onClick={() => toggle(d, s.id)}>{on ? '✓' : ''}</button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
