import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import {
  useExamAccess, useExamLog, useExamMeta, useExamPrincipals, useExamSettings, useExamSheet, useExamSheets, useExamTrainers, useMyExamSheets, type ExamSheetRow, type ExamTrainer,
} from '../../state/useExams';
import {
  approveExamSheet, askExamChange, createExamSheet, deleteExamSheet, emailExamNotice, logExam, returnExamSheet, saveExamMark, saveExamRemark, saveExamSettings, saveExamSheetDetails,
  sendExamPapers, unlockExamPaper,
} from '../../lib/examWrites';
import { examNoticeText, type ExamNoticeKind } from '../../../functions/src/shared/examNotices';
import { bandsText, resultSlipsPdf } from '../../lib/examPdf';
import { MarksUpload, ResultsAndTranscripts, ResultsUpload } from './ExamResults';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { ColumnChart, CsvButton, Donut, Gauge, KpiCard, KpiRow, Panel } from '../../components/charts';
import {
  ADIA_BANDS, buildExamReport, departmentSummary, EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, isLocked, markProblem, markText, parseMark, scopeKey, sheetProgress, unitTotal,
  usedComponents, weightsProblem,
  type ExamComponent, type ExamSettings, type ExamSheetStatus, type ExamStudent, type ExamWeights, type GradeBand,
} from '../../../functions/src/shared/exams';
import { studentAttendance } from '../../../functions/src/shared/school';
import { SchoolGate, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

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

const BASE = '/school/exams';
const COMMON = 'common';
type Tab = 'overview' | 'departments' | 'results' | 'setup' | 'log';
/** Links saved before the rebuild still land on the right tab. */
const OLD_TABS: Record<string, Tab> = { progress: 'overview', sheets: 'setup', grading: 'setup', reports: 'results', transcripts: 'results' };

/** The intakes, by name, newest first: every programme's intake of the same name is one cohort. */
function useCohorts(org: Organization) {
  const s = useSchoolPage(org);
  const cohorts = useMemo(() => [...new Set(s.intakes.map((i) => i.name))], [s.intakes]);
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
  return { s, cohorts, studentsOf, allStudents, attendance };
}

const rosterFor = (students: ExamStudent[], courseId: string | null) =>
  (courseId == null ? students : students.filter((x) => x.courseId === courseId)).sort((a, b) => a.name.localeCompare(b.name));
const programmeOf = (courseId: string | null, courseName: (id: string) => string) => (courseId == null ? 'Common course' : courseName(courseId) || 'Programme');
const semesterText = (n: number | null | undefined) => (n ? `Semester ${n}` : 'No semester');

function Exams({ org }: { org: Organization }) {
  const a = useExamAccess();
  const { s, cohorts, studentsOf, allStudents, attendance } = useCohorts(org);
  const [params, setParams] = useSearchParams();
  const cohort = params.get('cohort') && cohorts.includes(params.get('cohort')!) ? params.get('cohort')! : cohorts[0] ?? '';
  const raw = params.get('tab') ?? 'overview';
  const tab: Tab = OLD_TABS[raw] ?? (['overview', 'departments', 'results', 'setup', 'log'].includes(raw) ? (raw as Tab) : 'overview');
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };
  const { sheets } = useExamSheets(org.id, a.canManage ? cohort : '');
  const students = useMemo(() => studentsOf(cohort), [cohort, s.students, s.intakes, s.peopleLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const courses = useMemo(() => s.courses.map((c) => ({ id: c.id, name: c.name })), [s.courses]);

  if (!a.canMark) return <div className="page narrow"><h1>Exam Records</h1><p>Exam Records are for trainers and the principal. Ask the pastor to tick it for your account.</p></div>;
  if (!a.canManage) return <MyClasses org={org} studentsOf={studentsOf} courseName={s.courseName} />;
  // The change log opens from a link at the bottom of Setup (Andy, 2026-10-24); Departments added 2026-10-25.
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['departments', 'Departments'], ['results', 'Results'], ['setup', 'Setup']];
  const shown: Tab = tab === 'log' ? 'setup' : tab;

  return (
    <div className="page narrow exams">
      <div className="page-head"><h1>Exam Records</h1></div>
      {cohorts.length === 0 ? (
        <div className="notice">Exam records follow the intakes. Add a cohort under <Link to="/school/courses">Programmes</Link> first, such as "Cohort 4".</div>
      ) : (
        <>
          <div className="exam-cohorts no-print" role="group" aria-label="Cohort">
            {[...cohorts].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).map((c) => <button key={c} type="button" aria-pressed={cohort === c} className={`chip${cohort === c ? ' chip-on' : ''}`} onClick={() => set('cohort', c)}>{c}</button>)}
          </div>
          <div className="segmented wrap no-print" role="tablist" aria-label="Exam Records">
            {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={shown === k} className={shown === k ? 'on' : ''} onClick={() => set('tab', k)}>{label}</button>)}
          </div>
          {tab === 'overview' && <Overview org={org} cohort={cohort} sheets={sheets} students={students} courseName={s.courseName} onSetup={() => set('tab', 'setup')} />}
          {tab === 'departments' && <Departments org={org} cohort={cohort} sheets={sheets} students={students} courses={courses} />}
          {tab === 'results' && <Results org={org} cohort={cohort} sheets={sheets} students={students} courses={courses} courseName={s.courseName} attendance={attendance} />}
          {tab === 'setup' && <Setup org={org} cohort={cohort} cohorts={cohorts} sheets={sheets} students={students} courses={courses} allStudents={allStudents} onLog={() => set('tab', 'log')} />}
          {tab === 'log' && <><button type="button" className="btn btn-quiet btn-small align-start" onClick={() => set('tab', 'setup')}>← Back to Setup</button><ChangeLog org={org} cohort={cohort} /></>}
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ExamSheetStatus | string }) {
  if (status === 'approved') return <span className="badge badge-ok">Approved</span>;
  if (status === 'submitted') return <span className="badge badge-gold">Waiting for approval</span>;
  return <span className="badge badge-warn">Marking</span>;
}

/* ---------- the trainer's screen ---------- */

function MyClasses({ org, studentsOf, courseName }: { org: Organization; studentsOf: (cohort: string) => ExamStudent[]; courseName: (id: string) => string }) {
  const { sheets, loading } = useMyExamSheets(org.id);
  const cohorts = [...new Set(sheets.map((s) => s.cohort))];
  return (
    <div className="page narrow exams">
      <div className="page-head"><h1>My classes</h1></div>
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
    </div>
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

function Overview({ org, cohort, sheets, students, courseName, onSetup }: { org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courseName: (id: string) => string; onSetup: () => void }) {
  const { trainers } = useExamTrainers(org.id);
  const act = useSheetActions(org);
  const rows = sheets.map((sh) => ({ sh, roster: rosterFor(students, sh.courseId).length, pct: sheetProgress(sh, rosterFor(students, sh.courseId).map((x) => x.id)) }))
    .sort((x, y) => Number(!!y.sh.changeRequest) - Number(!!x.sh.changeRequest) || (STATUS_ORDER[x.sh.status] ?? 1) - (STATUS_ORDER[y.sh.status] ?? 1) || x.pct - y.pct);
  const count = (st: string) => sheets.filter((s) => s.status === st).length;
  const phoneOf = (uid: string) => trainers.find((t) => t.uid === uid)?.phone ?? '';
  const remind = (sh: ExamSheetRow, pctDone: number) => waLink(phoneOf(sh.ownerUid), `Hello ${sh.teacherName}, a reminder from ADIA: your ${sh.courseName} marks for ${cohort} are ${pctDone}% entered. Please key in the rest and send each paper in Insight-IQ, Exam Records. Thank you.`);
  const waiting = count('submitted');
  return (
    <section className="stack">
      {rows.length === 0 ? (
        <div className="notice stack">
          <p>No courses are set up for {cohort} yet. Add each course in Setup and give it to its trainer.</p>
          <button type="button" className="btn btn-primary align-start" onClick={onSetup}>Set up courses</button>
        </div>
      ) : (
        <>
          <p className="muted">{sheets.length} {sheets.length === 1 ? 'course' : 'courses'} · {count('approved')} approved{waiting ? <> · <strong className="up-bad">{waiting} waiting for you</strong></> : ''} · {students.length} students</p>
          <ul className="exam-list">
            {rows.map(({ sh, roster, pct }) => (
              <li key={sh.id}>
                <Link to={`${BASE}/sheet/${sh.id}`} className="exam-list-main">
                  <strong>{sh.courseName || 'Untitled'}</strong>
                  <span className="muted small">{sh.teacherName} · {programmeOf(sh.courseId, courseName)} · {semesterText(sh.semester)} · {roster} students{sentText(sh)}</span>
                  <span className="exam-bar"><span style={{ width: `${pct}%` }} className={pct >= 100 ? 'done' : ''} /></span>
                  {sh.changeRequest && <span className="small up-bad">Asks to change {EXAM_COMPONENT_LABELS[sh.changeRequest.component]}: {sh.changeRequest.reason}</span>}
                </Link>
                <span className="exam-list-side">
                  {sh.changeRequest ? <Link className="btn btn-primary btn-small" to={`${BASE}/sheet/${sh.id}`}>Unlock</Link> : <StatusPill status={sh.status} />}
                  {sh.status === 'submitted' && <button type="button" className="btn btn-primary btn-small" onClick={() => act.approve(sh)}>Approve</button>}
                  {sh.status === 'draft' && <a className="btn btn-quiet btn-small" href={remind(sh, pct)} target="_blank" rel="noreferrer">Remind</a>}
                  {sh.status === 'approved' && <Link className="btn btn-quiet btn-small" to={`${BASE}/sheet/${sh.id}`}>Open</Link>}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">Tap a course to see its marks. To send one back, open it and tap Send back.</p>
        </>
      )}
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
                {[...d.rows].sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999) || x.name.localeCompare(y.name)).map((r) => (
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

type Period = '1' | '2' | 'final' | 'none';

function Results({ org, cohort, sheets, students, courses, courseName, attendance }: {
  org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[];
  courses: { id: string; name: string }[]; courseName: (id: string) => string; attendance: Record<string, number | null>;
}) {
  const [period, setPeriod] = useState<Period>('1');
  const periods: [Period, string][] = [['1', 'Semester 1'], ['2', 'Semester 2'], ['final', 'Final & transcripts']];
  if (sheets.some((s) => !s.semester)) periods.push(['none', 'No semester']);
  const inPeriod = sheets.filter((s) => (period === 'none' ? !s.semester : s.semester === Number(period)));
  return (
    <section className="stack">
      <div className="segmented wrap no-print" role="tablist" aria-label="Results">
        {periods.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{label}</button>)}
      </div>
      {period === 'final'
        ? <ResultsAndTranscripts org={org} cohort={cohort} sheets={sheets} students={students} courseName={courseName} />
        : <Reports org={org} cohort={cohort} period={periods.find((p) => p[0] === period)![1]} sheets={inPeriod} students={students} courses={courses} attendance={attendance} />}
    </section>
  );
}

function Reports({ org, cohort, period, sheets, students, courses, attendance }: {
  org: Organization; cohort: string; period: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[]; attendance: Record<string, number | null>;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { meta, exists } = useExamMeta(org.id, cohort);
  const [scope, setScope] = useState(courses[0]?.id ?? COMMON);
  const [busy, setBusy] = useState('');
  const courseId = scope === COMMON ? null : scope;
  const title = `${courseId == null ? 'Common courses' : courses.find((c) => c.id === courseId)?.name ?? 'Programme'} · ${period}`;
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
      const file = await resultSlipsPdf({ cohort, reportTitle: title, report, rows, settings });
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
      <div className="print-only exam-print-head"><strong>ADIA Training Centre</strong> · {title} · {cohort}</div>
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
              {[...report.rows].sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999) || x.name.localeCompare(y.name)).map((r) => (
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
                  <td className="num">{r.attendance ?? '–'}</td>
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

function Setup({ org, cohort, cohorts, sheets, students, courses, allStudents, onLog }: {
  org: Organization; cohort: string; cohorts: string[]; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[];
  allStudents: Parameters<typeof ResultsUpload>[0]['allStudents']; onLog: () => void;
}) {
  const { settings } = useExamSettings(org.id);
  const w = settings.weights;
  return (
    <section className="stack">
      <CourseSetup org={org} cohort={cohort} cohorts={cohorts} sheets={sheets} students={students} courses={courses} />
      {/* Set once and seldom changed, so folded away (Andy, 2026-10-24). */}
      <Fold title="Starting percentages" note={EXAM_COMPONENTS.filter((c) => w[c].wt > 0).map((c) => `${EXAM_COMPONENT_LABELS[c]} ${w[c].wt}%`).join(' · ')}><Weighting org={org} /></Fold>
      <Fold title="Grading and signatures" note={`Pass mark ${settings.passMark}%`}><Grading org={org} /></Fold>
      <Fold title="Upload past results" note="From your Excel cohort files"><ResultsUpload org={org} allStudents={allStudents} /></Fold>
      <button type="button" className="btn-link align-start small" onClick={onLog}>See the change log</button>
    </section>
  );
}

function Fold({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <details className="card exam-fold">
      <summary><strong>{title}</strong><span className="muted small">{note}</span></summary>
      {children}
    </details>
  );
}

function CourseSetup({ org, cohort, cohorts, sheets, students, courses }: { org: Organization; cohort: string; cohorts: string[]; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[] }) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { trainers, loading, problem } = useExamTrainers(org.id);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ scope: courses[0]?.id ?? COMMON, courseName: '', semester: '1', trainer: '' });
  const others = cohorts.filter((c) => c !== cohort);
  const [from, setFrom] = useState(others[0] ?? '');
  const { sheets: fromSheets } = useExamSheets(org.id, from && others.includes(from) ? from : '');
  const name = (id: string | null) => programmeOf(id, (x) => courses.find((c) => c.id === x)?.name ?? '');
  const same = (x: ExamSheetRow, y: ExamSheetRow) => x.courseId === y.courseId && x.courseName.trim().toLowerCase() === y.courseName.trim().toLowerCase() && (x.semester ?? null) === (y.semester ?? null);
  const toCopy = fromSheets.filter((x) => !sheets.some((y) => same(x, y)));

  const log = (detail: string, sheetId: string | null = null) => void logExam(org.id, { action: 'setup', cohort, sheetId, detail, byName: a.myName });
  function add() {
    const t = trainers.find((x) => x.uid === f.trainer);
    if (!f.courseName.trim()) return toast.show('Type the course name.');
    if (!t) return toast.show('Pick the trainer who marks this course.');
    try {
      const { synced } = createExamSheet(org.id, {
        cohort, courseId: f.scope === COMMON ? null : f.scope, courseName: f.courseName.trim().slice(0, 120), teacherName: t.name.slice(0, 120),
        weights: settings.weights, ownerUid: t.uid, ownerName: t.name.slice(0, 120), semester: f.semester === '2' ? 2 : 1,
      });
      synced.catch((err) => toast.show(friendlyError(err)));
      log(`Added ${f.courseName.trim()} (${name(f.scope === COMMON ? null : f.scope)}, Semester ${f.semester}) for ${t.name}`);
      toast.show(`${f.courseName.trim()} added. It now shows in ${t.name}'s classes.`);
      setF({ ...f, courseName: '' });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function copy() {
    if (!toCopy.length) return;
    if (!window.confirm(`Copy ${toCopy.length} ${toCopy.length === 1 ? 'course' : 'courses'} from ${from} into ${cohort}, with the same trainers? Marks are not copied.`)) return;
    try {
      for (const x of toCopy) {
        createExamSheet(org.id, { cohort, courseId: x.courseId, courseName: x.courseName, teacherName: x.teacherName, weights: settings.weights, ownerUid: x.ownerUid, ownerName: x.ownerName, semester: x.semester ?? 1 })
          .synced.catch((err) => toast.show(friendlyError(err)));
      }
      log(`Copied ${toCopy.length} courses from ${from}`);
      toast.show(`${toCopy.length} courses copied.`);
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
  const trainerOptions = (sh?: ExamSheetRow) => (
    <>
      {sh && !trainers.some((t) => t.uid === sh.ownerUid) && <option value={sh.ownerUid}>{sh.teacherName || sh.ownerName}</option>}
      {trainers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
    </>
  );

  return (
    <section className="card stack">
      <div className="card-head"><h2>Courses and trainers · {cohort}</h2>{!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add a course</button>}</div>
      <p className="muted small">Each course you add shows in its trainer's "My classes". Trainers key in marks; they cannot add, rename or move courses.</p>
      {problem && <p className="up-bad small">The trainer list did not load: {problem}</p>}
      {adding && (
        <div className="stack exam-add">
          <div className="form-grid">
            <label className="field"><span>Programme</span>
              <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={COMMON}>Common course (every student)</option>
              </select>
            </label>
            <label className="field"><span>Course name</span><input value={f.courseName} maxLength={120} placeholder="e.g. Computer Networking" onChange={(e) => setF({ ...f, courseName: e.target.value })} /></label>
            <label className="field"><span>Semester</span>
              <select value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })}><option value="1">Semester 1</option><option value="2">Semester 2</option></select>
            </label>
            <label className="field"><span>Trainer</span>
              <select value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })}>
                <option value="">{loading ? 'Loading…' : 'Pick the trainer'}</option>
                {trainerOptions()}
              </select>
            </label>
          </div>
          {!loading && trainers.length === 0 && <p className="small muted">No trainers yet. The pastor creates each trainer's account under Settings, Staff accounts, with the role Trainer.</p>}
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={add}>Add course</button><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Done</button></div>
        </div>
      )}
      {sheets.length === 0 ? (
        <div className="stack">
          <p className="muted">No courses for {cohort} yet.</p>
          {others.length > 0 && (
            <div className="row-actions">
              <label className="field"><span>Copy the course list from</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)}>{others.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
              <button type="button" className="btn btn-quiet" disabled={!toCopy.length} onClick={copy}>{toCopy.length ? `Copy ${toCopy.length} courses` : 'Nothing to copy'}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="exam-table-wrap">
          <table className="table exam-setup-table">
            <thead><tr><th>Course</th><th>Semester</th><th>Trainer</th><th>Status</th><th /></tr></thead>
            <tbody>
              {sheets.map((sh) => (
                <tr key={sh.id}>
                  <td>
                    <input className="exam-remark" defaultValue={sh.courseName} key={`${sh.id}-${sh.courseName}`} maxLength={120} aria-label="Course name"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sh.courseName) change(sh, { courseName: v }, `renamed to ${v}`); }} />
                    <div className="muted small">{name(sh.courseId)} · {rosterFor(students, sh.courseId).length} students</div>
                  </td>
                  <td>
                    <select value={String(sh.semester ?? '')} aria-label="Semester" onChange={(e) => change(sh, { semester: e.target.value === '2' ? 2 : 1 }, `moved to Semester ${e.target.value}`)}>
                      {!sh.semester && <option value="">None</option>}<option value="1">Semester 1</option><option value="2">Semester 2</option>
                    </select>
                  </td>
                  <td>
                    <select value={sh.ownerUid} aria-label="Trainer" onChange={(e) => { const t = trainers.find((x) => x.uid === e.target.value); if (t) change(sh, { trainer: t }, `given to ${t.name} (was ${sh.teacherName})`); }}>
                      {trainerOptions(sh)}
                    </select>
                  </td>
                  <td><StatusPill status={sh.status} /></td>
                  <td><button type="button" className="btn btn-quiet btn-small" onClick={() => remove(sh)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const { s, studentsOf } = useCohorts(org);
  const { sheet, loading } = useExamSheet(org.id, sheetId);
  const { settings } = useExamSettings(org.id);
  const act = useSheetActions(org);

  if (!a.canMark) return <div className="page narrow"><h1>Marks sheet</h1><p>Exam Records are for trainers and the principal.</p></div>;
  if (!sheet) return <div className="page narrow"><h1>Marks sheet</h1><p className="muted">{loading ? 'Loading…' : 'This class was not found.'}</p><Link to={BASE}>Back to Exam Records</Link></div>;

  const roster = rosterFor(studentsOf(sheet.cohort), sheet.courseId);
  const isOwner = sheet.ownerUid === a.uid;
  const editable = a.canManage || (isOwner && sheet.status === 'draft');
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
  const back = a.canManage ? `${BASE}?cohort=${encodeURIComponent(sheet.cohort)}&tab=overview` : BASE;

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

  const notice = sheet.status === 'approved'
    ? `Approved${sheet.approvedByName ? ` by ${sheet.approvedByName}` : ''}. These results are final.${a.canManage ? ' Changes you make are written to the change log.' : ''}`
    : sheet.status === 'submitted'
      ? (a.canManage ? 'The trainer sent the Final exam. Check the marks, then approve or send back.' : 'Every paper is sent and locked. Waiting for the principal to approve it.')
      : sheet.returnNote ? `The principal sent this back: ${sheet.returnNote}` : null;

  return (
    <div className="page narrow exams">
      <p className="no-print"><Link to={back}>← {a.canManage ? 'Exam Records' : 'My classes'}</Link></p>
      <div className="page-head">
        <h1>{sheet.courseName || 'Untitled course'}</h1>
        <StatusPill status={sheet.status} />
      </div>
      <p className="lead">{programmeOf(sheet.courseId, s.courseName)} · {sheet.cohort} · {semesterText(sheet.semester)} · {sheet.teacherName}</p>
      {notice && <div className={`notice small${sheet.status === 'draft' ? ' up-bad' : ''}`}>{notice}</div>}
      {loggedEdit && sheet.status === 'draft' && <div className="notice small">You are changing a trainer's marks. Every change is written to the change log.</div>}

      <Percentages org={org} sheet={sheet} canEdit={a.canManage || (isOwner && sheet.status === 'draft' && !used.some((c) => isLocked(sheet, c)) && !isLocked(sheet, 'final'))} onLog={log} />

      <section className="card stack">
        <div className="card-head"><h2>Marks</h2><span className="muted small">{done} of {roster.length} complete · {pctDone}% entered</span></div>
        <span className="exam-bar"><span style={{ width: `${pctDone}%` }} className={pctDone >= 100 ? 'done' : ''} /></span>
        <p className="small muted">Type a mark, <strong>ABS</strong> for absent (counts as 0) or <strong>EX</strong> for exempt. A sent paper is locked.</p>
        {roster.length === 0 ? <p className="muted">No enrolled students in {sheet.cohort}{sheet.courseId ? ` for ${s.courseName(sheet.courseId)}` : ''}. Students come from the Students list, by intake.</p> : (
          <div className="exam-table-wrap">
            <table className="table exam-marks">
              <thead><tr><th>Student</th>{used.map((c) => <th key={c} className="num">{EXAM_COMPONENT_LABELS[c]}<div className="muted small">/{w[c].max}{isLocked(sheet, c) ? ' · sent' : ''}</div></th>)}<th className="num">Total</th><th>Grade</th>{showResit && <th className="num">Resit<div className="muted small">/100</div></th>}</tr></thead>
              <tbody>
                {roster.map((st) => {
                  const m = sheet.marks?.[st.id];
                  const u = totals.get(st.id)!;
                  return (
                    <tr key={st.id}>
                      <td>{st.name}<div className="muted small">{st.admissionNo}{sheet.courseId == null ? ` · ${st.courseName}` : ''}</div></td>
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
        )}
        <p className="muted small">Marks save as you leave each box, even without internet; they send when you are back online. A total in brackets is the running total: the points earned so far out of 100.{showResit ? ` A resit replaces a failed total, up to the pass mark (${settings.passMark}%).` : ''}</p>
      </section>

      <Papers org={org} sheet={sheet} roster={roster} isOwner={isOwner} onSubmitted={() => navigate(back)} />

      <MarksUpload org={org} sheet={sheet} roster={roster} editable={editable} withResit={showResit}
        locked={a.canManage ? [] : [...used.filter((c) => isLocked(sheet, c)), ...(isLocked(sheet, 'final') ? ['resit' as const] : [])]} onSaved={(detail) => log('upload', detail)} />

      {a.canManage && (
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
