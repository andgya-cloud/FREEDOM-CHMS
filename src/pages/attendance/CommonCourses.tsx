import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { useExamAccess, useExamSettings, useExamTrainers, type ExamSheetRow, type ExamTrainer } from '../../state/useExams';
import { createExamSheet, logExam } from '../../lib/examWrites';
import { friendlyError } from '../../lib/errors';
import { COMMON_DEPARTMENT, STANDARD_COMMON_COURSES, matchTutor } from '../../../functions/src/shared/commonCourses';

const ADD = '__add';
const READY = '__ready';
const BOTH: (1 | 2)[] = [1, 2];
const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** One common course in one cohort: its marks sheets by semester and its tutor. */
interface Course { key: string; name: string; tutor: string; ownerUid: string; sheets: ExamSheetRow[] }

function coursesOf(sheets: ExamSheetRow[]): Course[] {
  const by = new Map<string, Course>();
  for (const s of sheets) {
    const k = key(s.courseName);
    const c = by.get(k) ?? { key: k, name: s.courseName.trim(), tutor: s.teacherName || s.ownerName, ownerUid: s.ownerUid, sheets: [] };
    c.sheets.push(s);
    by.set(k, c);
  }
  for (const c of by.values()) c.sheets.sort((x, y) => (x.semester ?? 9) - (y.semester ?? 9));
  return [...by.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** Common courses go to lecturers with Common courses ticked, or to the principal or the pastor (Andy, 2026-10-28). */
const tutorsOf = (trainers: ExamTrainer[]) => trainers.filter((t) => t.lecturer === false || t.departments?.includes(COMMON_DEPARTMENT));

/** Adds a course's marks sheets, one per semester, all with the same tutor. */
function addSheets(orgId: string, cohort: string, name: string, semesters: (1 | 2)[], t: { uid: string; name: string }, weights: ReturnType<typeof useExamSettings>['settings']['weights'], byName: string, onError: (err: unknown) => void) {
  for (const semester of semesters) {
    const { ref, synced } = createExamSheet(orgId, {
      cohort, courseId: null, courseName: name, teacherName: t.name.slice(0, 120),
      weights, ownerUid: t.uid, ownerName: t.name.slice(0, 120), semester,
    });
    synced.catch(onError);
    void logExam(orgId, { action: 'setup', cohort, sheetId: ref.id, detail: `Added ${name} (Common courses, Semester ${semester}) for ${t.name}`, byName }).catch(() => {});
  }
}

/**
 * The Common courses panel on ADIA's Attendance page (Andy, 2026-10-28): pick the cohort, then the course with its
 * tutor, then Mark register or key in each semester's results. The principal and the pastor set courses up here.
 */
export function CommonCoursesPanel({ orgId, cohorts, sheets, onRegister, onClose }: {
  orgId: string;
  /** Open cohorts, newest first. */
  cohorts: string[];
  /** Common-course sheets this person may open: every one for the principal, their own for a lecturer. */
  sheets: ExamSheetRow[];
  onRegister: (courseName: string, cohort: string) => void;
  onClose: () => void;
}) {
  const a = useExamAccess();
  const navigate = useNavigate();
  const [cohort, setCohort] = useState(cohorts[0] ?? '');
  const [pick, setPick] = useState('');
  const courses = useMemo(() => coursesOf(sheets.filter((s) => s.cohort === cohort)), [sheets, cohort]);
  const missing = STANDARD_COMMON_COURSES.filter((sc) => {
    const c = courses.find((x) => x.key === key(sc.name));
    return !c || BOTH.some((sem) => !c.sheets.some((s) => s.semester === sem));
  });
  const offerReady = a.canManage && missing.length > 0;
  // A new cohort opens on its ready-made list, so setting it up is one tap.
  const mode = pick === ADD || pick === READY ? pick : a.canManage && courses.length === 0 && cohort ? (offerReady ? READY : ADD) : '';
  const chosen = mode ? undefined : courses.find((c) => c.key === pick) ?? (courses.length === 1 ? courses[0] : undefined);

  return (
    <div className="common-panel" role="region" aria-label="Common courses">
      <div className="common-panel-head">
        <h3>Common courses</h3>
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close common courses">Close</button>
      </div>
      {cohorts.length === 0 ? <p className="muted small">{a.canManage ? 'No open cohort yet.' : 'You have no common course yet. The principal gives you one in Exam Records.'}</p> : (
        <>
          <div className="common-pick">
            <label className="field"><span>Cohort</span>
              <select value={cohort} onChange={(e) => { setCohort(e.target.value); setPick(''); }}>
                {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Course</span>
              <select value={mode || chosen?.key || ''} onChange={(e) => setPick(e.target.value)}>
                {!mode && !chosen && <option value="">{courses.length ? 'Pick the course' : 'No common course yet'}</option>}
                {courses.map((c) => <option key={c.key} value={c.key}>{c.name} · {c.tutor}</option>)}
                {offerReady && <option value={READY}>+ Ready-made courses ({missing.length})</option>}
                {a.canManage && <option value={ADD}>+ Add another common course</option>}
              </select>
            </label>
          </div>
          {mode === READY ? (
            <ReadyCourses orgId={orgId} cohort={cohort} courses={courses} onDone={(k) => setPick(k)} onCancel={courses.length ? () => setPick('') : undefined} />
          ) : mode === ADD ? (
            <AddCommonCourse orgId={orgId} cohort={cohort} taken={courses.map((c) => c.key)}
              onAdded={(k) => setPick(k)} onCancel={courses.length || offerReady ? () => setPick(courses.length ? '' : READY) : undefined} />
          ) : chosen ? (
            <>
              <p className="common-tutor"><span className="muted">Tutor</span> <strong>{chosen.tutor}</strong></p>
              <div className="common-actions">
                <button type="button" className="btn btn-primary" onClick={() => onRegister(chosen.name, cohort)}>Mark register</button>
                {chosen.sheets.map((s) => (
                  <button key={s.id} type="button" className="btn" onClick={() => navigate(`/school/exams/sheet/${s.id}`)}>
                    {chosen.sheets.length > 1 && s.semester ? `Semester ${s.semester} results` : 'Key in results'}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The ready-made common courses for one cohort, each with its tutor already picked; one tap adds them all (Andy, 2026-10-28, 2A). */
function ReadyCourses({ orgId, cohort, courses, onDone, onCancel }: {
  orgId: string; cohort: string; courses: Course[]; onDone: (key: string) => void; onCancel?: () => void;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(orgId);
  const { trainers, loading } = useExamTrainers(orgId);
  const tutors = tutorsOf(trainers);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const rows = STANDARD_COMMON_COURSES.map((sc) => {
    const have = courses.find((c) => c.key === key(sc.name));
    const semesters = BOTH.filter((sem) => !have?.sheets.some((s) => s.semester === sem));
    // A course already set up keeps its tutor; otherwise the usual tutor is picked, if their account can teach common courses.
    const usual = matchTutor(sc.tutor, tutors);
    const uid = have ? have.ownerUid : chosen[sc.name] ?? usual?.uid ?? '';
    return { ...sc, have, semesters, uid, usualMissing: !have && !usual };
  });
  const todo = rows.filter((r) => r.semesters.length > 0);
  const ready = todo.filter((r) => r.uid);

  function save() {
    if (!ready.length) return toast.show('Pick a tutor for each course first.');
    try {
      for (const r of ready) {
        const t = r.have ? { uid: r.have.ownerUid, name: r.have.tutor } : tutors.find((x) => x.uid === r.uid);
        if (t) addSheets(orgId, cohort, r.name, r.semesters, t, settings.weights, a.myName, (err) => toast.show(friendlyError(err)));
      }
      const left = todo.length - ready.length;
      toast.show(`${ready.length} ${ready.length === 1 ? 'course' : 'courses'} set up for ${cohort}.${left ? ` ${left} still need a tutor.` : ''}`);
      onDone(left ? READY : key(ready[0]!.name));
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="common-add">
      <p className="small muted">Each course gets a Semester 1 and a Semester 2 marks sheet, and one register.</p>
      <ul className="ready-list">
        {todo.map((r) => (
          <li key={r.name}>
            <span className="ready-name">{r.name}{r.have && <span className="muted small"> · adds Semester {r.semesters.join(' and ')}</span>}</span>
            {r.have ? <span className="ready-tutor">{r.have.tutor}</span> : (
              <select aria-label={`Tutor for ${r.name}`} value={r.uid} onChange={(e) => setChosen({ ...chosen, [r.name]: e.target.value })}>
                <option value="">{loading ? 'Loading…' : 'Pick the tutor'}</option>
                {tutors.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
            )}
            {!loading && r.usualMissing && !r.uid && <span className="ready-note small">{r.tutor[0]} is not in the list yet: tick Common courses on their account under Settings → Staff accounts.</span>}
          </li>
        ))}
      </ul>
      <div className="common-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={loading || !ready.length}>
          Add {ready.length === todo.length ? 'all' : ready.length} to {cohort}
        </button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function AddCommonCourse({ orgId, cohort, taken, onAdded, onCancel }: {
  orgId: string; cohort: string; taken: string[]; onAdded: (key: string) => void; onCancel?: () => void;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(orgId);
  const { trainers, loading } = useExamTrainers(orgId);
  const tutors = tutorsOf(trainers);
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('both');
  const [tutor, setTutor] = useState('');

  function save() {
    const course = name.trim().replace(/\s+/g, ' ').slice(0, 120);
    const t = tutors.find((x) => x.uid === tutor);
    if (!course) return toast.show('Type the course name.');
    if (taken.includes(key(course))) return toast.show(`${cohort} already has ${course}.`);
    if (!t) return toast.show('Pick the tutor.');
    try {
      addSheets(orgId, cohort, course, semester === 'both' ? BOTH : [semester === '2' ? 2 : 1], t, settings.weights, a.myName, (err) => toast.show(friendlyError(err)));
      toast.show(`${course} added for ${cohort}.`);
      onAdded(key(course));
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="common-add">
      <div className="common-pick">
        <label className="field"><span>Course name</span>
          <input value={name} maxLength={120} placeholder="e.g. Entrepreneurship" onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field"><span>Semester</span>
          <select value={semester} onChange={(e) => setSemester(e.target.value)}>
            <option value="both">Semester 1 and 2</option><option value="1">Semester 1</option><option value="2">Semester 2</option>
          </select>
        </label>
        <label className="field"><span>Tutor</span>
          <select value={tutor} onChange={(e) => setTutor(e.target.value)}>
            <option value="">{loading ? 'Loading…' : 'Pick the tutor'}</option>
            {tutors.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {!loading && tutors.length === 0 && <p className="small muted">No tutor yet. Tick Common courses on a lecturer's account under Settings, Staff accounts.</p>}
      <div className="common-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Add course</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
