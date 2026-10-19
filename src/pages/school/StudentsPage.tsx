import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { STUDENT_STATUSES, STUDENT_STATUS_LABELS, studentAttendance, type StudentStatus } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function StudentsPage() {
  return <SchoolGate title="Students">{(org) => <Students org={org} />}</SchoolGate>;
}

function Students({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StudentStatus | 'all'>('enrolled');
  const [courseId, setCourseId] = useState('');

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return s.students
      .map((st) => ({ st, name: s.nameOf(st.id) }))
      .filter(({ st, name }) => (status === 'all' || st.status === status) && (!courseId || st.courseId === courseId)
        && (!text || name.toLowerCase().includes(text) || (st.admissionNo ?? '').toLowerCase().includes(text)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [s.students, s.nameOf, q, status, courseId]);

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Students</h1>
        {can('people.write') && <Link to="/school/students/new" className="btn btn-primary">Enrol a student</Link>}
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
      <label className="field"><span>Programme</span>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">All programmes</option>
          {s.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {s.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No students match. {s.students.length === 0 && 'Enrol the first student with the button above.'}</p></div> : (
        <ul className="link-list">
          {rows.map(({ st, name }) => {
            const course = s.courses.find((c) => c.id === st.courseId);
            const att = course ? studentAttendance(st.id, course.name, s.events, s.records, st.enrolledOn) : null;
            const bal = s.balances.find((b) => b.studentId === st.id);
            return (
              <li key={st.id}>
                <Link to={`/school/students/${st.id}`}>
                  <span className="link-title">{name} <span className="muted small">{st.admissionNo ?? 'number pending'}</span></span>
                  <span className="link-detail">
                    {s.courseName(st.courseId)}{st.level ? ` · ${st.level}` : ''} · {STUDENT_STATUS_LABELS[st.status]}
                    {att?.percent != null && ` · attendance ${pct(att.percent)}`}
                    {bal && bal.balanceCents > 0 && ` · owes ${money(org, bal.balanceCents)}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
