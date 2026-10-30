import { useMemo, useState, type FormEvent } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { useAuth } from '../../state/AuthContext';
import { TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { friendlyError } from '../../lib/errors';
import {
  useAllExamSheets, useExamAccess, useExamCohorts, useExamLog, useExamMeta, useExamPrincipals, useExamSettings, useExamSheet, useExamSheets, useExamTrainers, useMyExamSheets, useDepartmentResults, type ExamSheetRow, type ExamTrainer,
} from '../../state/useExams';
import {
  approveExamSheet, askExamChange, closedNow, confirmPassword, createExamSheet, deleteExamSheet, emailExamNotice, logExam, returnExamSheet, saveExamMark, saveExamRemark, saveExamSettings, saveExamSheetDetails,
  saveExamCohort, saveExamCourseList, saveTypedResults, sendExamPapers, unlockExamPaper,
} from '../../lib/examWrites';
import { saveCourse, saveIntake } from '../../lib/schoolWrites';
import {
  classOf, classText, cohortLabel, dueText, latePapers, nextDue, notEligible, courseListFromSheets, courseListKey, dayMonthYear, lastTrainers, missingCourses, nextCohortName, orderCohorts, sortCourseList, withCourse,
  type CourseListItem, type ExamCohort, type ExamDeadlines,
} from '../../../functions/src/shared/examCohorts';
import { examNoticeText, type ExamNoticeKind } from '../../../functions/src/shared/examNotices';
import { bandsText, marksSheetPdf, resultSlipsPdf } from '../../lib/examPdf';
import { MarksUpload, ResultsAndTranscripts, ResultsUpload, TranscriptButton } from './ExamResults';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { ColumnChart, CsvButton, Donut, Gauge, KpiCard, KpiRow, Panel } from '../../components/charts';
import {
  ADIA_BANDS, buildExamReport, departmentSummary, EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, isLocked, markProblem, markText, parseMark, scopeKey, sheetProgress, unitTotal,
  usedComponents, weightsProblem,
  type ExamComponent, type ExamSettings, type ExamSheetStatus, type ExamStudent, type ExamWeights, type GradeBand,
} from '../../../functions/src/shared/exams';
import { studentAttendance } from '../../../functions/src/shared/school';
import { commonFinal } from '../../../functions/src/shared/commonCourses';
import { StudentFinder, useStudentFinder } from '../../components/StudentFinder';
import { MyCommonCourses } from '../attendance/CommonCourses';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { SchoolGate, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';
import type { CourseRow as Programme } from '../../state/useSchool';

/**
 * ADIA Exam Records, rebuilt with Andy (2026-10-24). The principal sets up each cohort's courses and
 * gives each to a trainer, approves what trainers send and prints results. A trainer sees only "My
 * classes": set the percentages, key in or upload marks, and send each paper; a sent paper locks
 * until the principal unlocks it (2026-10-25).
 */
export function ExamsPage() {
  return <SchoolGate title="Exam Records">{(org) => <Exams org={org} />}</SchoolGate>;
}
export function ExamSheetPage() {
  return <SchoolGate title="Marks sheet">{(org) => <SheetEditor org={org} />}</SchoolGate>;
}

export function CommonFinalsPage() {
  return <SchoolGate title="Finals">{(org) => <CommonFinals org={org} />}</SchoolGate>;
}

const BASE = '/school/exams';
const COMMON = 'common';
type View = 'home' | 'results' | 'setup' | 'student';
/** Links saved before the redesign (Andy, 2026-10-25) still land on the right screen. */
const OLD_VIEWS: Record<string, View> = {
  home: 'home', overview: 'home', progress: 'home', departments: 'results', results: 'results', reports: 'results', transcripts: 'results', setup: 'setup', sheets: 'setup', grading: 'setup',
  log: 'setup', student: 'student',
};
type CohortOrder = ReturnType<typeof orderCohorts>;

/** The intakes, by name, newest first: every programme's intake of the same name is one cohort. */
function useCohorts(org: Organization) {
  const s = useSchoolPage(org);
  const { byName: info } = useExamCohorts(org.id);
  const names = useMemo(() => [...new Set(s.intakes.map((i) => i.name))], [s.intakes]);
  // Many cohorts in one dropdown, newest first, the graduated ones under "Past cohorts" (Andy, 2026-10-25).
  const order = useMemo(() => orderCohorts(names, s.intakes, info), [names, s.intakes, info]);
  const cohorts = useMemo(() => [...order.current, ...order.past].map((c) => c.name), [order]);
  /** The students of a cohort who sit exams: enrolled or graduated, from every programme. */
  const studentsOf = (cohort: string): ExamStudent[] => s.students
    .filter((st) => !st.deletedAt && (st.status === 'enrolled' || st.status === 'graduated') && s.intakeName(st.intakeId) === cohort)
    .map((st) => ({ id: st.id, name: s.nameOf(st.id), admissionNo: st.admissionNo ?? '', courseId: st.courseId, courseName: s.courseName(st.courseId) }));
  /** Every student, for matching uploaded results by admission number. */
  const allStudents = useMemo(() => s.students.filter((st) => !st.deletedAt)
    .map((st) => ({ id: st.id, admissionNo: st.admissionNo ?? '', name: s.nameOf(st.id), courseId: st.courseId, cohort: s.intakeName(st.intakeId) })), [s.students, s.intakes, s.peopleLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Attendance comes from the class registers on the Attendance page (Andy, 2026-10-24). */
  const attendance = useMemo(() => Object.fromEntries(s.students.map((st) => [st.id, studentAttendance(st.id, s.courseName(st.courseId), s.events, s.records, st.enrolledOn).percent])),
    [s.students, s.events, s.records, s.courses]); // eslint-disable-line react-hooks/exhaustive-deps
  return { s, cohorts, order, info, studentsOf, allStudents, attendance };
}

const rosterFor = (students: ExamStudent[], courseId: string | null) =>
  (courseId == null ? students : students.filter((x) => x.courseId === courseId)).sort((a, b) => a.name.localeCompare(b.name));
const programmeOf = (courseId: string | null, courseName: (id: string) => string) => (courseId == null ? 'Common courses' : courseName(courseId) || 'Programme');
/**
 * A common course goes to a lecturer with "Common courses" ticked (Andy, 2026-10-28, 5A), or to the principal
 * or the pastor, who may teach one themselves (Andy teaches Leadership); other courses to anyone who marks.
 */
const trainersFor = (trainers: ExamTrainer[], courseId: string | null) => (courseId == null ? trainers.filter((t) => t.lecturer === false || t.departments?.includes(COMMON)) : trainers);
const semesterText = (n: number | null | undefined) => (n ? `Semester ${n}` : 'No semester');

/**
 * The principal's Exam Records, redesigned with Andy (2026-10-25): one screen with the cohort at the top
 * and each department's courses under it; Results and Setup are two buttons.
 */
function Exams({ org }: { org: Organization }) {
  const a = useExamAccess();
  const { can } = useAuth();
  const { s, cohorts, order, info, studentsOf, allStudents, attendance } = useCohorts(org);
  const { settings } = useExamSettings(org.id);
  const [params, setParams] = useSearchParams();
  const picked = params.get('cohort');
  const cohort = picked && cohorts.includes(picked) ? picked : order.current[0]?.name ?? cohorts[0] ?? '';
  const rawView = params.get('view') ?? params.get('tab') ?? '';
  const view: View = OLD_VIEWS[rawView] ?? 'home';
  const dept = params.get('dept') ?? '';
  const go = (changes: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.delete('tab');
    for (const [k, v] of Object.entries(changes)) if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const { sheets } = useExamSheets(org.id, a.canManage ? cohort : '');
  const students = useMemo(() => studentsOf(cohort), [cohort, s.students, s.intakes, s.peopleLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const courses = useMemo(() => s.courses.map((c) => ({ id: c.id, name: c.name })), [s.courses]);
  const courseList = useCourseList(org.id, cohorts);
  const choice = [...order.current, ...order.past].find((c) => c.name === cohort);
  const closed = !!choice?.closed;
  // "Cohort 1 · Class of 2025" on printouts, slips and transcripts, so each graduating class is dated.
  const label = choice?.graduationDate ? `${cohort} · ${classOf(choice.graduationDate)}` : cohort;
  const canStart = can('settings.manage') || can('school.manage');

  if (!a.canMark) return <div className="page narrow"><h1>Exam Records</h1><p>Exam Records are for trainers and the principal. Ask the pastor to tick it for your account.</p></div>;
  if (!a.canManage) return <MyClasses org={org} studentsOf={studentsOf} allStudents={allStudents} courseName={s.courseName} />;
  const sub = view === 'results' ? 'Results' : view === 'setup' ? 'Setup' : view === 'student' ? 'Student' : '';

  return (
    <div className="page narrow exams">
      <div className="page-head">
        <h1>Exam Records{sub && <span className="muted"> · {sub}</span>}</h1>
        {cohorts.length > 0 && (
          <span className="row-actions no-print">
            {view === 'home'
              ? <><button type="button" className="btn btn-quiet" onClick={() => go({ view: 'results' })}>Results</button><button type="button" className="btn btn-quiet" onClick={() => go({ view: 'setup' })}>Setup</button></>
              : <button type="button" className="btn btn-quiet" onClick={() => go({ view: '', student: '', section: '' })}>← Courses</button>}
          </span>
        )}
      </div>
      {cohorts.length === 0 ? (
        <section className="stack">
          <div className="notice">No cohorts yet. {canStart ? 'Start the first one here.' : <>Add a cohort in <Link to="/school/courses">Settings → Programmes</Link> first.</>}</div>
          {canStart && <NewCohort org={org} cohorts={cohorts} programmes={s.courses} today={s.today} onStarted={(c) => go({ cohort: c })} />}
        </section>
      ) : view === 'student' ? (
        <StudentRecord org={org} studentId={params.get('student') ?? ''} s={s} studentsOf={studentsOf} info={info} attendance={attendance} minAttendance={settings.minAttendance ?? null} />
      ) : (
        <>
          {/* Dropdowns keep the page uncluttered (Andy, 2026-10-25): the cohort, then one department or all. */}
          <div className="exam-pickers no-print">
            <select className="exam-cohort-pick" aria-label="Cohort" value={cohort} onChange={(e) => go({ cohort: e.target.value })}>
              {order.current.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}
              {order.past.length > 0 && <optgroup label="Past cohorts">{order.past.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
            </select>
            {view === 'home' && (
              <select className="exam-dept-pick" aria-label="Department" value={dept} onChange={(e) => go({ dept: e.target.value })}>
                <option value="">All departments</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={COMMON}>Common courses</option>
              </select>
            )}
          </div>
          <div className="print-only exam-print-head"><strong>ADIA Training Centre</strong> · {label}</div>
          <ClassLine org={org} cohort={cohort} closed={closed} graduationDate={choice?.graduationDate ?? null} closedByName={info[cohort]?.closedByName ?? null} today={s.today} onSetDate={() => go({ view: 'setup', section: 'graduation' })} />
          {view === 'home' && (
            <>
              <FindStudent students={allStudents} onPick={(id) => go({ view: 'student', student: id })} />
              <Home org={org} cohort={cohort} closed={closed} dept={dept} sheets={sheets} students={students} courses={courses} courseList={courseList}
                deadlines={info[cohort]?.deadlines} today={s.today} onSetup={() => go({ view: 'setup', section: 'courses' })} />
            </>
          )}
          {view === 'results' && <Results org={org} cohort={cohort} label={label} sheets={sheets} students={students} courses={courses} courseName={s.courseName} attendance={attendance} minAttendance={settings.minAttendance ?? null} />}
          {view === 'setup' && (
            <Setup org={org} cohort={cohort} cohorts={cohorts} order={order} closed={closed} info={info} sheets={sheets} students={students} courses={courses} programmes={s.courses}
              courseList={courseList} allStudents={allStudents} today={s.today} canStart={canStart} section={rawView === 'log' ? 'log' : params.get('section') ?? ''}
              onSection={(x) => go({ view: 'setup', section: x })} onStarted={(c) => go({ cohort: c, view: '', section: '' })} />
          )}
        </>
      )}
    </div>
  );
}

/** "Find a student" (Andy, 2026-10-25, 5A): any cohort, by name or admission number. */
function FindStudent({ students, onPick }: { students: { id: string; name: string; admissionNo: string; cohort: string }[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const plain = t.replace(/[^a-z0-9]/g, '');
  const hits = t.length < 2 ? [] : students.filter((st) => st.name.toLowerCase().includes(t) || (plain && st.admissionNo.toLowerCase().replace(/[^a-z0-9]/g, '').includes(plain))).slice(0, 8);
  return (
    <div className="exam-find no-print">
      <input type="search" value={q} placeholder="Find a student by name or admission number" aria-label="Find a student" onChange={(e) => setQ(e.target.value)} />
      {t.length >= 2 && (
        <ul className="exam-find-hits">
          {hits.length === 0 ? <li className="muted small">No student matches "{q.trim()}".</li> : hits.map((st) => (
            <li key={st.id}><button type="button" onClick={() => onPick(st.id)}><strong>{st.name}</strong><span className="muted small">{st.admissionNo || 'No admission no.'} · {st.cohort || 'No cohort'}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One student's record: every course's marks, their standing, attendance and transcript. */
function StudentRecord({ org, studentId, s, studentsOf, info, attendance, minAttendance }: {
  org: Organization; studentId: string; s: ReturnType<typeof useSchoolPage>; studentsOf: (cohort: string) => ExamStudent[];
  info: Record<string, ExamCohort | undefined>; attendance: Record<string, number | null>; minAttendance: number | null;
}) {
  const { settings } = useExamSettings(org.id);
  const st = s.students.find((x) => x.id === studentId);
  const cohort = st ? s.intakeName(st.intakeId) : '';
  const { sheets } = useExamSheets(org.id, cohort);
  if (!st) return <p className="muted">{s.peopleLoading ? 'Loading…' : 'This student was not found.'}</p>;
  const classmates = studentsOf(cohort);
  const me: ExamStudent = classmates.find((x) => x.id === st.id) ?? { id: st.id, name: s.nameOf(st.id), admissionNo: st.admissionNo ?? '', courseId: st.courseId, courseName: s.courseName(st.courseId) };
  const mine = sortCourseList(sheets.filter((sh) => sh.courseId == null || sh.courseId === st.courseId).map((sh) => ({ sh, name: sh.courseName, courseId: sh.courseId, semester: sh.semester ?? null })));
  const standing = departmentSummary(st.courseId, sheets, classmates, settings).rows.find((r) => r.studentId === st.id);
  const out = departmentSummary(st.courseId, sheets, classmates, settings).rows.filter((r) => r.position != null).length;
  const grad = info[cohort]?.graduationDate;
  const label = grad ? `${cohort} · ${classOf(grad)}` : cohort;
  const att = attendance[st.id] ?? null;
  const used = EXAM_COMPONENTS.filter((c) => mine.some(({ sh }) => usedComponents(sh.weights).includes(c)));
  return (
    <section className="stack">
      <section className="card stack">
        <div className="card-head"><h2>{me.name}</h2><TranscriptButton org={org} cohort={cohort} label={label} student={me} sheets={sheets} courseName={s.courseName} /></div>
        <p className="muted">{me.admissionNo || 'No admission no.'} · {me.courseName || 'No department'} · {label || 'No cohort'} · {st.status}</p>
        <KpiRow label="Standing">
          <KpiCard label="So far" value={standing?.soFar == null ? '–' : `${standing.soFar}%`} note={standing?.grade || ''} tone="gold" />
          <KpiCard label="Position" value={standing?.position == null ? '–' : `${standing.position} of ${out}`} note={me.courseName} />
          <KpiCard label="Attendance" value={att == null ? '–' : `${att}%`} tone={notEligible(att, minAttendance) ? 'warn' : undefined} note={notEligible(att, minAttendance) ? `Not eligible (below ${minAttendance}%)` : ''} />
        </KpiRow>
      </section>
      {mine.length === 0 ? <p className="muted">No courses for {cohort} yet.</p> : (
        <div className="card exam-table-wrap">
          <table className="table exam-table">
            <thead><tr><th>Course</th><th>Semester</th>{used.map((c) => <th key={c} className="num">{EXAM_COMPONENT_LABELS[c]}</th>)}<th className="num">Total</th><th>Grade</th><th>Status</th></tr></thead>
            <tbody>
              {mine.map(({ sh }) => {
                const m = sh.marks?.[st.id];
                const u = unitTotal(sh.weights, m, settings.passMark);
                return (
                  <tr key={sh.id}>
                    <td><Link to={`${BASE}/sheet/${sh.id}`}>{sh.courseName}</Link><div className="muted small">{sh.teacherName}</div></td>
                    <td>{semesterText(sh.semester)}</td>
                    {used.map((c) => <td key={c} className="num">{usedComponents(sh.weights).includes(c) ? (markText(m?.[c]) || '–') : ''}{usedComponents(sh.weights).includes(c) && m?.[c] != null && <span className="muted small">/{sh.weights[c].max}</span>}</td>)}
                    <td className="num"><strong>{u.exempt ? 'EX' : u.total ?? (u.partial != null ? <span className="muted">({u.partial})</span> : '–')}</strong></td>
                    <td>{u.exempt ? 'Exempt' : u.total == null ? '' : gradeFor(u.total, settings).grade}</td>
                    <td><StatusPill status={sh.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** "Class of 2026 · Graduates 11 Dec 2026", or, once closed, the reopen button (password needed). */
function ClassLine({ org, cohort, closed, graduationDate, closedByName, today, onSetDate }: {
  org: Organization; cohort: string; closed: boolean; graduationDate: string | null; closedByName: string | null; today: string; onSetDate: () => void;
}) {
  const [reopening, setReopening] = useState(false);
  const text = classText(graduationDate, today);
  if (closed) {
    return (
      <div className="notice stack exam-closed">
        <p><strong>{text || 'Graduated'}.</strong> This cohort is closed, so its marks are read only{closedByName ? ` (closed by ${closedByName})` : ''}.</p>
        {reopening ? <ReopenCohort org={org} cohort={cohort} onDone={() => setReopening(false)} /> : <button type="button" className="btn btn-quiet btn-small align-start no-print" onClick={() => setReopening(true)}>Reopen</button>}
      </div>
    );
  }
  return <p className="muted exam-class">{text || <>No graduation date yet. <button type="button" className="btn-link no-print" onClick={onSetDate}>Set it</button></>}</p>;
}

/** Only the principal, an admin, Andy or Doreen reopen a graduated cohort, with their own password (Andy, 2026-10-25). */
function ReopenCohort({ org, cohort, onDone }: { org: Organization; cohort: string; onDone: () => void }) {
  const a = useExamAccess();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function reopen(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      await confirmPassword(password);
      await saveExamCohort(org.id, cohort, true, { closed: false, reopenedByName: a.myName.slice(0, 120), reopenedAt: closedNow() });
      void logExam(org.id, { action: 'reopen', cohort, sheetId: null, detail: `${cohort} reopened`, byName: a.myName });
      toast.show(`${cohort} is open again. Close it in Setup when you are done.`);
      onDone();
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); setPassword(''); }
  }
  return (
    <form className="row-actions no-print" onSubmit={(e) => void reopen(e)}>
      <label className="field"><span>Your password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit" className="btn btn-primary align-end" disabled={busy || !password}>{busy ? 'Checking…' : 'Reopen'}</button>
      <button type="button" className="btn btn-quiet align-end" onClick={onDone}>Cancel</button>
    </form>
  );
}

/**
 * ADIA's course list (Andy, 2026-10-25, 3A): each programme's courses, set once. Until the principal saves
 * one, it is every course the cohorts so far have had.
 */
function useCourseList(orgId: string, newestFirst: string[]) {
  const { settings, exists } = useExamSettings(orgId);
  const { sheets } = useAllExamSheets(orgId);
  const list = useMemo(() => (settings.courseList ? sortCourseList(settings.courseList) : courseListFromSheets(sheets, newestFirst)), [settings.courseList, sheets, newestFirst]);
  const last = useMemo(() => lastTrainers(sheets, newestFirst), [sheets, newestFirst]);
  return { list, saved: !!settings.courseList, last, save: (next: CourseListItem[]) => saveExamCourseList(orgId, exists, settings, sortCourseList(next)) };
}
type CourseList = ReturnType<typeof useCourseList>;

/** Departments in order, then the common courses. */
function departmentsOf<T extends { courseId: string | null }>(items: T[], courses: { id: string; name: string }[]): { id: string | null; name: string; items: T[] }[] {
  const known = new Set(courses.map((c) => c.id));
  return [
    ...courses.map((c) => ({ id: c.id as string | null, name: c.name, items: items.filter((x) => x.courseId === c.id) })),
    { id: null, name: 'Common courses', items: items.filter((x) => x.courseId == null) },
    { id: 'other', name: 'Other', items: items.filter((x) => x.courseId != null && !known.has(x.courseId)) },
  ].filter((g) => g.items.length > 0);
}

function StatusPill({ status }: { status: ExamSheetStatus | string }) {
  if (status === 'approved') return <span className="badge badge-ok">Approved</span>;
  if (status === 'submitted') return <span className="badge badge-gold">Waiting for approval</span>;
  return <span className="badge badge-warn">Marking</span>;
}

/* ---------- the trainer's screen ---------- */

function MyClasses({ org, studentsOf, allStudents, courseName }: { org: Organization; studentsOf: (cohort: string) => ExamStudent[]; allStudents: PastStudent[]; courseName: (id: string) => string }) {
  const { sheets: mine, loading } = useMyExamSheets(org.id);
  const { byName } = useExamCohorts(org.id);
  const today = localDateKey(new Date(), org.timeZone);
  const { profile } = useAuth();
  const departments = profile?.roleId === TRAINER_ROLE_ID ? profile.trainerCourseIds ?? [] : null;
  // A graduated (closed) cohort drops off the trainer's list (Andy, 2026-10-25), and so does any course outside their department (Andy, 2026-10-28).
  const sheets = mine.filter((sh) => byName[sh.cohort]?.closed !== true && (!departments || sh.courseId == null || departments.includes(sh.courseId)));
  const cohorts = [...new Set(sheets.map((s) => s.cohort))];
  return (
    <div className="page narrow exams">
      <div className="page-head"><h1>My classes</h1></div>
      <MyCommonCourses orgId={org.id} />
      {departments && departments.length === 0 && <div className="notice">Your department hasn't been set yet. Ask the office to set it on your account; your students and classes then show here.</div>}
      <p className="muted">Tap a class to key in marks or upload them from Excel. When a CAT's marks are in, send it to the principal; it locks.</p>
      {sheets.length === 0 ? <p className="muted">{loading ? 'Loading…' : 'No classes yet. The principal sets up the courses and gives each one to its trainer; yours will show here.'}</p> : cohorts.map((c) => {
        const students = studentsOf(c);
        return (
          <section key={c} className="stack">
            <h2>{c}</h2>
            <ul className="exam-cards">
              {sheets.filter((s) => s.cohort === c).map((sh) => {
                const roster = rosterFor(students, sh.courseId);
                const pctDone = sheetProgress(sh, roster.map((x) => x.id));
                return (
                  <li key={sh.id}>
                    <Link to={`${BASE}/sheet/${sh.id}`} className="exam-card">
                      <span className="exam-card-head"><strong>{sh.courseName || 'Untitled course'}</strong><StatusPill status={sh.status} /></span>
                      <span className="muted small">{programmeOf(sh.courseId, courseName)} · {semesterText(sh.semester)} · {roster.length} students</span>
                      <span className="exam-bar"><span style={{ width: `${pctDone}%` }} className={pctDone >= 100 ? 'done' : ''} /></span>
                      <span className="muted small">{pctDone}% of marks entered{sentText(sh)}</span>
                      {(() => { const d = nextDue(sh, byName[sh.cohort]?.deadlines, today); return d && <span className={`small${d.daysLate > 0 ? ' up-bad' : ' muted'}`}>{dueText(d)}</span>; })()}
                      {sh.changeRequest && <span className="small up-bad">Waiting for the principal to unlock {EXAM_COMPONENT_LABELS[sh.changeRequest.component]}</span>}
                      {sh.status === 'draft' && sh.returnNote && <span className="small up-bad">Sent back: {sh.returnNote}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {departments && departments.some((d) => d !== COMMON) && <PastResults org={org} students={allStudents} departments={departments.filter((d) => d !== COMMON)} courseName={courseName} />}
    </div>
  );
}

type PastStudent = { id: string; admissionNo: string; name: string; courseId: string; cohort: string };

/**
 * A lecturer types in past semester results for their own department (Andy, 2026-10-28): every student of
 * the cohort is listed with their admission number, ready for the points. Results the principal uploaded
 * show but can't be changed here.
 */
function PastResults({ org, students, departments, courseName }: { org: Organization; students: PastStudent[]; departments: string[]; courseName: (id: string) => string }) {
  const toast = useToast();
  const { profile } = useAuth();
  const { settings } = useExamSettings(org.id);
  const results = useDepartmentResults(org.id, departments);
  const mine = students.filter((st) => departments.includes(st.courseId) && st.cohort);
  const cohorts = [...new Set(mine.map((st) => st.cohort))].sort((x, y) => y.localeCompare(x, undefined, { numeric: true }));
  const [cohort, setCohort] = useState('');
  const [dept, setDept] = useState('');
  const [typed, setTyped] = useState<Record<string, { '1': string; '2': string }>>({});
  const [busy, setBusy] = useState(false);
  const finder = useStudentFinder();
  const pickedCohort = cohort && cohorts.includes(cohort) ? cohort : cohorts[0] ?? '';
  const pickedDept = dept && departments.includes(dept) ? dept : departments[0] ?? '';
  const rows = mine.filter((st) => st.cohort === pickedCohort && st.courseId === pickedDept).sort((x, y) => x.name.localeCompare(y.name));
  const saved = new Map(results.filter((r) => r.cohort === pickedCohort).map((r) => [r.studentId, r]));
  const shown = (v: number | undefined) => (v == null ? '' : String(v));
  const valueOf = (id: string, sem: '1' | '2') => typed[id]?.[sem] ?? shown(saved.get(id)?.semesters[sem]?.points);
  const points = (t: string) => { const n = Number(t.trim()); return t.trim() === '' ? null : Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : NaN; };
  const changed = rows.filter((st) => typed[st.id] && (['1', '2'] as const).some((k) => typed[st.id]![k] !== shown(saved.get(st.id)?.semesters[k]?.points)));
  const bad = changed.filter((st) => (['1', '2'] as const).some((k) => Number.isNaN(points(valueOf(st.id, k)))));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (bad.length) return toast.show(`Check ${bad[0]!.name}: points go from 0 to 100.`);
    if (!changed.length) return;
    setBusy(true);
    try {
      await saveTypedResults(org.id, changed.map((st) => {
        const semesters: Partial<Record<'1' | '2', { points: number; grade: string | null }>> = {};
        for (const k of ['1', '2'] as const) { const p = points(valueOf(st.id, k)); if (p != null) semesters[k] = { points: p, grade: gradeFor(p, settings).grade || null }; }
        return { result: { cohort: pickedCohort, studentId: st.id, admissionNo: st.admissionNo, studentName: st.name, courseId: st.courseId, semesters, printed: null, notes: [] }, exists: saved.has(st.id) };
      }));
      setTyped({});
      toast.show(`${changed.length} ${changed.length === 1 ? 'result' : 'results'} saved.`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="fold-card past-results">
      <summary>Type in past results</summary>
      <p className="muted small">Semester points out of 100 for each student. The grade is worked out for you. Results the principal uploaded can't be changed here.</p>
      {cohorts.length === 0 ? <p className="muted">No students in your department yet.</p> : (
        <form className="stack" onSubmit={(e) => void save(e)}>
          <div className="exam-pickers">
            <select aria-label="Cohort" value={pickedCohort} onChange={(e) => { setCohort(e.target.value); setTyped({}); }}>
              {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {departments.length > 1 && (
              <select aria-label="Department" value={pickedDept} onChange={(e) => { setDept(e.target.value); setTyped({}); }}>
                {departments.map((d) => <option key={d} value={d}>{courseName(d) || d}</option>)}
              </select>
            )}
          </div>
          {rows.length > 0 && <StudentFinder finder={finder} names={rows.map((st) => st.name)} shown={rows.filter((st) => finder.match(st.name, st.admissionNo)).length} total={rows.length} />}
          {rows.length === 0 ? <p className="muted">No {courseName(pickedDept)} students in {pickedCohort}.</p> : (
            <div className="table-wrap">
              <table className="data-table past-table">
                <thead><tr><th>Student</th><th>Admission no.</th><th className="num">Sem 1</th><th className="num">Sem 2</th><th className="num">Final</th></tr></thead>
                <tbody>
                  {rows.filter((st) => finder.match(st.name, st.admissionNo)).map((st) => {
                    const r = saved.get(st.id);
                    const locked = !!r && r.createdBy !== profile?.uid;
                    const p1 = points(valueOf(st.id, '1'));
                    const p2 = points(valueOf(st.id, '2'));
                    const fin = p1 != null && p2 != null && !Number.isNaN(p1) && !Number.isNaN(p2) ? Math.round(((p1 + p2) / 2) * 100) / 100 : null;
                    const cell = (k: '1' | '2') => (
                      <td className="num">
                        <input className={`mark-input${Number.isNaN(points(valueOf(st.id, k))) ? ' bad' : ''}`} inputMode="decimal" aria-label={`${st.name}, semester ${k}`} disabled={locked || busy}
                          value={valueOf(st.id, k)} onChange={(e) => setTyped((t) => ({ ...t, [st.id]: { '1': valueOf(st.id, '1'), '2': valueOf(st.id, '2'), [k]: e.target.value } }))} />
                      </td>
                    );
                    return (
                      <tr key={st.id}>
                        <td>{st.name}{locked && <div className="muted small">From the principal</div>}</td>
                        <td className="small">{st.admissionNo}</td>
                        {cell('1')}{cell('2')}
                        <td className="num">{fin == null ? '–' : `${fin} ${gradeFor(fin, settings).grade}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && <button type="submit" className="btn btn-primary align-start" disabled={busy || !changed.length}>{busy ? 'Saving…' : changed.length ? `Save ${changed.length} ${changed.length === 1 ? 'result' : 'results'}` : 'Nothing to save'}</button>}
        </form>
      )}
    </details>
  );
}

/* ---------- the principal's Overview ---------- */

const STATUS_ORDER: Record<string, number> = { submitted: 0, draft: 1, approved: 2 };
/** " · CAT 1 and CAT 2 sent", for a course still being marked. */
const sentText = (sh: ExamSheetRow) => {
  const sent = usedComponents(sh.weights).filter((c) => isLocked(sh, c) && c !== 'final').map((c) => EXAM_COMPONENT_LABELS[c]);
  return sh.status === 'draft' && sent.length ? ` · ${sent.join(', ')} sent` : '';
};
const waLink = (phone: string, text: string) => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = `254${d.slice(1)}`;
  return `https://wa.me/${d.length >= 9 ? d : ''}?text=${encodeURIComponent(text)}`;
};

function useSheetActions(org: Organization) {
  const a = useExamAccess();
  const toast = useToast();
  return {
    approve(sh: ExamSheetRow) {
      approveExamSheet(org.id, sh.id, a.myName).then(() => toast.show(`${sh.courseName} approved. Its results are final.`), (err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'approve', cohort: sh.cohort, sheetId: sh.id, detail: `${sh.courseName} / ${sh.teacherName} approved`, byName: a.myName });
    },
    sendBack(sh: ExamSheetRow) {
      const note = window.prompt(`Send ${sh.courseName} back to ${sh.teacherName}? Type what needs changing; the trainer sees this note.`, '');
      if (note == null) return;
      returnExamSheet(org.id, sh.id, note).then(() => toast.show(`Sent back to ${sh.teacherName}.`), (err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'send back', cohort: sh.cohort, sheetId: sh.id, detail: `${sh.courseName} / ${sh.teacherName}${note.trim() ? `: ${note.trim()}` : ''}`, byName: a.myName });
    },
  };
}

function Home({ org, cohort, closed, dept, sheets, students, courses, courseList, deadlines, today, onSetup }: {
  org: Organization; cohort: string; closed: boolean; dept: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[]; courseList: CourseList;
  deadlines: ExamDeadlines | undefined; today: string; onSetup: () => void;
}) {
  const { trainers } = useExamTrainers(org.id);
  const act = useSheetActions(org);
  if (!sheets.length) {
    return closed ? <p className="muted">No courses were set up for {cohort}.</p> : <NewCohortCourses org={org} cohort={cohort} sheets={sheets} courses={courses} courseList={courseList} first onSetup={onSetup} />;
  }
  const count = (st: string) => sheets.filter((x) => x.status === st).length;
  const waiting = count('submitted');
  const asks = sheets.filter((x) => x.changeRequest).length;
  const lateOf = (sh: ExamSheetRow) => (closed ? [] : latePapers(sh, deadlines, today));
  const late = sheets.filter((x) => lateOf(x).length).length;
  const phoneOf = (uid: string) => trainers.find((t) => t.uid === uid)?.phone ?? '';
  const remind = (sh: ExamSheetRow, pctDone: number) => {
    const l = lateOf(sh)[0];
    const when = l ? ` ${EXAM_COMPONENT_LABELS[l.component]} was due on ${dayMonthYear(l.due)}, ${l.daysLate} ${l.daysLate === 1 ? 'day' : 'days'} ago.` : '';
    return waLink(phoneOf(sh.ownerUid), `Hello ${sh.teacherName}, a reminder from ADIA: your ${sh.courseName} marks for ${cohort} are ${pctDone}% entered.${when} Please key in the rest and send each paper in Insight-IQ, Exam Records. Thank you.`);
  };
  const rows = sheets.map((sh) => ({ courseId: sh.courseId ?? null, sh, pct: sheetProgress(sh, rosterFor(students, sh.courseId).map((x) => x.id)) }))
    .sort((x, y) => Number(!!y.sh.changeRequest) - Number(!!x.sh.changeRequest) || (STATUS_ORDER[x.sh.status] ?? 1) - (STATUS_ORDER[y.sh.status] ?? 1) || (x.sh.semester ?? 9) - (y.sh.semester ?? 9) || x.sh.courseName.localeCompare(y.sh.courseName));
  const groups = departmentsOf(rows, courses).filter((g) => !dept || (dept === COMMON ? g.id == null : g.id === dept));
  return (
    <section className="stack">
      <p className="muted">
        {sheets.length} {sheets.length === 1 ? 'course' : 'courses'} · {count('approved')} approved · {students.length} students
        {waiting > 0 && <> · <strong className="up-bad">{waiting} waiting for you</strong></>}
        {asks > 0 && <> · <strong className="up-bad">{asks} asking to change marks</strong></>}
        {late > 0 && <> · <strong className="up-bad">{late} late</strong></>}
      </p>
      {groups.length === 0 && <p className="muted">No courses in this department for {cohort}.</p>}
      {groups.map((g) => {
        const done = g.items.filter((r) => r.sh.status === 'approved').length;
        const needs = g.items.filter((r) => r.sh.status === 'submitted' || r.sh.changeRequest || lateOf(r.sh).length).length;
        return (
          // Each department folds to one line (Andy, 2026-10-25, 2A); picking one department opens it.
          <details key={g.id ?? COMMON} className="card exam-dept" open={!!dept || groups.length === 1}>
            <summary>
              <strong>{g.name}</strong>
              <span className="muted small">{g.items.length} {g.items.length === 1 ? 'course' : 'courses'} · {done} approved · {g.id == null ? students.length : rosterFor(students, g.id).length} students</span>
              {needs > 0 && !closed && <span className="badge badge-warn">{needs} need you</span>}
            </summary>
            <ul className="exam-list">
              {g.items.map(({ sh, pct }) => {
                const l = lateOf(sh)[0];
                return (
                  <li key={sh.id}>
                    <Link to={`${BASE}/sheet/${sh.id}`} className="exam-list-main">
                      <strong>{sh.courseName || 'Untitled'}</strong>
                      <span className="muted small">{sh.teacherName} · {semesterText(sh.semester)}{sentText(sh)}</span>
                      <span className="exam-bar"><span style={{ width: `${pct}%` }} className={pct >= 100 ? 'done' : ''} /></span>
                      {l && <span className="small up-bad">{dueText(l)}</span>}
                      {sh.changeRequest && !closed && <span className="small up-bad">Asks to change {EXAM_COMPONENT_LABELS[sh.changeRequest.component]}: {sh.changeRequest.reason}</span>}
                    </Link>
                    <span className="exam-list-side">
                      {closed ? <StatusPill status={sh.status} /> : <>
                        {sh.changeRequest ? <Link className="btn btn-primary btn-small" to={`${BASE}/sheet/${sh.id}`}>Unlock</Link> : <StatusPill status={sh.status} />}
                        {sh.status === 'submitted' && <button type="button" className="btn btn-primary btn-small" onClick={() => act.approve(sh)}>Approve</button>}
                        {sh.status === 'draft' && <a className={`btn btn-small ${l ? 'btn-primary' : 'btn-quiet'}`} href={remind(sh, pct)} target="_blank" rel="noreferrer">Remind</a>}
                      </>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

/**
 * A new cohort gets the courses on the course list in one step (Andy, 2026-10-25, 3A): each starts with the
 * trainer who marked it last; the principal checks the trainers and creates them.
 */
function NewCohortCourses({ org, cohort, sheets, courses, courseList, first, onSetup }: {
  org: Organization; cohort: string; sheets: ExamSheetRow[]; courses: { id: string; name: string }[]; courseList: CourseList; first?: boolean; onSetup?: () => void;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { trainers, loading } = useExamTrainers(org.id);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const missing = missingCourses(courseList.list, sheets);
  const trainerFor = (c: CourseListItem) => {
    const k = courseListKey(c);
    if (k in picks) return picks[k]!;
    const t = courseList.last.get(k);
    return t && trainers.some((x) => x.uid === t.uid) ? t.uid : '';
  };
  if (!missing.length) {
    return first ? (
      <div className="notice stack">
        <p>No courses are set up for {cohort} yet, and the course list is empty.</p>
        {onSetup && <button type="button" className="btn btn-primary align-start" onClick={onSetup}>Add courses in Setup</button>}
      </div>
    ) : null;
  }
  const ready = missing.filter((c) => trainerFor(c));
  function create() {
    if (!ready.length) return toast.show('Pick the trainer for each course.');
    const left = missing.length - ready.length;
    if (!window.confirm(`Create ${ready.length} ${ready.length === 1 ? 'course' : 'courses'} for ${cohort}?${left ? ` ${left} left out are not created.` : ''} Each shows in its trainer's classes.`)) return;
    try {
      for (const c of ready) {
        const t = trainers.find((x) => x.uid === trainerFor(c))!;
        createExamSheet(org.id, { cohort, courseId: c.courseId, courseName: c.name, teacherName: t.name.slice(0, 120), weights: settings.weights, ownerUid: t.uid, ownerName: t.name.slice(0, 120), semester: c.semester })
          .synced.catch((err) => toast.show(friendlyError(err)));
      }
      void logExam(org.id, { action: 'setup', cohort, sheetId: null, detail: `Created ${ready.length} courses from the course list`, byName: a.myName });
      toast.show(`${ready.length} courses created for ${cohort}.`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <section className="card stack">
      <h2>{first ? `Set up ${cohort}` : 'From the course list'}</h2>
      <p className="muted small">{first
        ? `${cohort} gets these ${missing.length} courses from the course list. Check each trainer, then create them.`
        : `${missing.length} ${missing.length === 1 ? 'course' : 'courses'} on the course list ${missing.length === 1 ? 'is' : 'are'} not in ${cohort} yet.`}</p>
      {departmentsOf(missing, courses).map((g) => (
        <div key={g.id ?? COMMON} className="stack">
          <strong className="small">{g.name}</strong>
          <ul className="exam-pick-list">
            {g.items.map((c) => (
              <li key={courseListKey(c)}>
                <span>{c.name}<span className="muted small"> · {semesterText(c.semester)}</span></span>
                <select value={trainerFor(c)} aria-label={`Trainer for ${c.name}`} onChange={(e) => setPicks({ ...picks, [courseListKey(c)]: e.target.value })}>
                  <option value="">{loading ? 'Loading…' : 'Leave out'}</option>
                  {trainersFor(trainers, c.courseId).map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!loading && trainers.length === 0 && <p className="small muted">No trainers yet. The pastor creates each trainer's account under Settings, Staff accounts, with the role Trainer.</p>}
      <button type="button" className="btn btn-primary align-start" disabled={!ready.length} onClick={create}>Create {ready.length} {ready.length === 1 ? 'course' : 'courses'}</button>
    </section>
  );
}

/* ---------- Departments: every programme of the cohort so far ---------- */

/**
 * Each department's standing so far (Andy, 2026-10-25): it works itself out as trainers key in each CAT,
 * using the papers marked so far, with the class average, the pass rate and a count by grade like the
 * summary on ADIA's graduation list.
 */
function Departments({ org, cohort, sheets, students, courses }: { org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[] }) {
  const { settings } = useExamSettings(org.id);
  const depts = courses.map((c) => ({ c, d: departmentSummary(c.id, sheets, students, settings) })).filter(({ d }) => d.rows.length > 0);
  const grades = settings.bands.map((b) => b.grade);
  if (!depts.length) return <p className="muted">No students in {cohort} yet.</p>;
  const csv = () => toCsv(['Department', 'Position', 'Name', 'Admission No', 'Courses marked', 'So far (%)', 'Grade'],
    depts.flatMap(({ c, d }) => [...d.rows].sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999)).map((r) => [c.name, r.position, r.name, r.admissionNo, `${r.marked} of ${r.courses}`, r.soFar, r.grade])));
  return (
    <section className="stack">
      <div className="dash-controls no-print">
        <p className="muted small">Works itself out as each CAT is keyed in, from the papers marked so far. It is provisional until every course is approved.</p>
        <span className="row-actions"><CsvButton name={`Departments-${cohort}.csv`.replace(/[^A-Za-z0-9.-]+/g, '-')} csv={csv} /><button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print</button></span>
      </div>
      <div className="card exam-table-wrap">
        <table className="table">
          <thead><tr><th>Department</th>{grades.map((g) => <th key={g} className="num">{g}</th>)}<th className="num">Students</th><th className="num">Class average</th><th className="num">Pass rate</th></tr></thead>
          <tbody>
            {depts.map(({ c, d }) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                {grades.map((g) => <td key={g} className="num">{d.byGrade[g] || '–'}</td>)}
                <td className="num">{d.rows.length}</td>
                <td className="num">{d.classAverage == null ? '–' : `${d.classAverage}%`}</td>
                <td className="num">{d.graded ? `${Math.round((d.passed / d.graded) * 100)}%` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {depts.map(({ c, d }) => (
        <section key={c.id} className="card stack">
          <div className="card-head"><h2>{c.name}</h2>{d.provisional && <span className="badge badge-warn">Provisional</span>}</div>
          <p className="muted small">{d.rows.length} students · {d.courses} {d.courses === 1 ? 'course' : 'courses'} · class average {d.classAverage == null ? '–' : `${d.classAverage}%`} · passed {d.graded ? `${d.passed} of ${d.graded}` : '–'}</p>
          <div className="exam-table-wrap">
            <table className="table exam-table">
              <thead><tr><th className="num">Pos</th><th>Name</th><th>Adm no</th><th className="num">Courses marked</th><th className="num">So far</th><th>Grade</th></tr></thead>
              <tbody>
                {[...d.rows].sort(byName).map((r) => (
                  <tr key={r.studentId}>
                    <td className="num">{r.position ?? '–'}</td>
                    <td>{r.name}</td>
                    <td>{r.admissionNo}</td>
                    <td className="num">{r.marked} of {r.courses}</td>
                    <td className="num"><strong>{r.soFar == null ? '–' : `${r.soFar}%`}</strong></td>
                    <td>{r.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </section>
  );
}

/* ---------- Results: Semester 1, Semester 2 and Final ---------- */

type Period = 'departments' | '1' | '2' | 'final' | 'none';

function Results({ org, cohort, label, sheets, students, courses, courseName, attendance, minAttendance }: {
  org: Organization; cohort: string; label: string; sheets: ExamSheetRow[]; students: ExamStudent[];
  courses: { id: string; name: string }[]; courseName: (id: string) => string; attendance: Record<string, number | null>; minAttendance: number | null;
}) {
  const [period, setPeriod] = useState<Period>('departments');
  const periods: [Period, string][] = [['departments', 'Department summary'], ['1', 'Semester 1'], ['2', 'Semester 2'], ['final', 'Final & transcripts']];
  if (sheets.some((s) => !s.semester)) periods.push(['none', 'No semester']);
  const inPeriod = sheets.filter((s) => (period === 'none' ? !s.semester : s.semester === Number(period)));
  return (
    <section className="stack">
      {/* One dropdown instead of tabs (Andy, 2026-10-25, 3A). */}
      <label className="field exam-show no-print"><span>Show</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{periods.map(([k, text]) => <option key={k} value={k}>{text}</option>)}</select>
      </label>
      {period === 'departments' ? <Departments org={org} cohort={cohort} sheets={sheets} students={students} courses={courses} />
        : period === 'final' ? <ResultsAndTranscripts org={org} cohort={cohort} label={label} sheets={sheets} students={students} courseName={courseName} />
          : <Reports org={org} cohort={cohort} label={label} period={periods.find((p) => p[0] === period)![1]} sheets={inPeriod} students={students} courses={courses} attendance={attendance} minAttendance={minAttendance} />}
    </section>
  );
}

/** Names A to Z on screen so a student is easy to find by eye; Pos still shows each one's place (Andy, 2026-10-26). */
const byName = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' });

function Reports({ org, cohort, label, period, sheets, students, courses, attendance, minAttendance }: {
  org: Organization; cohort: string; label: string; period: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[]; attendance: Record<string, number | null>; minAttendance: number | null;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { meta, exists } = useExamMeta(org.id, cohort);
  const [scope, setScope] = useState(courses[0]?.id ?? COMMON);
  const [busy, setBusy] = useState('');
  const courseId = scope === COMMON ? null : scope;
  const title = `${courseId == null ? 'Common courses' : courses.find((c) => c.id === courseId)?.name ?? 'Programme'} · ${period}`;
  const finder = useStudentFinder();
  const report = useMemo(() => buildExamReport(courseId, sheets, students, settings, { remarks: meta.remarks, attendance }), [courseId, sheets, students, settings, meta, attendance]);
  const graded = report.rows.filter((r) => r.average != null);
  const passed = graded.filter((r) => r.average! >= settings.passMark).length;
  const classAvg = graded.length ? Math.round((graded.reduce((t, r) => t + r.average!, 0) / graded.length) * 10) / 10 : null;
  const top = [...graded].sort((x, y) => y.average! - x.average!)[0];
  const pending = report.units.filter((u) => u.status !== 'approved').length;

  function remark(studentId: string, text: string, before: string) {
    if (text === before) return;
    try {
      saveExamRemark(org.id, cohort, exists, scopeKey(courseId), studentId, text.slice(0, 300)).catch((err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'remarks', cohort, sheetId: null, detail: `${report.rows.find((r) => r.studentId === studentId)?.name}: ${text || '(back to automatic)'}`, byName: a.myName });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  async function slips(rows = report.rows) {
    setBusy(rows.length === 1 ? rows[0]!.studentId : 'all');
    try {
      const file = await resultSlipsPdf({ cohort: label, reportTitle: title, report, rows, settings });
      if (rows.length === 1) await shareOrDownload(file, `ADIA result slip for ${rows[0]!.name}`); else downloadFile(file);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  const cellText = (c: (typeof report.rows)[number]['cells'][string] | undefined) => (c?.exempt ? 'EX' : c?.total ?? null);
  const csv = () => toCsv(
    ['Position', 'Name', 'Admission No', 'Programme', ...report.units.map((u) => `${u.courseName}${u.common ? ' (common)' : ''}`), 'Total', 'Average', 'Grade', 'Remarks', 'Attendance %', 'Provisional'],
    [...report.rows].sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999)).map((r) => [r.position, r.name, r.admissionNo, r.programme,
      ...report.units.map((u) => cellText(r.cells[u.sheetId])), r.total, r.average, r.grade, r.remarks, r.attendance, r.provisional ? 'Yes' : 'No']),
  );

  return (
    <section className="stack exam-report">
      <div className="dash-controls no-print">
        <label className="field"><span>Programme</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name} (with common courses)</option>)}
            <option value={COMMON}>Common courses, every student</option>
          </select>
        </label>
        <span className="row-actions">
          <CsvButton name={`Results-${cohort}-${title}.csv`.replace(/[^A-Za-z0-9.-]+/g, '-')} csv={csv} />
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn btn-primary" disabled={!report.rows.length || !report.units.length || !!busy} onClick={() => void slips()}>{busy === 'all' ? 'Making slips…' : 'All result slips (PDF)'}</button>
        </span>
      </div>
      <div className="print-only exam-print-head"><strong>{title}</strong></div>
      {pending > 0 && <p className="notice small no-print">{pending} of {report.units.length} {report.units.length === 1 ? 'course is' : 'courses are'} not approved yet, so these results are provisional. Slips print with "Provisional" until every course is approved.</p>}

      <KpiRow label="Results at a glance">
        <KpiCard label="Students" value={String(report.rows.length)} tone="gold" note={`${graded.length} with an average`} />
        <KpiCard label="Class average" value={classAvg == null ? '–' : `${classAvg}%`} note={classAvg == null ? '' : gradeFor(classAvg, settings).grade} />
        <KpiCard label="Passed" value={graded.length ? `${passed} of ${graded.length}` : '–'} tone={passed === graded.length ? 'ok' : 'warn'} note={`Pass mark ${settings.passMark}%`} />
        <KpiCard label="Top student" value={top ? `${top.average}%` : '–'} note={top?.name} />
      </KpiRow>
      {graded.length > 0 && (
        <div className="dash-grid no-print">
          <Panel title="Grades">
            <Donut label="Students by grade" rows={settings.bands.map((b) => ({ label: b.grade, value: graded.filter((r) => r.grade === b.grade).length }))} center={String(graded.length)} centerNote="graded" />
          </Panel>
          <Panel title="Average in each course">
            <ColumnChart label="Average mark in each course" rows={report.units.map((u) => {
              const t = report.rows.map((r) => r.cells[u.sheetId]?.total).filter((v): v is number => v != null);
              return { label: u.courseName, value: t.length ? Math.round(t.reduce((x, y) => x + y, 0) / t.length) : 0 };
            })} />
          </Panel>
          <Panel title="Pass rate">
            <Gauge value={passed} max={graded.length} label="Students at or above the pass mark" display={`${Math.round((passed / graded.length) * 100)}%`} bands={[0.6, 0.8]} />
          </Panel>
        </div>
      )}

      {report.units.length > 0 && report.rows.length > 0 && <StudentFinder finder={finder} names={report.rows.map((x) => x.name)} shown={report.rows.filter((x) => finder.match(x.name, x.admissionNo)).length} total={report.rows.length} />}
      {report.units.length === 0 ? <p className="muted">No {period} courses for this programme yet. Add them in Setup.</p> : (
        <div className="card exam-table-wrap">
          <table className="table exam-table">
            <thead>
              <tr>
                <th className="num">Pos</th><th>Name</th><th>Adm no</th>
                {report.units.map((u) => <th key={u.sheetId} className="num" title={`${u.courseName} · ${u.teacherName}`}><Link to={`${BASE}/sheet/${u.sheetId}`}>{u.courseName}</Link>{u.common && <span className="muted"> (common)</span>}{u.status !== 'approved' && <span className="muted"> · not approved</span>}</th>)}
                <th className="num">Total</th><th className="num">Avg</th><th>Grade</th><th>Remarks</th><th className="num">Attend. %</th><th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {[...report.rows].filter((x) => finder.match(x.name, x.admissionNo)).sort(byName).map((r) => (
                <tr key={r.studentId}>
                  <td className="num">{r.position ?? '–'}</td>
                  <td>{r.name}<div className="muted small">{courseId == null ? r.programme : ''}</div></td>
                  <td>{r.admissionNo}</td>
                  {report.units.map((u) => {
                    const c = r.cells[u.sheetId];
                    return <td key={u.sheetId} className="num">{c?.exempt ? <span className="muted" title="Exempt">EX</span> : c?.total != null ? <>{c.total}{c.resitUsed && <span className="muted" title="Resit, capped at the pass mark"> R</span>}</> : c?.partial != null ? <span className="muted" title="Not every paper is marked">({c.partial})</span> : '–'}</td>;
                  })}
                  <td className="num">{r.total ?? '–'}</td>
                  <td className="num"><strong>{r.average ?? '–'}</strong></td>
                  <td>{r.grade}{r.provisional && r.grade && <div className="muted small">provisional</div>}</td>
                  <td><input className="exam-remark" defaultValue={r.remarks} key={`${r.studentId}-${r.remarks}`} maxLength={300} aria-label={`Remarks for ${r.name}`} onBlur={(e) => remark(r.studentId, e.target.value === r.remarksAuto ? '' : e.target.value, r.remarksEdited ? r.remarks : '')} /></td>
                  <td className={`num${notEligible(r.attendance, minAttendance) ? ' up-bad' : ''}`}>{r.attendance ?? '–'}{notEligible(r.attendance, minAttendance) && <div className="small">Not eligible</div>}</td>
                  <td className="no-print"><button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => void slips([r])}>{busy === r.studentId ? '…' : 'Slip'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">A figure in brackets is a running total: not every paper is marked yet. EX is exempt (left out of the average); R is a resit, capped at the pass mark. Position uses the average; equal averages share a position. Attendance comes from the class registers on the Attendance page. Clear a remark to go back to the automatic one.</p>
        </div>
      )}
    </section>
  );
}

/* ---------- Setup ---------- */

type Section = 'courses' | 'graduation' | 'deadlines' | 'list' | 'cohort' | 'percentages' | 'grading' | 'upload' | 'log';

/** Setup: one dropdown, and only the part picked shows (Andy, 2026-10-25, 4A). */
function Setup({ org, cohort, cohorts, order, closed, info, sheets, students, courses, programmes, courseList, allStudents, today, canStart, section, onSection, onStarted }: {
  org: Organization; cohort: string; cohorts: string[]; order: CohortOrder; closed: boolean; info: Record<string, ExamCohort | undefined>; sheets: ExamSheetRow[]; students: ExamStudent[];
  courses: { id: string; name: string }[]; programmes: Programme[]; courseList: CourseList; allStudents: Parameters<typeof ResultsUpload>[0]['allStudents'];
  today: string; canStart: boolean; section: string; onSection: (section: Section) => void; onStarted: (cohort: string) => void;
}) {
  const { can } = useAuth();
  const sections: [Section, string][] = [
    ['courses', `Courses and trainers · ${cohort}`], ['graduation', `Graduation date · ${cohort}`], ['deadlines', `Deadlines and attendance · ${cohort}`],
    ['list', 'Course list and departments'], ...(canStart ? [['cohort', `Start a new cohort (next: ${nextCohortName(cohorts)})`] as [Section, string]] : []),
    ['percentages', 'Starting percentages'], ['grading', 'Grading and signatures'], ['upload', 'Upload past results'], ['log', 'Change log'],
  ];
  const pick: Section = sections.some(([k]) => k === section) ? (section as Section) : 'courses';
  return (
    <section className="stack">
      <label className="field exam-show no-print"><span>What do you want to do?</span>
        <select value={pick} onChange={(e) => onSection(e.target.value as Section)}>{sections.map(([k, text]) => <option key={k} value={k}>{text}</option>)}</select>
      </label>
      {pick === 'courses' && <>
        {!closed && <NewCohortCourses org={org} cohort={cohort} sheets={sheets} courses={courses} courseList={courseList} />}
        <CourseSetup org={org} cohort={cohort} closed={closed} sheets={sheets} students={students} courses={courses} courseList={courseList} />
      </>}
      {pick === 'graduation' && (closed
        ? <p className="notice">{cohort} has graduated and is closed. Reopen it at the top of the page to change its date.</p>
        : <Graduation org={org} cohort={cohort} info={info[cohort]} sheets={sheets} today={today} />)}
      {pick === 'deadlines' && <Deadlines org={org} cohort={cohort} info={info[cohort]} closed={closed} />}
      {pick === 'list' && <CourseListEditor org={org} courses={courses} courseList={courseList} canAddDepartment={can('settings.manage') || can('school.manage')} current={order.current} />}
      {pick === 'cohort' && <NewCohort org={org} cohorts={cohorts} programmes={programmes} today={today} onStarted={onStarted} />}
      {pick === 'percentages' && <Weighting org={org} />}
      {pick === 'grading' && <Grading org={org} />}
      {pick === 'upload' && <ResultsUpload org={org} allStudents={allStudents} />}
      {pick === 'log' && <ChangeLog org={org} cohort={cohort} />}
    </section>
  );
}

/**
 * When each paper's marks are due for the cohort (Andy, 2026-10-25, 6A), and the attendance a student
 * needs to sit the Final (7A).
 */
function Deadlines({ org, cohort, info, closed }: { org: Organization; cohort: string; info: ExamCohort | undefined; closed: boolean }) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings, exists } = useExamSettings(org.id);
  const [min, setMin] = useState<string | null>(null);
  const due = info?.deadlines ?? {};
  function setDue(c: ExamComponent, v: string) {
    if ((due[c] ?? '') === v || (v && v.length !== 10)) return;
    const next: ExamDeadlines = { ...due };
    if (v) next[c] = v; else delete next[c];
    saveExamCohort(org.id, cohort, !!info, { deadlines: next }).catch((err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'deadline', cohort, sheetId: null, detail: `${paperName(c)} due ${v ? dayMonthYear(v) : '(none)'}`, byName: a.myName });
  }
  function saveMin() {
    const v = min == null || min.trim() === '' ? null : Number(min);
    if (v != null && !(v >= 0 && v <= 100)) return toast.show('Type a percentage from 0 to 100, or leave it empty for no rule.');
    saveExamSettings(org.id, exists, { ...settings, minAttendance: v }).then(() => toast.show(v ? `Students below ${v}% attendance are flagged.` : 'No attendance rule.'), (err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'attendance rule', cohort: 'All cohorts', sheetId: null, detail: v ? `Minimum attendance for the Final: ${v}%` : 'Attendance rule removed', byName: a.myName });
    setMin(null);
  }
  return (
    <>
      <section className="card stack">
        <h2>Deadlines · {cohort}</h2>
        <p className="muted small">When each paper's marks are due. A course that has not sent a paper by its date shows as late, and Remind says how late.</p>
        <div className="form-grid">
          {EXAM_COMPONENTS.map((c) => (
            <label key={c} className="field"><span>{paperName(c)}</span><input type="date" disabled={closed} defaultValue={due[c] ?? ''} key={`${c}-${due[c] ?? ''}`} onChange={(e) => setDue(c, e.target.value)} /></label>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>Attendance for the Final</h2>
        <p className="muted small">Students below this attendance are flagged "Not eligible" on marks sheets and results. Leave it empty for no rule. It applies to every cohort.</p>
        <div className="row-actions">
          <label className="field"><span>Minimum attendance (%)</span><input inputMode="decimal" value={min ?? String(settings.minAttendance ?? '')} placeholder="e.g. 75" onChange={(e) => setMin(e.target.value)} /></label>
          <button type="button" className="btn btn-primary align-end" disabled={min == null} onClick={saveMin}>Save</button>
        </div>
      </section>
    </>
  );
}

/** The class's graduation date (Andy, 2026-10-25, 2A), and closing the cohort once it has graduated (5A). */
function Graduation({ org, cohort, info, sheets, today }: { org: Organization; cohort: string; info: ExamCohort | undefined; sheets: ExamSheetRow[]; today: string }) {
  const a = useExamAccess();
  const toast = useToast();
  const date = info?.graduationDate ?? '';
  const log = (detail: string) => void logExam(org.id, { action: 'graduation', cohort, sheetId: null, detail, byName: a.myName });
  function setDate(v: string) {
    if (v === date || (v && v.length !== 10)) return;
    saveExamCohort(org.id, cohort, !!info, { graduationDate: v || null }).catch((err) => toast.show(friendlyError(err)));
    log(v ? `Graduation date set to ${dayMonthYear(v)}` : 'Graduation date cleared');
  }
  function close() {
    if (!date) return toast.show('Set the graduation date first.');
    const open = sheets.filter((x) => x.status !== 'approved').length;
    if (!window.confirm(`Close ${cohort}, ${classText(date, today)}?\n\nIts marks become read only. Only the principal, an admin, Andy or Doreen can reopen it, with their password.${open ? `\n\n${open} ${open === 1 ? 'course is' : 'courses are'} not approved yet.` : ''}`)) return;
    saveExamCohort(org.id, cohort, !!info, { closed: true, closedByName: a.myName.slice(0, 120), closedAt: closedNow() })
      .then(() => toast.show(`${cohort} is closed. It now shows under Past cohorts.`), (err) => toast.show(friendlyError(err)));
    log(`${cohort} closed (${classText(date, today)})`);
  }
  if (info?.closed) return null;
  return (
    <section className="card stack">
      <h2>Graduation · {cohort}</h2>
      <div className="row-actions">
        <label className="field"><span>Graduation date</span><input type="date" defaultValue={date} key={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="btn btn-quiet align-end" disabled={!date} onClick={close}>Close {cohort} after graduation</button>
      </div>
      <p className="muted small">The date names the class, such as "{classOf(date || today)}", on results, transcripts and certificates. Close the cohort after graduation so nobody can change its marks.</p>
    </section>
  );
}

function CourseSetup({ org, cohort, closed, sheets, students, courses, courseList }: {
  org: Organization; cohort: string; closed: boolean; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[]; courseList: CourseList;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { trainers, loading, problem } = useExamTrainers(org.id);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ scope: courses[0]?.id ?? COMMON, courseName: '', semester: '1', trainer: '', onList: true });
  const name = (id: string | null) => programmeOf(id, (x) => courses.find((c) => c.id === x)?.name ?? '');

  const log = (detail: string, sheetId: string | null = null) => void logExam(org.id, { action: 'setup', cohort, sheetId, detail, byName: a.myName });
  function add() {
    const t = trainers.find((x) => x.uid === f.trainer);
    if (!f.courseName.trim()) return toast.show('Type the course name.');
    if (!t) return toast.show('Pick the trainer who marks this course.');
    const item: CourseListItem = { name: f.courseName.trim().slice(0, 120), courseId: f.scope === COMMON ? null : f.scope, semester: f.semester === '2' ? 2 : 1 };
    try {
      const { synced } = createExamSheet(org.id, {
        cohort, courseId: item.courseId, courseName: item.name, teacherName: t.name.slice(0, 120),
        weights: settings.weights, ownerUid: t.uid, ownerName: t.name.slice(0, 120), semester: item.semester,
      });
      synced.catch((err) => toast.show(friendlyError(err)));
      // A new course goes on the course list too, so the next cohort gets it (Andy, 2026-10-25).
      if (f.onList) {
        const next = withCourse(courseList.list, item);
        if (next.length !== courseList.list.length || !courseList.saved) courseList.save(next).catch((err) => toast.show(friendlyError(err)));
      }
      log(`Added ${item.name} (${name(item.courseId)}, Semester ${f.semester}) for ${t.name}`);
      toast.show(`${item.name} added. It now shows in ${t.name}'s classes.`);
      setF({ ...f, courseName: '' });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function change(sh: ExamSheetRow, changes: { courseName?: string; semester?: 1 | 2; trainer?: ExamTrainer }, detail: string) {
    const t = changes.trainer;
    saveExamSheetDetails(org.id, sh.id, {
      ...(changes.courseName != null ? { courseName: changes.courseName.slice(0, 120) } : {}),
      ...(changes.semester ? { semester: changes.semester } : {}),
      ...(t ? { ownerUid: t.uid, ownerName: t.name.slice(0, 120), teacherName: t.name.slice(0, 120) } : {}),
    }).catch((err) => toast.show(friendlyError(err)));
    log(`${sh.courseName}: ${detail}`, sh.id);
  }
  function remove(sh: ExamSheetRow) {
    const hasMarks = Object.keys(sh.marks ?? {}).length > 0;
    if (!window.confirm(`Remove ${sh.courseName}${hasMarks ? ' and the marks already keyed in' : ''}? It can be restored from the bin within 30 days.`)) return;
    deleteExamSheet(org.id, sh.id).catch((err) => toast.show(friendlyError(err)));
    log(`Removed ${sh.courseName} (${sh.teacherName})`, sh.id);
  }
  const trainerOptions = (courseId: string | null, sh?: ExamSheetRow) => {
    const list = trainersFor(trainers, courseId);
    return (
      <>
        {sh && !list.some((t) => t.uid === sh.ownerUid) && <option value={sh.ownerUid}>{sh.teacherName || sh.ownerName}</option>}
        {list.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
      </>
    );
  };

  return (
    <section className="card stack">
      <div className="card-head"><h2>Courses and trainers · {cohort}</h2>{!adding && !closed && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add a course</button>}</div>
      {!closed && <p className="muted small">Each course shows in its trainer's classes. Trainers key in marks; they cannot add, rename or move courses.</p>}
      {problem && <p className="up-bad small">The trainer list did not load: {problem}</p>}
      {adding && !closed && (
        <div className="stack exam-add">
          <div className="form-grid">
            <label className="field"><span>Department</span>
              <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={COMMON}>Common courses</option>
              </select>
            </label>
            <label className="field"><span>Course name</span><input value={f.courseName} maxLength={120} placeholder="e.g. Computer Networking" onChange={(e) => setF({ ...f, courseName: e.target.value })} /></label>
            <label className="field"><span>Semester</span>
              <select value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })}><option value="1">Semester 1</option><option value="2">Semester 2</option></select>
            </label>
            <label className="field"><span>Trainer</span>
              <select value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })}>
                <option value="">{loading ? 'Loading…' : 'Pick the trainer'}</option>
                {trainerOptions(f.scope === COMMON ? null : f.scope)}
              </select>
            </label>
          </div>
          <label className="check"><input type="checkbox" checked={f.onList} onChange={(e) => setF({ ...f, onList: e.target.checked })} /> Also put it on the course list for future cohorts</label>
          {!loading && trainers.length === 0 && <p className="small muted">No trainers yet. The pastor creates each trainer's account under Settings, Staff accounts, with the role Trainer.</p>}
          {!loading && f.scope === COMMON && trainersFor(trainers, null).length === 0 && <p className="small muted">No lecturer has Common courses ticked yet. Tick it on their account under Settings, Staff accounts.</p>}
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={add}>Add course</button><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Done</button></div>
        </div>
      )}
      {sheets.length === 0 ? <p className="muted">No courses for {cohort} yet.</p> : (
        <div className="exam-table-wrap">
          <table className="table exam-setup-table">
            <thead><tr><th>Course</th><th>Semester</th><th>Trainer</th><th>Status</th><th /></tr></thead>
            <tbody>
              {sortCourseList(sheets.map((sh) => ({ sh, name: sh.courseName, courseId: sh.courseId, semester: sh.semester ?? null }))).map(({ sh }) => (
                <tr key={sh.id}>
                  <td>
                    <input className="exam-remark" defaultValue={sh.courseName} key={`${sh.id}-${sh.courseName}`} maxLength={120} aria-label="Course name" disabled={closed}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sh.courseName) change(sh, { courseName: v }, `renamed to ${v}`); }} />
                    <div className="muted small">{name(sh.courseId)} · {rosterFor(students, sh.courseId).length} students</div>
                  </td>
                  <td>
                    <select value={String(sh.semester ?? '')} aria-label="Semester" disabled={closed} onChange={(e) => change(sh, { semester: e.target.value === '2' ? 2 : 1 }, `moved to Semester ${e.target.value}`)}>
                      {!sh.semester && <option value="">None</option>}<option value="1">Semester 1</option><option value="2">Semester 2</option>
                    </select>
                  </td>
                  <td>
                    <select value={sh.ownerUid} aria-label="Trainer" disabled={closed} onChange={(e) => { const t = trainers.find((x) => x.uid === e.target.value); if (t) change(sh, { trainer: t }, `given to ${t.name} (was ${sh.teacherName})`); }}>
                      {trainerOptions(sh.courseId, sh)}
                    </select>
                  </td>
                  <td><StatusPill status={sh.status} /></td>
                  <td>{!closed && <button type="button" className="btn btn-quiet btn-small" onClick={() => remove(sh)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The course list (Andy, 2026-10-25, 3A and 6A): each department's courses for every new cohort, with
 * room to add courses and departments as ADIA grows.
 */
function CourseListEditor({ org, courses, courseList, canAddDepartment, current }: {
  org: Organization; courses: { id: string; name: string }[]; courseList: CourseList; canAddDepartment: boolean; current: CohortOrder['current'];
}) {
  const a = useExamAccess();
  const toast = useToast();
  const [f, setF] = useState({ scope: courses[0]?.id ?? COMMON, name: '', semester: '1' });
  const [dept, setDept] = useState('');
  const log = (detail: string) => void logExam(org.id, { action: 'course list', cohort: 'All cohorts', sheetId: null, detail, byName: a.myName });
  function save(next: CourseListItem[], detail: string) {
    courseList.save(next).then(() => toast.show('Course list saved.'), (err) => toast.show(friendlyError(err)));
    log(detail);
  }
  function add() {
    const item: CourseListItem = { name: f.name.trim().slice(0, 120), courseId: f.scope === COMMON ? null : f.scope, semester: f.semester === '2' ? 2 : 1 };
    if (!item.name) return toast.show('Type the course name.');
    const next = withCourse(courseList.list, item);
    if (next.length === courseList.list.length) return toast.show(`${item.name} is already on the list.`);
    save(next, `Added ${item.name} to the course list`);
    setF({ ...f, name: '' });
  }
  function remove(c: CourseListItem) {
    if (!window.confirm(`Take ${c.name} off the course list? Cohorts that already have it keep it.`)) return;
    save(courseList.list.filter((x) => courseListKey(x) !== courseListKey(c)), `Took ${c.name} off the course list`);
  }
  function addDepartment() {
    const n = dept.trim().replace(/\s+/g, ' ');
    if (n.length < 2) return toast.show('Type the department name.');
    if (courses.some((c) => c.name.toLowerCase() === n.toLowerCase())) return toast.show(`${n} is already a department.`);
    try {
      const { id, synced } = saveCourse(org.id, null, { name: n.slice(0, 120), levels: [], units: [], timetable: [], active: true });
      synced.catch((err) => toast.show(friendlyError(err)));
      // The new department joins every current cohort, so its students can be enrolled straight away.
      for (const c of current.filter((x) => x.startDate)) {
        Promise.resolve(saveIntake(org.id, null, { courseId: id, name: c.name, startDate: c.startDate!, capacity: null, active: true })).catch((err) => toast.show(friendlyError(err)));
      }
      log(`Added the department ${n}`);
      toast.show(`${n} added. Now add its courses here.`);
      setDept('');
      setF({ ...f, scope: id });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <section className="card stack">
      <p className="muted small">{courseList.saved ? 'A new cohort gets these courses.' : 'Taken from the courses your cohorts already have. A new cohort gets these courses.'} Each course starts with the trainer who marked it last.</p>
      {departmentsOf(courseList.list, courses).map((g) => (
        <div key={g.id ?? COMMON} className="stack">
          <strong className="small">{g.name}</strong>
          <ul className="exam-pick-list">
            {g.items.map((c) => <li key={courseListKey(c)}><span>{c.name}<span className="muted small"> · {semesterText(c.semester)}</span></span><button type="button" className="btn btn-quiet btn-small" onClick={() => remove(c)}>Remove</button></li>)}
          </ul>
        </div>
      ))}
      <div className="form-grid exam-add">
        <label className="field"><span>Department</span>
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={COMMON}>Common courses</option>
          </select>
        </label>
        <label className="field"><span>Course name</span><input value={f.name} maxLength={120} placeholder="e.g. Web Design" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Semester</span>
          <select value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })}><option value="1">Semester 1</option><option value="2">Semester 2</option></select>
        </label>
      </div>
      <button type="button" className="btn btn-primary align-start" onClick={add}>Add to the course list</button>
      {canAddDepartment && (
        <div className="row-actions">
          <label className="field"><span>New department</span><input value={dept} maxLength={120} placeholder="e.g. Beauty Therapy" onChange={(e) => setDept(e.target.value)} /></label>
          <button type="button" className="btn btn-quiet align-end" onClick={addDepartment}>Add department</button>
        </div>
      )}
    </section>
  );
}

/** A new cohort is one intake for each programme, all starting the same day (Andy, 2026-10-25). */
function NewCohort({ org, cohorts, programmes, today, onStarted }: { org: Organization; cohorts: string[]; programmes: Programme[]; today: string; onStarted: (cohort: string) => void }) {
  const a = useExamAccess();
  const toast = useToast();
  const [name, setName] = useState(nextCohortName(cohorts));
  const [start, setStart] = useState(today);
  const live = programmes.filter((p) => p.active !== false);
  function create() {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!n) return toast.show('Type the cohort name, such as Cohort 5.');
    if (cohorts.some((c) => c.toLowerCase() === n.toLowerCase())) return toast.show(`${n} already exists.`);
    if (!start) return toast.show('Pick the start date.');
    if (!live.length) return toast.show('Add a department first.');
    if (!window.confirm(`Start ${n} on ${dayMonthYear(start)} for ${live.length} ${live.length === 1 ? 'department' : 'departments'}?`)) return;
    try {
      for (const p of live) Promise.resolve(saveIntake(org.id, null, { courseId: p.id, name: n, startDate: start, capacity: null, active: true })).catch((err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'setup', cohort: n, sheetId: null, detail: `${n} started on ${dayMonthYear(start)}`, byName: a.myName });
      toast.show(`${n} started. Enrol its students under Students, then set up its courses here.`);
      onStarted(n);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <section className="card stack">
      <p className="muted small">The cohort starts in every department ({live.map((p) => p.name).join(', ') || 'none yet'}).</p>
      <div className="row-actions">
        <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Start date</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <button type="button" className="btn btn-primary align-end" onClick={create}>Start {name.trim() || 'cohort'}</button>
      </div>
    </section>
  );
}

function Weighting({ org }: { org: Organization }) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings, exists } = useExamSettings(org.id);
  const [w, setW] = useState<ExamWeights | null>(null);
  const v = w ?? settings.weights;
  const sum = EXAM_COMPONENTS.reduce((t, c) => t + (v[c].wt || 0), 0);
  const put = (c: ExamComponent, k: 'max' | 'wt', val: string) => setW({ ...v, [c]: { ...v[c], [k]: Number(val) } });
  function save() {
    const problem = weightsProblem(v);
    if (problem) return toast.show(problem);
    saveExamSettings(org.id, exists, { ...settings, weights: v }).then(() => toast.show('Saved. New courses start with these percentages.'), (err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'weighting', cohort: 'All cohorts', sheetId: null, detail: EXAM_COMPONENTS.map((c) => `${EXAM_COMPONENT_LABELS[c]} ${v[c].wt}% of ${v[c].max}`).join(', '), byName: a.myName });
    setW(null);
  }
  return (
    <section className="card stack">
      <h2>Starting percentages</h2>
      <p className="muted small">Where every new course starts. Each trainer can then change their own course's percentages until they send its first paper. Set a paper to 0% if it is not used.</p>
      <table className="table exam-weights">
        <thead><tr><th>Paper</th><th className="num">Marked out of</th><th className="num">Worth (%)</th></tr></thead>
        <tbody>
          {EXAM_COMPONENTS.map((c) => (
            <tr key={c}>
              <td>{EXAM_COMPONENT_LABELS[c]}</td>
              <td className="num"><input className="exam-att" inputMode="decimal" value={v[c].max} onChange={(e) => put(c, 'max', e.target.value)} aria-label={`${EXAM_COMPONENT_LABELS[c]} marked out of`} /></td>
              <td className="num"><input className="exam-att" inputMode="decimal" value={v[c].wt} onChange={(e) => put(c, 'wt', e.target.value)} aria-label={`${EXAM_COMPONENT_LABELS[c]} worth`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`small ${sum === 100 ? 'muted' : 'up-bad'}`}>The percentages add up to {sum}%.{sum !== 100 && ' They usually add up to 100.'}</p>
      <div className="row-actions"><button type="button" className="btn btn-primary" disabled={!w} onClick={save}>Save</button>{w && <button type="button" className="btn btn-quiet" onClick={() => setW(null)}>Cancel</button>}</div>
    </section>
  );
}

function ChangeLog({ org, cohort }: { org: Organization; cohort: string }) {
  const rows = useExamLog(org.id, cohort);
  const all = useExamLog(org.id, 'All cohorts');
  const list = useMemo(() => [...rows, ...all].sort((x, y) => (y.at?.toMillis() ?? Date.now()) - (x.at?.toMillis() ?? Date.now())), [rows, all]);
  const when = (r: (typeof rows)[number]) => r.at?.toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) ?? 'just now';
  return (
    <section className="card stack">
      <h2>Change log · {cohort}</h2>
      <p className="muted small">Every course set up, approval, send-back, mark the principal changed, upload and remark, with who did it.</p>
      {list.length === 0 ? <p className="muted">No changes yet for {cohort}.</p> : (
        <div className="exam-table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id}><td className="small">{when(r)}</td><td>{r.byName}</td><td>{r.action}</td><td className="small">{r.detail}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Grading({ org }: { org: Organization }) {
  const toast = useToast();
  const { settings, exists } = useExamSettings(org.id);
  const [f, setF] = useState<ExamSettings | null>(null);
  const v = f ?? settings;
  const band = (i: number, k: keyof GradeBand, val: string) => setF({ ...v, bands: v.bands.map((b, j) => (j === i ? { ...b, [k]: k === 'min' ? Number(val) : val } : b)) });
  function save() {
    if (!(v.passMark >= 0 && v.passMark <= 100)) return toast.show('The pass mark is a percentage from 0 to 100.');
    if (v.bands.some((b) => !b.grade.trim() || !(b.min >= 0 && b.min <= 100))) return toast.show('Every grade needs a name and a minimum from 0 to 100.');
    const clean: ExamSettings = { ...v, bands: [...v.bands].sort((x, y) => y.min - x.min).map((b) => ({ min: b.min, grade: b.grade.trim().slice(0, 40), remark: b.remark.trim().slice(0, 120) })) };
    saveExamSettings(org.id, exists, clean).then(() => toast.show('Grading saved.'), (err) => toast.show(friendlyError(err)));
    setF(null);
  }
  return (
    <section className="card stack">
      <h2>Grading and signatures</h2>
      <label className="field"><span>Pass mark (%)</span><input inputMode="decimal" value={v.passMark} onChange={(e) => setF({ ...v, passMark: Number(e.target.value) })} /></label>
      <p className="muted small">A resit mark replaces a failed course, but never above the pass mark.</p>
      <table className="table">
        <thead><tr><th>Grade</th><th className="num">From (%)</th><th>Remark</th><th /></tr></thead>
        <tbody>
          {v.bands.map((b, i) => (
            <tr key={i}>
              <td><input value={b.grade} onChange={(e) => band(i, 'grade', e.target.value)} aria-label="Grade" /></td>
              <td className="num"><input className="exam-att" inputMode="decimal" value={b.min} onChange={(e) => band(i, 'min', e.target.value)} aria-label="From" /></td>
              <td><input value={b.remark} onChange={(e) => band(i, 'remark', e.target.value)} aria-label="Remark" /></td>
              <td>{v.bands.length > 1 && <button type="button" className="btn btn-quiet btn-small" onClick={() => setF({ ...v, bands: v.bands.filter((_, j) => j !== i) })}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Grades now: {bandsText(v)}. A minimum of 59.01 means "above 59".</p>
      <div className="row-actions">
        <button type="button" className="btn btn-quiet" onClick={() => setF({ ...v, bands: [...v.bands, { min: 0, grade: '', remark: '' }] })}>Add a grade</button>
        {bandsText(v) !== bandsText({ bands: ADIA_BANDS }) && <button type="button" className="btn btn-quiet" onClick={() => setF({ ...v, passMark: 39, bands: ADIA_BANDS })}>Use ADIA's bands (79 / above 59 / 39)</button>}
      </div>
      <div className="form-grid">
        <label className="field"><span>Principal's name</span><input value={v.principalName} onChange={(e) => setF({ ...v, principalName: e.target.value })} /></label>
        <label className="field"><span>Title</span><input value={v.principalTitle} onChange={(e) => setF({ ...v, principalTitle: e.target.value })} /></label>
        <label className="field"><span>Director's name</span><input value={v.directorName} onChange={(e) => setF({ ...v, directorName: e.target.value })} /></label>
        <label className="field"><span>Title</span><input value={v.directorTitle} onChange={(e) => setF({ ...v, directorTitle: e.target.value })} /></label>
      </div>
      <div className="row-actions"><button type="button" className="btn btn-primary" disabled={!f} onClick={save}>Save grading</button>{f && <button type="button" className="btn btn-quiet" onClick={() => setF(null)}>Cancel</button>}</div>
    </section>
  );
}

/* ---------- the marks sheet ---------- */

const paperName = (c: ExamComponent) => (c === 'final' ? 'Final exam' : EXAM_COMPONENT_LABELS[c]);

function SheetEditor({ org }: { org: Organization }) {
  const { sheetId = '' } = useParams();
  const a = useExamAccess();
  const toast = useToast();
  const navigate = useNavigate();
  const { s, studentsOf, attendance } = useCohorts(org);
  const { sheet, loading } = useExamSheet(org.id, sheetId);
  const [printing, setPrinting] = useState(false);
  const { settings } = useExamSettings(org.id);
  const { byName } = useExamCohorts(org.id);
  const act = useSheetActions(org);
  const finder = useStudentFinder();

  if (!a.canMark) return <div className="page narrow"><h1>Marks sheet</h1><p>Exam Records are for trainers and the principal.</p></div>;
  if (!sheet) return <div className="page narrow"><h1>Marks sheet</h1><p className="muted">{loading ? 'Loading…' : 'This class was not found.'}</p><Link to={BASE}>Back to Exam Records</Link></div>;

  const roster = rosterFor(studentsOf(sheet.cohort), sheet.courseId);
  const isOwner = sheet.ownerUid === a.uid;
  // A graduated cohort is closed: nobody changes its marks until it is reopened (Andy, 2026-10-25).
  const closed = byName[sheet.cohort]?.closed === true;
  const editable = !closed && (a.canManage || (isOwner && sheet.status === 'draft'));
  const loggedEdit = a.canManage && (sheet.status !== 'draft' || !isOwner);
  const w = sheet.weights;
  const used = usedComponents(w);
  // A paper the trainer sent is locked for them; the principal can still change it (logged) or unlock it.
  const lockedForMe = (c: ExamComponent) => !a.canManage && isLocked(sheet, c);
  const totals = new Map(roster.map((st) => [st.id, unitTotal(w, sheet.marks?.[st.id], settings.passMark)]));
  // The resit column shows once a student has failed the course (or already has a resit).
  const failed = (id: string) => { const m = sheet.marks?.[id]; const u = unitTotal(w, m ? { ...m, resit: null } : m); return u.total != null && u.total < settings.passMark; };
  const showResit = roster.some((st) => failed(st.id) || typeof sheet.marks?.[st.id]?.resit === 'number');
  const done = roster.filter((st) => totals.get(st.id)!.complete).length;
  const pctDone = sheetProgress(sheet, roster.map((x) => x.id));
  const back = a.canManage ? `${BASE}?cohort=${encodeURIComponent(sheet.cohort)}` : BASE;

  // Below the attendance rule: flagged, not blocked (Andy, 2026-10-25, 7A).
  const flagged = (id: string) => notEligible(attendance[id], settings.minAttendance);
  const flaggedCount = roster.filter((st) => flagged(st.id)).length;
  async function print() {
    setPrinting(true);
    try {
      const grad = byName[sheet!.cohort]?.graduationDate;
      const file = await marksSheetPdf({
        courseName: sheet!.courseName, programme: programmeOf(sheet!.courseId, s.courseName), cohort: grad ? `${sheet!.cohort} · ${classOf(grad)}` : sheet!.cohort,
        semester: semesterText(sheet!.semester), teacherName: sheet!.teacherName, status: sheet!.status === 'approved' ? 'Approved' : sheet!.status === 'submitted' ? 'Waiting for approval' : 'Marking',
        weights: w, settings, rows: roster.map((st) => ({ admissionNo: st.admissionNo, name: st.name, marks: sheet!.marks?.[st.id], flag: flagged(st.id) ? 'not eligible' : undefined })),
      });
      await shareOrDownload(file, `${sheet!.courseName} marks sheet`);
    } catch (err) { toast.show(friendlyError(err)); } finally { setPrinting(false); }
  }
  function log(action: string, detail: string) {
    if (loggedEdit) void logExam(org.id, { action, cohort: sheet!.cohort, sheetId: sheet!.id, detail: `${sheet!.courseName}: ${detail}`, byName: a.myName });
  }
  /** Saves what was typed; a mark that can't be used goes back to what was there. */
  function mark(st: ExamStudent, c: ExamComponent, box: HTMLInputElement) {
    const before = sheet!.marks?.[st.id]?.[c] ?? null;
    const { value, problem } = parseMark(box.value);
    const bad = problem ?? markProblem(value, w[c].max);
    if (bad) { box.value = markText(before); return toast.show(`${st.name}, ${EXAM_COMPONENT_LABELS[c]}: ${bad}`); }
    if (value === before) return;
    try {
      saveExamMark(org.id, sheet!.id, st.id, c, value).catch((err) => toast.show(friendlyError(err)));
      log('mark', `${st.name} ${EXAM_COMPONENT_LABELS[c]} ${before ?? 'blank'} → ${value ?? 'blank'}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function resit(st: ExamStudent, box: HTMLInputElement) {
    const before = sheet!.marks?.[st.id]?.resit ?? null;
    const { value, problem } = parseMark(box.value);
    const bad = problem || (value != null && typeof value !== 'number') ? 'type the resit mark out of 100.' : markProblem(value, 100);
    if (bad) { box.value = markText(before); return toast.show(`${st.name}, resit: ${bad}`); }
    if (value === before) return;
    try {
      saveExamMark(org.id, sheet!.id, st.id, 'resit', value).catch((err) => toast.show(friendlyError(err)));
      log('resit', `${st.name} resit ${before ?? 'blank'} → ${value ?? 'blank'}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  const notice = closed ? `${sheet.cohort} has graduated and is closed, so these marks are read only.` : sheet.status === 'approved'
    ? `Approved${sheet.approvedByName ? ` by ${sheet.approvedByName}` : ''}. These results are final.${a.canManage ? ' Changes you make are written to the change log.' : ''}`
    : sheet.status === 'submitted'
      ? (a.canManage ? 'The trainer sent the Final exam. Check the marks, then approve or send back.' : 'Every paper is sent and locked. Waiting for the principal to approve it.')
      : sheet.returnNote ? `The principal sent this back: ${sheet.returnNote}` : null;

  return (
    <div className="page narrow exams">
      <p className="no-print"><Link to={back}>← {a.canManage ? 'Exam Records' : 'My classes'}</Link></p>
      <div className="page-head">
        <h1>{sheet.courseName || 'Untitled course'}</h1>
        <span className="row-actions"><StatusPill status={sheet.status} /><button type="button" className="btn btn-quiet btn-small no-print" disabled={printing || !roster.length} onClick={() => void print()}>{printing ? 'Preparing…' : 'Print marks sheet'}</button><CleanupButton orgId={org.id} kind="examSheet" id={sheet.id} back={BASE} /></span>
      </div>
      <p className="lead">{programmeOf(sheet.courseId, s.courseName)} · {sheet.cohort} · {semesterText(sheet.semester)} · {sheet.teacherName}</p>
      {notice && <div className={`notice small${sheet.status === 'draft' && !closed ? ' up-bad' : ''}`}>{notice}</div>}
      {loggedEdit && !closed && sheet.status === 'draft' && <div className="notice small">You are changing a trainer's marks. Every change is written to the change log.</div>}

      <Percentages org={org} sheet={sheet} canEdit={!closed && (a.canManage || (isOwner && sheet.status === 'draft' && !used.some((c) => isLocked(sheet, c)) && !isLocked(sheet, 'final')))} onLog={log} />

      <section className="card stack">
        <div className="card-head"><h2>Marks</h2><span className="muted small">{done} of {roster.length} complete · {pctDone}% entered</span></div>
        <span className="exam-bar"><span style={{ width: `${pctDone}%` }} className={pctDone >= 100 ? 'done' : ''} /></span>
        <p className="small muted">Type a mark, <strong>ABS</strong> for absent (counts as 0) or <strong>EX</strong> for exempt. A sent paper is locked.</p>
        {flaggedCount > 0 && <p className="small up-bad">{flaggedCount} {flaggedCount === 1 ? 'student is' : 'students are'} below {settings.minAttendance}% attendance and not eligible for the Final.</p>}
        {roster.length === 0 ? <p className="muted">No enrolled students in {sheet.cohort}{sheet.courseId ? ` for ${s.courseName(sheet.courseId)}` : ''}. Students come from the Students list, by intake.</p> : (
          <>
          <StudentFinder finder={finder} names={roster.map((st) => st.name)} shown={roster.filter((st) => finder.match(st.name, st.admissionNo)).length} total={roster.length} />
          <div className="exam-table-wrap">
            <table className="table exam-marks">
              <thead><tr><th>Student</th>{used.map((c) => <th key={c} className="num">{EXAM_COMPONENT_LABELS[c]}<div className="muted small">/{w[c].max}{isLocked(sheet, c) ? ' · sent' : ''}</div></th>)}<th className="num">Total</th><th>Grade</th>{showResit && <th className="num">Resit<div className="muted small">/100</div></th>}</tr></thead>
              <tbody>
                {roster.filter((st) => finder.match(st.name, st.admissionNo)).map((st) => {
                  const m = sheet.marks?.[st.id];
                  const u = totals.get(st.id)!;
                  return (
                    <tr key={st.id}>
                      <td>{st.name}<div className="muted small">{st.admissionNo}{sheet.courseId == null ? ` · ${st.courseName}` : ''}</div>{flagged(st.id) && <span className="badge badge-warn">Not eligible · {attendance[st.id]}%</span>}</td>
                      {used.map((c) => (
                        <td key={c} className="num">
                          <input className="exam-mark" disabled={!editable || lockedForMe(c)} defaultValue={markText(m?.[c])} key={`${st.id}-${c}-${markText(m?.[c])}`} autoCapitalize="characters"
                            aria-label={`${st.name} ${EXAM_COMPONENT_LABELS[c]}`} onBlur={(e) => mark(st, c, e.target)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        </td>
                      ))}
                      <td className="num"><strong>{u.exempt ? 'EX' : u.total ?? (u.partial != null ? <span className="muted">({u.partial})</span> : '–')}</strong>{u.resitUsed && <span className="muted small" title="Resit, capped at the pass mark"> R</span>}</td>
                      <td>{u.exempt ? 'Exempt' : u.total == null ? '' : gradeFor(u.total, settings).grade}</td>
                      {showResit && (
                        <td className="num">
                          {(failed(st.id) || typeof m?.resit === 'number') && (
                            <input className="exam-mark" disabled={!editable || lockedForMe('final')} inputMode="decimal" defaultValue={m?.resit ?? ''} key={`${st.id}-resit-${m?.resit ?? ''}`}
                              aria-label={`${st.name} resit`} onBlur={(e) => resit(st, e.target)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="muted small">Marks save as you leave each box, even without internet; they send when you are back online. A total in brackets is the running total: the points earned so far out of 100.{showResit ? ` A resit replaces a failed total, up to the pass mark (${settings.passMark}%).` : ''}</p>
      </section>

      {!closed && <Papers org={org} sheet={sheet} roster={roster} isOwner={isOwner} onSubmitted={() => navigate(back)} />}

      <MarksUpload org={org} sheet={sheet} roster={roster} editable={editable} withResit={showResit}
        locked={a.canManage ? [] : [...used.filter((c) => isLocked(sheet, c)), ...(isLocked(sheet, 'final') ? ['resit' as const] : [])]} onSaved={(detail) => log('upload', detail)} />

      {a.canManage && !closed && (
        <div className="row-actions no-print">
          {sheet.status !== 'approved' && <button type="button" className="btn btn-primary" onClick={() => { act.approve(sheet); navigate(back); }}>Approve</button>}
          {sheet.status !== 'draft' && <button type="button" className="btn btn-quiet" onClick={() => act.sendBack(sheet)}>{sheet.status === 'approved' ? 'Reopen for the trainer' : 'Send back to the trainer'}</button>}
        </div>
      )}
    </div>
  );
}

/** The course's papers: "marked out of" and percentage, set by its trainer until the first paper is sent (Andy, 2026-10-25). */
function Percentages({ org, sheet, canEdit, onLog }: { org: Organization; sheet: ExamSheetRow; canEdit: boolean; onLog: (action: string, detail: string) => void }) {
  const toast = useToast();
  const [w, setW] = useState<ExamWeights | null>(null);
  const v = w ?? sheet.weights;
  const sum = EXAM_COMPONENTS.reduce((t, c) => t + (v[c].wt || 0), 0);
  const put = (c: ExamComponent, k: 'max' | 'wt', val: string) => setW({ ...v, [c]: { ...v[c], [k]: Number(val) } });
  const summary = usedComponents(sheet.weights).map((c) => `${paperName(c)} ${sheet.weights[c].wt}%`).join(' · ');
  function save() {
    const problem = weightsProblem(v);
    if (problem) return toast.show(problem);
    if (sum !== 100) return toast.show(`The percentages add up to ${sum}%. Make them add up to 100.`);
    saveExamSheetDetails(org.id, sheet.id, { weights: v }).then(() => toast.show('Percentages saved.'), (err) => toast.show(friendlyError(err)));
    onLog('percentages', EXAM_COMPONENTS.map((c) => `${EXAM_COMPONENT_LABELS[c]} ${v[c].wt}% of ${v[c].max}`).join(', '));
    setW(null);
  }
  if (!canEdit) return <p className="small muted">Percentages: {summary}.</p>;
  return (
    <details className="card exam-fold" open={!!w}>
      <summary><strong>Percentages</strong><span className="muted small">{summary}</span></summary>
      <p className="muted small">Set what each CAT and the Final exam are marked out of and what they are worth. Use 0% for a paper you do not give. They lock when you send the first paper.</p>
      <table className="table exam-weights">
        <thead><tr><th>Paper</th><th className="num">Marked out of</th><th className="num">Worth (%)</th></tr></thead>
        <tbody>
          {EXAM_COMPONENTS.map((c) => (
            <tr key={c}>
              <td>{paperName(c)}</td>
              <td className="num"><input className="exam-att" inputMode="decimal" value={v[c].max} onChange={(e) => put(c, 'max', e.target.value)} aria-label={`${paperName(c)} marked out of`} /></td>
              <td className="num"><input className="exam-att" inputMode="decimal" value={v[c].wt} onChange={(e) => put(c, 'wt', e.target.value)} aria-label={`${paperName(c)} worth`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`small ${sum === 100 ? 'muted' : 'up-bad'}`}>They add up to {sum}%{sum === 100 ? '.' : '; they must add up to 100.'}</p>
      <div className="row-actions"><button type="button" className="btn btn-primary" disabled={!w} onClick={save}>Save percentages</button>{w && <button type="button" className="btn btn-quiet" onClick={() => setW(null)}>Cancel</button>}</div>
    </details>
  );
}

/**
 * Sending each paper to the principal (Andy, 2026-10-25): a sent paper locks; the trainer tells the
 * principal by email or WhatsApp, and asks to change a sent paper; only the principal unlocks it.
 */
function Papers({ org, sheet, roster, isOwner, onSubmitted }: { org: Organization; sheet: ExamSheetRow; roster: ExamStudent[]; isOwner: boolean; onSubmitted: () => void }) {
  const a = useExamAccess();
  const toast = useToast();
  const [emailing, setEmailing] = useState('');
  const trainer = isOwner && !a.canManage;
  const principals = useExamPrincipals(org.id, sheet.id, trainer);
  const used = usedComponents(sheet.weights);
  const req = sheet.changeRequest ?? null;
  const missing = (c: ExamComponent) => roster.filter((st) => sheet.marks?.[st.id]?.[c] == null).length;

  function send(c: ExamComponent) {
    const papers = c === 'final' ? used.filter((x) => !isLocked(sheet, x)) : [c];
    const gaps = missing(c);
    const msg = c === 'final'
      ? `Send the Final exam? This locks every paper and sends ${sheet.courseName} to the principal for approval.${gaps ? ` ${gaps} ${gaps === 1 ? 'student has' : 'students have'} no Final mark yet (type ABS or EX).` : ''}`
      : `Send ${paperName(c)}? Its marks lock, and only the principal can unlock them.${gaps ? ` ${gaps} ${gaps === 1 ? 'student has' : 'students have'} no mark yet (type ABS or EX).` : ''}`;
    if (!window.confirm(msg)) return;
    sendExamPapers(org.id, sheet.id, papers).then(() => toast.show(`${paperName(c)} sent and locked. Now tell the principal.`), (err) => toast.show(friendlyError(err)));
    if (c === 'final') onSubmitted();
  }
  function ask(c: ExamComponent) {
    const reason = window.prompt(`Why do you need to change ${paperName(c)}? The principal sees this.`, '');
    if (!reason?.trim()) return;
    askExamChange(org.id, sheet.id, c, reason, a.myName).then(() => toast.show('Asked. Now tell the principal by email or WhatsApp.'), (err) => toast.show(friendlyError(err)));
  }
  function unlock(c: ExamComponent) {
    const reopen = c === 'final' && sheet.status !== 'draft';
    if (!window.confirm(`Unlock ${paperName(c)} so ${sheet.teacherName} can change it?${reopen ? ' The course goes back to marking.' : ''}`)) return;
    unlockExamPaper(org.id, sheet.id, c, reopen).then(() => toast.show(`${paperName(c)} unlocked for ${sheet.teacherName}.`), (err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'unlock', cohort: sheet.cohort, sheetId: sheet.id, detail: `${sheet.courseName}: ${paperName(c)} unlocked for ${sheet.teacherName}${req?.component === c ? ` (asked: ${req.reason})` : ''}`, byName: a.myName });
  }
  async function email(kind: ExamNoticeKind, c: ExamComponent) {
    setEmailing(`${kind}${c}`);
    try { toast.show(`Emailed ${(await emailExamNotice(org.id, sheet.id, kind, c)).join(', ')}.`); } catch (err) { toast.show(friendlyError(err)); } finally { setEmailing(''); }
  }
  const whatsapp = (kind: ExamNoticeKind, c: ExamComponent) => {
    const p = principals.find((x) => x.phone) ?? principals[0];
    const text = examNoticeText({ kind, component: c, courseName: sheet.courseName, cohort: sheet.cohort, teacherName: sheet.teacherName, reason: req?.reason, link: `${window.location.origin}${BASE}/sheet/${sheet.id}`, recipientName: p?.name });
    return waLink(p?.phone ?? '', text);
  };
  const tell = (kind: ExamNoticeKind, c: ExamComponent) => (
    <span className="row-actions">
      <button type="button" className="btn btn-quiet btn-small" disabled={!!emailing} onClick={() => void email(kind, c)}>{emailing === `${kind}${c}` ? 'Sending…' : 'Send Email'}</button>
      <a className="btn btn-quiet btn-small" href={whatsapp(kind, c)} target="_blank" rel="noreferrer">Send WhatsApp</a>
    </span>
  );

  if (!trainer && !a.canManage) return null;
  return (
    <section className="card stack no-print">
      <h2>{trainer ? 'Send to the principal' : 'Papers'}</h2>
      {trainer && <p className="muted small">Send each CAT when its marks are in; it locks so nobody can change it. Sending the Final exam sends the whole course for approval.</p>}
      <ul className="exam-list">
        {used.map((c) => {
          const sent = isLocked(sheet, c);
          const asked = req?.component === c;
          return (
            <li key={c}>
              <span className="exam-list-main">
                <strong>{paperName(c)}</strong>
                <span className="muted small">{sent ? 'Sent and locked' : `Open · ${roster.length - missing(c)} of ${roster.length} marked`}</span>
                {asked && <span className="small up-bad">{req!.byName} asks to change it: {req!.reason}</span>}
              </span>
              <span className="exam-list-side">
                {trainer && !sent && sheet.status === 'draft' && <button type="button" className="btn btn-primary btn-small" onClick={() => send(c)}>Send {paperName(c)}</button>}
                {trainer && sent && (asked ? tell('change', c) : <>{tell('sent', c)}{!req && <button type="button" className="btn btn-quiet btn-small" onClick={() => ask(c)}>Ask to change</button>}</>)}
                {a.canManage && sent && <button type="button" className={`btn btn-small ${asked ? 'btn-primary' : 'btn-quiet'}`} onClick={() => unlock(c)}>Unlock</button>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Finals for a common course (Andy, 2026-10-29, 4A): each student's Semester 1 and Semester 2 totals and their
 * average, with its grade. Opened from the Common courses card on Attendance.
 */
function CommonFinals({ org }: { org: Organization }) {
  const { one = '', two = '' } = useParams();
  const a = useExamAccess();
  const { studentsOf } = useCohorts(org);
  const { settings } = useExamSettings(org.id);
  const s1 = useExamSheet(org.id, one);
  const s2 = useExamSheet(org.id, two);
  const finder = useStudentFinder();
  const first = s1.sheet;
  if (!a.canMark) return <div className="page narrow"><h1>Finals</h1><p>Exam Records are for trainers and the principal.</p></div>;
  if (!first || !s2.sheet) return <div className="page narrow"><h1>Finals</h1><p className="muted">{s1.loading || s2.loading ? 'Loading…' : 'This course was not found.'}</p><Link to="/attendance">Back to Attendance</Link></div>;
  const second = s2.sheet;
  const roster = rosterFor(studentsOf(first.cohort), first.courseId);
  const totalOf = (sh: typeof first, id: string) => unitTotal(sh.weights, sh.marks?.[id], settings.passMark).total;
  const rows = roster.map((st) => {
    const a1 = totalOf(first, st.id);
    const a2 = totalOf(second, st.id);
    const fin = commonFinal(a1, a2);
    return { st, a1, a2, fin, grade: gradeFor(fin, settings).grade };
  });
  const done = rows.filter((r) => r.fin != null).length;
  const n = (v: number | null) => (v == null ? '–' : v.toFixed(1));
  const listed = rows.filter((r) => finder.match(r.st.name, r.st.admissionNo));
  return (
    <div className="page exams common-finals">
      <Link to="/attendance" className="btn-link">← Attendance</Link>
      <div className="page-head">
        <h1>{first.courseName}<span className="muted"> · Finals</span></h1>
      </div>
      <p className="muted">{first.cohort} · Tutor {first.teacherName || first.ownerName} · Finals is the average of Semester 1 and Semester 2. {done} of {rows.length} students have both.</p>
      <div className="row-actions">
        <Link className="btn" to={`${BASE}/sheet/${first.id}`}>Semester 1 marks</Link>
        <Link className="btn" to={`${BASE}/sheet/${second.id}`}>Semester 2 marks</Link>
        <CsvButton name={`${first.courseName}-${first.cohort}-Finals.csv`.replace(/[^A-Za-z0-9.-]+/g, '-')}
          csv={() => toCsv(['No', 'Admission No', 'Name', 'Semester 1', 'Semester 2', 'Finals', 'Grade'], rows.map((r, i) => [i + 1, r.st.admissionNo, r.st.name, r.a1, r.a2, r.fin, r.grade]))} />
      </div>
      <StudentFinder finder={finder} names={rows.map((r) => r.st.name)} shown={listed.length} total={rows.length} />
      <div className="table-scroll">
        <table>
          <thead><tr><th>No</th><th>Adm. No</th><th>Name</th><th className="num">Sem 1</th><th className="num">Sem 2</th><th className="num final-col">Finals</th><th>Grade</th></tr></thead>
          <tbody>
            {listed.map((r) => (
              <tr key={r.st.id}>
                <td>{rows.indexOf(r) + 1}</td><td>{r.st.admissionNo}</td><td>{r.st.name}</td>
                <td className="num">{n(r.a1)}</td><td className="num">{n(r.a2)}</td>
                <td className="num final-col">{r.fin == null ? <span className="muted small">{r.a1 == null && r.a2 == null ? '–' : 'Incomplete'}</span> : n(r.fin)}</td>
                <td>{r.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
