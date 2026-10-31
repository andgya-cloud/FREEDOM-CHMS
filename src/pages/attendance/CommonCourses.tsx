import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { useExamAccess, useExamCohorts, useExamSettings, useExamTrainers, useMyExamSheets, type ExamSheetRow, type ExamTrainer } from '../../state/useExams';
import { createExamSheet, deleteExamSheet, logExam, saveExamSettings, saveExamSheetDetails } from '../../lib/examWrites';
import { friendlyError } from '../../lib/errors';
import { mergedMarks } from '../../../functions/src/shared/exams';
import {
  COMMON_DEPARTMENT, commonClassName, commonCourseList, planCommonChanges, type CommonChange, type CommonCourseItem, type CommonSheet,
} from '../../../functions/src/shared/commonCourses';

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** One common course in one cohort: its marks sheets by semester and its tutor. */
interface Course { key: string; name: string; tutor: string; ownerUid: string; sheets: ExamSheetRow[] }

function coursesOf(sheets: ExamSheetRow[], order: string[]): Course[] {
  const by = new Map<string, Course>();
  for (const s of sheets) {
    const k = key(s.courseName);
    const c = by.get(k) ?? { key: k, name: s.courseName.trim(), tutor: s.teacherName || s.ownerName, ownerUid: s.ownerUid, sheets: [] };
    c.sheets.push(s);
    by.set(k, c);
  }
  for (const c of by.values()) c.sheets.sort((x, y) => (x.semester ?? 9) - (y.semester ?? 9));
  // In the order of the course list; courses no longer on it come after, A to Z.
  const at = (name: string) => { const i = order.indexOf(key(name)); return i < 0 ? order.length : i; };
  return [...by.values()].sort((x, y) => at(x.name) - at(y.name) || x.name.localeCompare(y.name));
}

/** The courses under a heading for each tutor (Andy, 2026-10-29, 1C). */
function byTutor(courses: Course[]): { tutor: string; courses: Course[] }[] {
  const groups: { tutor: string; courses: Course[] }[] = [];
  for (const c of courses) {
    const g = groups.find((x) => x.tutor === c.tutor);
    if (g) g.courses.push(c); else groups.push({ tutor: c.tutor, courses: [c] });
  }
  return groups;
}

/** Common courses go to lecturers with Common courses ticked, or to the principal or the pastor (Andy, 2026-10-28). */
const tutorsOf = (trainers: ExamTrainer[]) => trainers.filter((t) => t.lecturer === false || t.departments?.includes(COMMON_DEPARTMENT));

/** The Semester 1 and Semester 2 sheets whose average is the course's Finals (Andy, 2026-10-29, 4A). */
const finalsOf = (c: Course): [string, string] | null => {
  const one = c.sheets.find((x) => x.semester === 1);
  const two = c.sheets.find((x) => x.semester === 2);
  return one && two ? [one.id, two.id] : null;
};

const hasMarks = (s: ExamSheetRow) => Object.values(mergedMarks(s as unknown as Parameters<typeof mergedMarks>[0])).some((m) => m && Object.values(m).some((v) => v != null));
const asCommonSheet = (s: ExamSheetRow): CommonSheet => ({ id: s.id, cohort: s.cohort, courseName: s.courseName, ownerUid: s.ownerUid, semester: s.semester === 1 || s.semester === 2 ? s.semester : null, hasMarks: hasMarks(s) });

