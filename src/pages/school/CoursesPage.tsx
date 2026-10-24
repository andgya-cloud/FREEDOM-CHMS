import { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveCourse, saveIntake } from '../../lib/schoolWrites';
import { capacityOf } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';
import type { CourseRow, IntakeRow } from '../../state/useSchool';

/**
 * Programmes and their cohorts, kept simple (Andy, 2026-10-24): each programme is a card with its
 * cohorts in one table. Courses, trainers and weighting live in Exam Records Setup now, so the old
 * units, trainers and timetable boxes are gone (saved data is kept untouched).
 */
export function CoursesPage() {
  return <SchoolGate title="Programmes">{(org) => <Programmes org={org} />}</SchoolGate>;
}

type StudentLite = { intakeId: string; courseId: string; status: string; deletedAt?: unknown };

function Programmes({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('programs.write');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  function add() {
    const n = name.trim();
    if (n.length < 2) return toast.show('Type the programme name.');
    if (s.courses.some((c) => c.name.toLowerCase() === n.toLowerCase())) return toast.show(`${n} is already there.`);
    try {
      const { synced } = saveCourse(org.id, null, { name: n.slice(0, 80), levels: [], units: [], timetable: [], active: true });
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(`${n} added. Now add its first cohort.`);
      setName('');
      setAdding(false);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Programmes</h1>
        {editable && !adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ New programme</button>}
      </div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      <p className="muted">Each programme has its cohorts. Students enrol into a cohort, and Exam Records, Fees and Graduation follow them. Add each programme's courses and trainers in Exam Records, Setup.</p>
      {adding && (
        <section className="card stack">
          <label className="field"><span>Programme name</span><input autoFocus value={name} maxLength={80} placeholder="e.g. Plumbing" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></label>
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={add}>Add programme</button><button type="button" className="btn btn-quiet" onClick={() => { setAdding(false); setName(''); }}>Cancel</button></div>
        </section>
      )}
      {s.courses.length === 0 && !s.loading && <div className="card"><p>No programmes yet.{editable ? ' Tap New programme to add the first one.' : ''}</p></div>}
      {s.courses.map((c) => <ProgrammeCard key={c.id} org={org} course={c} intakes={s.intakes.filter((i) => i.courseId === c.id)} students={s.students as StudentLite[]} today={s.today} editable={editable} />)}
    </div>
  );
}

function ProgrammeCard({ org, course, intakes, students, today, editable }: { org: Organization; course: CourseRow; intakes: IntakeRow[]; students: StudentLite[]; today: string; editable: boolean }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: course.name, levels: course.levels.join(', '), active: course.active !== false });
  const enrolled = students.filter((st) => !st.deletedAt && st.courseId === course.id && st.status === 'enrolled').length;
  const closed = course.active === false;

  function save() {
    if (f.name.trim().length < 2) return toast.show('Type the programme name.');
    const levels = f.levels.split(/[,\n]/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
    // Units and timetable are no longer shown, but are kept as they were.
    const { synced } = saveCourse(org.id, course.id, { name: f.name.trim().slice(0, 80), levels, units: course.units, timetable: course.timetable, active: f.active });
    synced.catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
    setEditing(false);
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>{course.name}{closed && <span className="badge"> Closed</span>}</h2>
        {editable && !editing && <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      <p className="small muted">{enrolled} {enrolled === 1 ? 'student' : 'students'} studying now · {intakes.length} {intakes.length === 1 ? 'cohort' : 'cohorts'}</p>
      {editing && (
        <div className="stack">
          <label className="field"><span>Programme name</span><input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span>Levels (optional, separated by commas)</span><input value={f.levels} placeholder="Level 1, Level 2" onChange={(e) => setF({ ...f, levels: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>Taking new students</span></label>
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={save}>Save</button><button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      )}
      {intakes.length === 0 ? <p className="muted small">No cohorts yet.</p> : (
        <table className="table">
          <thead><tr><th>Cohort</th><th>Starts</th><th className="num">Students</th><th>Open</th></tr></thead>
          <tbody>{intakes.map((i) => <CohortRow key={i.id} org={org} intake={i} students={students} editable={editable} />)}</tbody>
        </table>
      )}
      {editable && (adding
        ? <NewCohort org={org} courseId={course.id} today={today} suggested={nextName(intakes)} onDone={() => setAdding(false)} />
        : <button type="button" className="btn btn-quiet align-start" onClick={() => setAdding(true)}>+ New cohort</button>)}
    </section>
  );
}

/** "Cohort 4" after "Cohort 3"; blank when the names don't follow that pattern. */
function nextName(intakes: IntakeRow[]) {
  const nums = intakes.map((i) => /^cohort\s*(\d+)$/i.exec(i.name.trim())?.[1]).filter(Boolean).map(Number);
  return nums.length ? `Cohort ${Math.max(...nums) + 1}` : intakes.length ? '' : 'Cohort 1';
}

function CohortRow({ org, intake, students, editable }: { org: Organization; intake: IntakeRow; students: StudentLite[]; editable: boolean }) {
  const toast = useToast();
  const cap = capacityOf(intake, students as never);
  const open = intake.active !== false;
  function toggle(active: boolean) {
    saveIntake(org.id, intake.id, { courseId: intake.courseId, name: intake.name, startDate: intake.startDate, capacity: intake.capacity, active }).catch((err) => toast.show(friendlyError(err)));
    toast.show(active ? `${intake.name} is open for enrolment` : `${intake.name} is closed for enrolment`);
  }
  return (
    <tr>
      <td><strong>{intake.name}</strong></td>
      <td className="small">{intake.startDate}</td>
      <td className="num">{cap.taken}{intake.capacity != null ? ` of ${intake.capacity}` : ''}{cap.full && <div className="muted small">full</div>}</td>
      <td><label className="check"><input type="checkbox" checked={open} disabled={!editable} onChange={(e) => toggle(e.target.checked)} aria-label={`${intake.name} open for enrolment`} /></label></td>
    </tr>
  );
}

function NewCohort({ org, courseId, today, suggested, onDone }: { org: Organization; courseId: string; today: string; suggested: string; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(suggested);
  const [startDate, setStartDate] = useState(today);
  const [capacity, setCapacity] = useState('');
  function add() {
    if (!name.trim()) return toast.show('Type the cohort name, such as "Cohort 5".');
    if (!startDate) return toast.show('Pick the start date.');
    const n = capacity.trim() === '' ? null : Math.max(0, Math.floor(Number(capacity)));
    saveIntake(org.id, null, { courseId, name: name.trim().slice(0, 60), startDate, capacity: n != null && Number.isFinite(n) ? n : null, active: true }).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${name.trim()} added`);
    onDone();
  }
  return (
    <div className="stack exam-add">
      <div className="form-grid">
        <label className="field"><span>Cohort name</span><input value={name} maxLength={60} placeholder="Cohort 5" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Starts</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="field"><span>Places (leave blank for no limit)</span><input type="number" inputMode="numeric" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
      </div>
      <p className="muted small">Use the same cohort name in every programme (for example "Cohort 5"), so Exam Records keeps them together.</p>
      <div className="row-actions"><button type="button" className="btn btn-primary" onClick={add}>Add cohort</button><button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button></div>
    </div>
  );
}
