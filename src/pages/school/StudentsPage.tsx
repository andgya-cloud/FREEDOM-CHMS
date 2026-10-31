import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS, studentAttendance, type StudentStatus } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolTitle, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';
import { StudentFinder, useStudentFinder } from '../../components/StudentFinder';

/** "Cohort 2" before "Cohort 10", then other names in order. */
const byCohort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function StudentsPage() {
  return <SchoolGate title="Students">{(org) => <Students org={org} />}</SchoolGate>;
}

function Students({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const finder = useStudentFinder();
  const [status, setStatus] = useState<StudentStatus | 'all'>('enrolled');
  const [courseId, setCourseId] = useState('');
  const [cohort, setCohort] = useState('');

  // The status, cohort and department filters first; then the search box and the A to Z bar.
  const listed = useMemo(() => s.students
    .map((st) => ({ st, name: s.nameOf(st.id) }))
    .filter(({ st }) => (status === 'all' || st.status === status) && (!courseId || st.courseId === courseId) && (!cohort || s.intakeName(st.intakeId) === cohort))
    .sort((a, b) => a.name.localeCompare(b.name)), [s.students, s.nameOf, s.intakeName, status, courseId, cohort]);
  const rows = listed.filter(({ st, name }) => finder.match(name, st.admissionNo ?? ''));

  // Cohort (the intake name every programme shares), then department (programme), as the school organises its classes.
  const cohorts = useMemo(() => [...new Set(s.intakes.map((i) => i.name))].sort(byCohort), [s.intakes]);
  const groups = useMemo(() => {
    const out = new Map<string, Map<string, typeof rows>>();
    for (const r of rows) {
      const c = s.intakeName(r.st.intakeId) || 'No cohort';
      const byCourse = out.get(c) ?? new Map<string, typeof rows>();
      byCourse.set(r.st.courseId, [...(byCourse.get(r.st.courseId) ?? []), r]);
      out.set(c, byCourse);
    }
    const order = s.courses.map((c) => c.id);
    return [...out.entries()].sort((a, b) => byCohort(a[0], b[0])).map(([name, byCourse]) => ({
      name,
      count: [...byCourse.values()].reduce((n, l) => n + l.length, 0),
      departments: [...byCourse.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, list]) => ({ id, list })),
    }));
  }, [rows, s.intakeName, s.courses]);

  return (
    <div className="page narrow wide-table">
      <SchoolTitle feesAllowed={s.feesAllowed}>
        {can('people.write') && (
          <details className="add-menu">
            <summary className="btn btn-primary">+ Add students</summary>
            <div className="add-menu-pop">
              <Link to="/school/students/new">Enrol one student</Link>
              <Link to="/school/students/import">Import from Excel</Link>
            </div>
          </details>
        )}
      </SchoolTitle>
      {/* Status, cohort and department side by side, in place of a row of chips (Andy, 2026-10-28, 2A). */}
      <div className="filter-row">
        <label className="field"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StudentStatus | 'all')}>
            {(['all', ...STUDENT_STATUSES] as const).map((v) => <option key={v} value={v}>{v === 'all' ? 'Everyone' : STUDENT_STATUS_LABELS[v]}</option>)}
          </select>
        </label>
        <label className="field"><span>Cohort</span>
          <select value={cohort} onChange={(e) => setCohort(e.target.value)}>
            <option value="">All cohorts</option>
            {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Department</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All departments</option>
            {s.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <StudentFinder finder={finder} names={listed.map((x) => x.name)} shown={rows.length} total={listed.length} />
      {s.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No students match. {s.students.length === 0 && 'Enrol the first student with the button above.'}</p></div> : (
        <div className="stack">
          {groups.map((g) => (
            <details key={g.name} className="card cohort-group" open={groups.length === 1 || !!cohort || finder.active}>
              <summary>
                <span className="cohort-name">{g.name}</span>
                <span className="muted small">{g.count} {g.count === 1 ? 'student' : 'students'}</span>
              </summary>
              {g.departments.map((d) => (
                <section key={d.id} className="dept-group">
                  <h3>{s.courseName(d.id) || 'No department'} <span className="muted small">{d.list.length}</span></h3>
                  <div className="exam-table-wrap">
                    <table className="table student-table">
                      <thead><tr><th>Name</th><th className="num">Attendance</th>{s.balancesAllowed && <th className="num">Owes</th>}</tr></thead>
                      <tbody>
                        {d.list.map(({ st, name }) => {
                          const course = s.courses.find((c) => c.id === st.courseId);
                          const att = course ? studentAttendance(st.id, course.name, s.events, s.records, st.enrolledOn) : null;
                          const bal = s.balances.find((b) => b.studentId === st.id);
                          return (
                            <tr key={st.id}>
                              <td>
                                <Link to={`/school/students/${st.id}`}>{name}</Link>
                                {st.status !== 'enrolled' && <span className="badge"> {STUDENT_STATUS_LABELS[st.status]}</span>}
                                <div className="muted small">{st.admissionNo ?? 'Admission number pending'}{st.level ? ` · ${st.level}` : ''}</div>
                              </td>
                              <td className="num">{att?.percent != null ? pct(att.percent) : '–'}</td>
                              {s.balancesAllowed && <td className="num">{bal && bal.balanceCents > 0 ? money(org, bal.balanceCents) : '–'}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