/** The course list and what saving it does, shared by the editor and the "add the missing courses" button. */
function useCommonList(orgId: string) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings, exists } = useExamSettings(orgId);
  const { trainers, loading } = useExamTrainers(orgId);
  const tutors = tutorsOf(trainers);
  const list = commonCourseList(settings.commonCourses, tutors);
  /** Makes the changes in the open cohorts, then saves the list. */
  function apply(changes: CommonChange[], next: CommonCourseItem[] | null) {
    const onError = (err: unknown) => toast.show(friendlyError(err));
    const log = (cohort: string, sheetId: string | null, detail: string) => void logExam(orgId, { action: 'setup', cohort, sheetId, detail, byName: a.myName }).catch(() => {});
    for (const c of changes) {
      if (c.kind === 'add') {
        const { ref, synced } = createExamSheet(orgId, {
          cohort: c.cohort, courseId: null, courseName: c.name, teacherName: c.tutorName.slice(0, 120),
          weights: settings.weights, ownerUid: c.tutorUid, ownerName: c.tutorName.slice(0, 120), semester: c.semester,
        });
        synced.catch(onError);
        log(c.cohort, ref.id, `Added ${c.name} (Common courses, Semester ${c.semester}) for ${c.tutorName}`);
      } else if (c.kind === 'move') {
        saveExamSheetDetails(orgId, c.sheetId, { ownerUid: c.tutorUid, ownerName: c.tutorName.slice(0, 120), teacherName: c.tutorName.slice(0, 120) }).catch(onError);
        log(c.cohort, c.sheetId, `${c.name}: given to ${c.tutorName}`);
      } else if (c.kind === 'rename') {
        saveExamSheetDetails(orgId, c.sheetId, { courseName: c.name.slice(0, 120) }).catch(onError);
        log(c.cohort, c.sheetId, `${c.from} renamed ${c.name}`);
      } else {
        deleteExamSheet(orgId, c.sheetId).catch(onError);
        log(c.cohort, c.sheetId, `Removed ${c.name} (no marks yet; taken off the common course list)`);
      }
    }
    if (next) saveExamSettings(orgId, exists, { ...settings, commonCourses: next }).catch(onError);
  }
  return { list, tutors, loading, apply };
}

/**
 * The Common courses panel on ADIA's Attendance page (Andy, 2026-10-28): pick the cohort, then the course with its
 * tutor, then Mark register, key in each semester's results, or see the Finals. A lecturer sees only their own
 * courses; Andy, Doreen and the principal change the course list itself with "Manage courses" (Andy, 2026-10-29).
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
  const [managing, setManaging] = useState(false);
  return (
    <div className="common-panel" role="region" aria-label="Common courses">
      <div className="common-panel-head">
        <h3>{managing ? 'Manage common courses' : 'Common courses'}</h3>
        <div className="common-actions">
          {a.canManage && !managing && <button type="button" className="btn btn-small" onClick={() => setManaging(true)}>Manage courses</button>}
          <button type="button" className="btn btn-quiet btn-small" onClick={managing ? () => setManaging(false) : onClose} aria-label={managing ? 'Back to common courses' : 'Close common courses'}>{managing ? 'Back' : 'Close'}</button>
        </div>
      </div>
      {managing ? <ManageCourses orgId={orgId} cohorts={cohorts} sheets={sheets} onDone={() => setManaging(false)} />
        : <PickCourse orgId={orgId} cohorts={cohorts} sheets={sheets} onRegister={onRegister} />}
    </div>
  );
}

function PickCourse({ orgId, cohorts, sheets, onRegister }: { orgId: string; cohorts: string[]; sheets: ExamSheetRow[]; onRegister: (courseName: string, cohort: string) => void }) {
  const a = useExamAccess();
  const navigate = useNavigate();
  const [cohort, setCohort] = useState(cohorts[0] ?? '');
  const [pick, setPick] = useState('');
  const { settings } = useExamSettings(orgId);
  const order = (settings.commonCourses ?? []).map((c) => key(c.name));
  const courses = useMemo(() => coursesOf(sheets.filter((s) => s.cohort === cohort), order), [sheets, cohort, order.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = courses.find((c) => c.key === pick) ?? (courses.length === 1 ? courses[0] : undefined);

  if (cohorts.length === 0) return <p className="muted small">{a.canManage ? 'No open cohort yet.' : 'You have no common course yet. The principal gives you one with Manage courses.'}</p>;
  return (
    <>
      <div className="common-pick">
        <label className="field"><span>Cohort</span>
          <select value={cohort} onChange={(e) => { setCohort(e.target.value); setPick(''); }}>
            {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Course</span>
          <select value={chosen?.key ?? ''} onChange={(e) => setPick(e.target.value)}>
            {!chosen && <option value="">{courses.length ? 'Pick the course' : 'No common course yet'}</option>}
            {byTutor(courses).map((g) => (
              <optgroup key={g.tutor} label={g.tutor}>
                {g.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {a.canManage && <MissingCourses orgId={orgId} cohort={cohort} sheets={sheets} />}
      {chosen && (
        <>
          <p className="common-tutor"><span className="muted">Tutor</span> <strong>{chosen.tutor}</strong></p>
          <div className="common-actions">
            <button type="button" className="btn btn-primary" onClick={() => onRegister(chosen.name, cohort)}>Mark register</button>
            {chosen.sheets.map((s) => (
              <button key={s.id} type="button" className="btn" onClick={() => navigate(`/school/exams/sheet/${s.id}`)}>
                {chosen.sheets.length > 1 && s.semester ? `Semester ${s.semester} results` : 'Key in results'}
              </button>
            ))}
            {finalsOf(chosen) && <button type="button" className="btn" onClick={() => navigate(`/school/exams/finals/${finalsOf(chosen)!.join('/')}`)}>Finals</button>}
          </div>
        </>
      )}
    </>
  );
}

/** A new cohort, or one started before a course joined the list: one tap gives it every course on the list. */
function MissingCourses({ orgId, cohort, sheets }: { orgId: string; cohort: string; sheets: ExamSheetRow[] }) {
  const toast = useToast();
  const { list, loading, apply } = useCommonList(orgId);
  if (loading || !cohort) return null;
  const adds = planCommonChanges(list, list, {}, [cohort], sheets.map(asCommonSheet)).filter((c) => c.kind === 'add');
  const names = [...new Set(adds.map((c) => c.name))];
  const noTutor = list.filter((c) => !c.tutorUid).map((c) => c.name);
  if (!names.length) return noTutor.length ? <p className="ready-note small">{noTutor.join(', ')} {noTutor.length === 1 ? 'has' : 'have'} no tutor yet. Pick one with Manage courses.</p> : null;
  return (
    <p className="ready-note small">
      {cohort} does not have {names.join(', ')} yet.{' '}
      <button type="button" className="btn btn-small" onClick={() => { apply(adds, null); toast.show(`${names.length} ${names.length === 1 ? 'course' : 'courses'} added to ${cohort}.`); }}>
        Add {names.length === 1 ? 'it' : `all ${names.length}`}
      </button>
    </p>
  );
}

