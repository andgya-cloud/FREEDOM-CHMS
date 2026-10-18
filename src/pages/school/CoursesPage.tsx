import { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveCourse, saveIntake } from '../../lib/schoolWrites';
import { capacityOf, unitId, type CourseUnit } from '../../../functions/src/shared/school';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';
import type { CourseRow, IntakeRow } from '../../state/useSchool';

export function CoursesPage() {
  return <SchoolGate title="Courses">{(org) => <Courses org={org} />}</SchoolGate>;
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function Courses({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const editable = can('programs.write');

  function add() {
    if (name.trim().length < 2) return;
    const { synced } = saveCourse(org.id, null, { name: name.trim(), levels: [], units: [], timetable: [], active: true });
    synced.catch((err) => toast.show(friendlyError(err)));
    setName('');
    toast.show('Programme added');
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Courses</h1></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      <p className="small muted">Levels, units, trainers and timetables are yours to enter and change at any time. Students with results are never lost when you edit.</p>
      {s.courses.map((c) => <CourseCard key={c.id} org={org} course={c} intakes={s.intakes.filter((i) => i.courseId === c.id)} students={s.students} today={s.today} editable={editable} />)}
      {s.courses.length === 0 && !s.loading && <div className="card"><p>No programmes yet. Use Set up on the overview page, or add one below.</p></div>}
      {editable && (
        <section className="card stack">
          <h2>Add a programme</h2>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" className="btn align-start" disabled={name.trim().length < 2} onClick={add}>Add programme</button>
        </section>
      )}
    </div>
  );
}

function CourseCard({ org, course, intakes, students, today, editable }: { org: Organization; course: CourseRow; intakes: IntakeRow[]; students: { intakeId: string; status: string; deletedAt?: unknown }[]; today: string; editable: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [levels, setLevels] = useState(course.levels.join('\n'));
  const [timetable, setTimetable] = useState(course.timetable.join('\n'));
  const [units, setUnits] = useState<CourseUnit[]>(course.units);
  const [active, setActive] = useState(course.active !== false);
  const levelList = lines(levels);

  const setUnit = (i: number, patch: Partial<CourseUnit>) => setUnits((l) => l.map((u, n) => (n === i ? { ...u, ...patch } : u)));

  function save() {
    const used = new Set<string>();
    const clean = units.filter((u) => u.name.trim()).map((u) => {
      let id = u.id || unitId(u.name);
      while (used.has(id)) id = `${id}_2`;
      used.add(id);
      return { id, name: u.name.trim().slice(0, 80), level: levelList.includes(u.level) ? u.level : '', trainer: u.trainer.trim().slice(0, 80) };
    });
    const { synced } = saveCourse(org.id, course.id, { name: course.name, levels: levelList, units: clean, timetable: lines(timetable).slice(0, 40), active });
    synced.catch((err) => toast.show(friendlyError(err)));
    toast.show(`${course.name} saved`);
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <h2>{course.name}{course.active === false ? ' (closed)' : ''}</h2>
        <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>
      </div>
      <p className="small muted">{course.levels.length} levels · {course.units.length} units · {new Set(course.units.map((u) => u.trainer).filter(Boolean)).size} trainers</p>
      {open && (
        <>
          <label className="field"><span>Levels (one per line)</span><textarea rows={3} value={levels} disabled={!editable} onChange={(e) => setLevels(e.target.value)} placeholder="Level 1" /></label>
          <h3>Units and trainers</h3>
          {units.map((u, i) => (
            <div key={i} className="stack">
              <div className="field-row">
                <label className="field"><span>Unit</span><input value={u.name} disabled={!editable} onChange={(e) => setUnit(i, { name: e.target.value })} /></label>
                <label className="field"><span>Trainer</span><input value={u.trainer} disabled={!editable} onChange={(e) => setUnit(i, { trainer: e.target.value })} /></label>
              </div>
              <div className="field-row">
                {levelList.length > 0 && (
                  <label className="field"><span>Level</span>
                    <select value={u.level} disabled={!editable} onChange={(e) => setUnit(i, { level: e.target.value })}>
                      <option value="">All levels</option>
                      {levelList.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                )}
                {editable && <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setUnits((l) => l.filter((_, n) => n !== i))}>Remove unit</button>}
              </div>
            </div>
          ))}
          {editable && <button type="button" className="btn btn-quiet align-start" onClick={() => setUnits((l) => [...l, { id: '', name: '', level: '', trainer: '' }])}>Add a unit</button>}
          <label className="field"><span>Timetable (one line each, for example "Tuesday 9:00 to 12:00 Practical")</span><textarea rows={3} value={timetable} disabled={!editable} onChange={(e) => setTimetable(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={active} disabled={!editable} onChange={(e) => setActive(e.target.checked)} /><span>Taking students (untick to close the programme)</span></label>
          {editable && <button type="button" className="btn btn-primary align-start" onClick={save}>Save {course.name}</button>}
        </>
      )}
      <h3>Intakes</h3>
      {intakes.map((i) => <IntakeRowEditor key={i.id} org={org} intake={i} students={students} editable={editable} />)}
      {intakes.length === 0 && <p className="muted small">No intake yet.</p>}
      {editable && <NewIntake org={org} courseId={course.id} today={today} />}
    </section>
  );
}

function IntakeRowEditor({ org, intake, students, editable }: { org: Organization; intake: IntakeRow; students: { intakeId: string; status: string; deletedAt?: unknown }[]; editable: boolean }) {
  const toast = useToast();
  const [capacity, setCapacity] = useState(intake.capacity == null ? '' : String(intake.capacity));
  const cap = capacityOf(intake, students as never);
  function save(patch: Partial<IntakeRow>) {
    saveIntake(org.id, intake.id, { courseId: intake.courseId, name: intake.name, startDate: intake.startDate, capacity: intake.capacity, active: intake.active !== false, ...patch })
      .catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }
  return (
    <div className="stack">
      <p><strong>{intake.name}</strong> <span className="muted small">starts {intake.startDate} · {cap.taken}{intake.capacity != null ? ` of ${intake.capacity}` : ''} places taken{cap.full ? ' · full' : ''}</span></p>
      {editable && (
        <div className="field-row">
          <label className="field"><span>Places</span><input type="number" inputMode="numeric" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} onBlur={() => { const n = capacity.trim() === '' ? null : Math.max(0, Math.floor(Number(capacity))); if (n !== intake.capacity && (n === null || Number.isFinite(n))) save({ capacity: n }); }} /></label>
          <label className="check"><input type="checkbox" checked={intake.active !== false} onChange={(e) => save({ active: e.target.checked })} /><span>Open</span></label>
        </div>
      )}
    </div>
  );
}

function NewIntake({ org, courseId, today }: { org: Organization; courseId: string; today: string }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [capacity, setCapacity] = useState('');
  function add() {
    if (!name.trim() || !startDate) return;
    const n = capacity.trim() === '' ? null : Math.max(0, Math.floor(Number(capacity)));
    saveIntake(org.id, null, { courseId, name: name.trim().slice(0, 60), startDate, capacity: n != null && Number.isFinite(n) ? n : null, active: true }).catch((err) => toast.show(friendlyError(err)));
    setName('');
    setCapacity('');
    toast.show('Intake added');
  }
  return (
    <div className="stack">
      <h3>Add an intake</h3>
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`January ${today.slice(0, 4)}`} /></label>
      <div className="field-row">
        <label className="field"><span>Starts</span><input type="date" value={startDate || localDateKey(new Date(), org.timeZone)} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="field"><span>Places (optional)</span><input type="number" inputMode="numeric" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
      </div>
      <button type="button" className="btn align-start" disabled={!name.trim()} onClick={add}>Add intake</button>
    </div>
  );
}
