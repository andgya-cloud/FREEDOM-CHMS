import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS, studentAttendance, type StudentStatus } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

/** "Cohort 2" before "Cohort 10", then other names in order. */
const byCohort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function StudentsPage() {
  return <SchoolGate title="Students">{(org) => <Students org={org} />}</SchoolGate>;
}

function Students({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StudentStatus | 'all'>('enrolled');
  const [courseId, setCourseId] = useState('');
  const [cohort, setCohort] = useState('');

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return s.students
      .map((st) => ({ st, name: s.nameOf(st.id) }))
      .filter(({ st, name }) => (status === 'all' || st.status === status) && (!courseId || st.courseId === courseId)
        && (!cohort || s.intakeName(st.intakeId) === cohort)
        && (!text || name.toLowerCase().includes(text) || (st.admissionNo ?? '').toLowerCase().includes(text)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [s.students, s.nameOf, s.intakeName, q, status, courseId, cohort]);

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
    <div className="page narrow">
      <div className="page-head">
        <h1>Students</h1>
        {can('people.write') && (
          <div className="row-actions">
            <Link to="/school/students/import" className="btn btn-quiet">Import from Excel</Link>
            <Link to="/school/students/new" className="btn btn-primary">Enrol a student</Link>
          </div>
        )}
      </div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      <input type="search" className="search" placeholder="Find by name or admission number" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" role="group" aria-label="Status">
        {(['all', ...STUDENT_STATUSES] as const).map((v) => (
          <button key={v} type="button" className={`chip${status === v ? ' chip-on' : ''}`} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {v === 'all' ? 'All' : STUDENT_STATUS_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="field-row">
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
      {s.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No students match. {s.students.length === 0 && 'Enrol the first student with the button above.'}</p></div> : (
        <div className="stack">
          {groups.map((g) => (
            <details key={g.name} className="card cohort-group" open={groups.length === 1 || !!cohort || !!q.trim()}>
              <summary>
                <span className="cohort-name">{g.name}</span>
                <span className="muted small">{g.count} {g.count === 1 ? 'student' : 'students'} · {g.departments.map((d) => `${s.courseName(d.id) || 'No department'} ${d.list.length}`).join(' · ')}</span>
              </summary>
              {g.departments.map((d) => (
                <section key={d.id} className="dept-group">
                  <h3>{s.courseName(d.id) || 'No department'} <span className="muted small">{d.list.length}</span></h3>
                  <ul className="link-list">
                    {d.list.map(({ st, name }) => {
                      const course = s.courses.find((c) => c.id === st.courseId);
                      const att = course ? studentAttendance(st.id, course.name, s.events, s.records, st.enrolledOn) : null;
                      const bal = s.balances.find((b) => b.studentId === st.id);
                      return (
                        <li key={st.id}>
                          <Link to={`/school/students/${st.id}`}>
                            <span className="link-title">{name} <span className="muted small">{st.admissionNo ?? 'number pending'}</span></span>
                            <span className="link-detail">
                              {st.level ? `${st.level} · ` : ''}{STUDENT_STATUS_LABELS[st.status]}
                              {att?.percent != null && ` · attendance ${pct(att.percent)}`}
                              {bal && bal.balanceCents > 0 && ` · owes ${money(org, bal.balanceCents)}`}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