interface Row { id: string; was: string; name: string; tutorUid: string }

/**
 * The common course list (Andy, 2026-10-29, 1A-5AB): add, rename or remove a course and choose its tutor. Saving
 * puts the change into every open cohort straight away: new courses are added, a new tutor takes the course over
 * with its marks, and a course taken off the list leaves the cohorts where no marks are in yet.
 */
function ManageCourses({ orgId, cohorts, sheets, onDone }: { orgId: string; cohorts: string[]; sheets: ExamSheetRow[]; onDone: () => void }) {
  const toast = useToast();
  const { list, tutors, loading, apply } = useCommonList(orgId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const shown = rows ?? list.map((c, i) => ({ id: `r${i}`, was: c.name, name: c.name, tutorUid: c.tutorUid }));
  const set = (id: string, patch: Partial<Row>) => setRows(shown.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const next: CommonCourseItem[] = shown.filter((r) => r.name.trim()).map((r) => {
    const t = tutors.find((x) => x.uid === r.tutorUid);
    return { name: r.name.trim().replace(/\s+/g, ' ').slice(0, 120), tutorUid: t?.uid ?? '', tutorName: t?.name ?? '' };
  });
  const renamed = Object.fromEntries(shown.filter((r) => r.was && key(r.was) !== key(r.name) && r.name.trim()).map((r) => [r.name.trim().replace(/\s+/g, ' ').slice(0, 120), r.was]));
  const changes = planCommonChanges(list, next, renamed, cohorts, sheets.map(asCommonSheet));
  const count = (k: CommonChange['kind']) => new Set(changes.filter((c) => c.kind === k).map((c) => `${c.cohort}|${c.name}`)).size;
  const dupes = next.filter((c, i) => next.findIndex((x) => key(x.name) === key(c.name)) !== i);
  const kept = list.filter((b) => !next.some((c) => key(renamed[c.name] ?? c.name) === key(b.name)))
    .filter((b) => sheets.some((s) => key(s.courseName) === key(b.name) && hasMarks(s))).map((b) => b.name);

  function save() {
    if (dupes.length) return toast.show(`${dupes[0]!.name} is on the list twice.`);
    apply(changes, next);
    toast.show(changes.length ? 'Saved. The open cohorts are updated.' : 'Saved.');
    onDone();
  }

  if (loading) return <p className="muted small">Loading…</p>;
  return (
    <div className="common-add">
      <p className="small muted">Each course runs in Semester 1 and 2, with one register. Changes go into every open cohort when you save.</p>
      <ul className="manage-list">
        {shown.map((r) => (
          <li key={r.id}>
            <input aria-label="Course name" value={r.name} maxLength={120} placeholder="Course name" onChange={(e) => set(r.id, { name: e.target.value })} />
            <select aria-label={`Tutor for ${r.name || 'this course'}`} value={r.tutorUid} onChange={(e) => set(r.id, { tutorUid: e.target.value })}>
              <option value="">Pick the tutor</option>
              {tutors.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
            </select>
            <button type="button" className="btn-link inv-remove" onClick={() => setRows(shown.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.name || 'this course'}`}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="common-actions">
        <button type="button" className="btn" onClick={() => setRows([...shown, { id: `n${Date.now()}`, was: '', name: '', tutorUid: '' }])}>+ Add a course</button>
      </div>
      {tutors.length === 0 && <p className="small muted">No tutor yet. Tick Common courses on a lecturer's account under Settings → Staff accounts.</p>}
      {rows && (
        <p className="small">
          {changes.length === 0 ? 'Nothing changes in the open cohorts.' : [
            count('add') && `${count('add')} ${count('add') === 1 ? 'course' : 'courses'} added`,
            count('move') && `${count('move')} moved to a new tutor (marks kept)`,
            count('rename') && `${count('rename')} renamed`,
            count('remove') && `${count('remove')} removed where no marks are in yet`,
          ].filter(Boolean).join(' · ')}
          {kept.length > 0 && <span className="muted"> {kept.join(', ')} stays in cohorts that already have marks.</span>}
        </p>
      )}
      <div className="common-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={!rows}>Save the list</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * "My common courses" on a tutor's home page (Andy, 2026-10-29, 6B): only the courses given to them, in the open
 * cohorts, each with its register, both semesters' results and the Finals. A course given to them later shows up here
 * by itself, and one moved to another tutor leaves.
 */
export function MyCommonCourses({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { sheets } = useMyExamSheets(orgId);
  const { byName } = useExamCohorts(orgId);
  const { settings } = useExamSettings(orgId);
  const order = (settings.commonCourses ?? []).map((c) => key(c.name));
  const mine = sheets.filter((s) => s.courseId == null && byName[s.cohort]?.closed !== true);
  if (!mine.length) return null;
  const cohorts = [...new Set(mine.map((s) => s.cohort))].sort((x, y) => y.localeCompare(x, undefined, { numeric: true }));
  return (
    <section className="card my-common">
      <h2>My common courses</h2>
      <ul className="my-common-list">
        {cohorts.flatMap((cohort) => coursesOf(mine.filter((s) => s.cohort === cohort), order).map((c) => (
          <li key={`${cohort}|${c.key}`}>
            <span className="my-common-name"><strong>{c.name}</strong> <span className="muted small">{cohort}</span></span>
            <span className="common-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => navigate('/attendance', { state: { register: commonClassName(c.name, cohort) } })}>Register</button>
              {c.sheets.map((s) => (
                <button key={s.id} type="button" className="btn btn-small" onClick={() => navigate(`/school/exams/sheet/${s.id}`)}>{s.semester ? `Sem ${s.semester}` : 'Results'}</button>
              ))}
              {finalsOf(c) && <button type="button" className="btn btn-small" onClick={() => navigate(`/school/exams/finals/${finalsOf(c)!.join('/')}`)}>Finals</button>}
            </span>
          </li>
        )))}
      </ul>
    </section>
  );
}
