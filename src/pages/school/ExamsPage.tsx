import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useExamAccess, useExamLog, useExamMeta, useExamSettings, useExamSheet, useExamSheets, type ExamSheetRow } from '../../state/useExams';
import {
  createExamSheet, deleteExamSheet, logExam, saveExamAttendance, saveExamMark, saveExamRemark, saveExamSettings, saveExamSheetDetails, submitExamSheet, unlockExamSheet,
} from '../../lib/examWrites';
import { bandsText, resultSlipsPdf } from '../../lib/examPdf';
import { MarksUpload, ResultsAndTranscripts } from './ExamResults';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { ColumnChart, CsvButton, Donut, Gauge, KpiCard, KpiRow, Panel } from '../../components/charts';
import {
  ADIA_BANDS, buildExamReport, DEFAULT_EXAM_WEIGHTS, EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, markProblem, scopeKey, sheetProgress, unitTotal, weightsProblem,
  type ExamComponent, type ExamSettings, type ExamStudent, type ExamWeights, type GradeBand,
} from '../../../functions/src/shared/exams';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

/**
 * ADIA Exam Records: trainers key in their own marks sheets; the principal follows progress,
 * compiles each programme's report with the common courses, edits remarks and attendance,
 * unlocks sheets, and prints result slips. Rebuilt from Andy's ADIA Results System.
 */
export function ExamsPage() {
  return <SchoolGate title="Exam Records">{(org) => <Exams org={org} />}</SchoolGate>;
}
export function ExamSheetPage() {
  return <SchoolGate title="Marks sheet">{(org) => <SheetEditor org={org} />}</SchoolGate>;
}

const BASE = '/school/exams';
const COMMON = 'common';
type Tab = 'sheets' | 'progress' | 'reports' | 'transcripts' | 'log' | 'grading';

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
  return { s, cohorts, studentsOf, allStudents };
}

const rosterFor = (students: ExamStudent[], courseId: string | null) =>
  (courseId == null ? students : students.filter((x) => x.courseId === courseId)).sort((a, b) => a.name.localeCompare(b.name));

function Exams({ org }: { org: Organization }) {
  const a = useExamAccess();
  const { can } = useAuth();
  const { s, cohorts, studentsOf, allStudents } = useCohorts(org);
  const [params, setParams] = useSearchParams();
  const cohort = params.get('cohort') && cohorts.includes(params.get('cohort')!) ? params.get('cohort')! : cohorts[0] ?? '';
  const tab = (params.get('tab') as Tab | null) ?? (a.canManage ? 'progress' : 'sheets');
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };
  const { sheets } = useExamSheets(org.id, cohort);
  const students = useMemo(() => studentsOf(cohort), [cohort, s.students, s.intakes, s.peopleLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a.canMark) return <div className="page narrow"><h1>Exam Records</h1><p>Exam Records are for trainers and the principal. Ask the pastor to tick it for your account.</p></div>;
  const tabs: [Tab, string, boolean][] = [['sheets', a.canManage ? 'All sheets' : 'My sheets', true], ['progress', 'Progress', a.canManage], ['reports', 'Reports', a.canManage], ['transcripts', 'Results & transcripts', a.canManage], ['log', 'Change log', a.canManage], ['grading', 'Grading', a.canManage]];

  return (
    <div className="page narrow exams">
      <div className="page-head"><h1>Exam Records</h1></div>
      {can('people.read') && <SchoolNav feesAllowed={s.feesAllowed} />}
      {cohorts.length === 0 ? (
        <div className="notice">Exam records follow the intakes. Add an intake under <Link to="/school/courses">Courses</Link> first, such as "Cohort 4" or "September 2026".</div>
      ) : (
        <>
          <div className="dash-controls no-print">
            <label className="field"><span>Cohort (intake)</span>
              <select value={cohort} onChange={(e) => set('cohort', e.target.value)}>{cohorts.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
          </div>
          <div className="segmented wrap no-print" role="tablist" aria-label="Exam Records">
            {tabs.filter((t) => t[2]).map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k)}>{label}</button>)}
          </div>
          {tab === 'sheets' && <SheetList org={org} cohort={cohort} sheets={sheets} students={students} courses={s.courses.map((c) => ({ id: c.id, name: c.name }))} />}
          {tab === 'progress' && a.canManage && <Progress cohort={cohort} sheets={sheets} students={students} courseName={s.courseName} />}
          {tab === 'reports' && a.canManage && <Reports org={org} cohort={cohort} sheets={sheets} students={students} courses={s.courses.map((c) => ({ id: c.id, name: c.name }))} />}
          {tab === 'transcripts' && a.canManage && <ResultsAndTranscripts org={org} cohort={cohort} sheets={sheets} students={students} allStudents={allStudents} courseName={s.courseName} />}
          {tab === 'log' && a.canManage && <ChangeLog org={org} cohort={cohort} />}
          {tab === 'grading' && a.canManage && <Grading org={org} />}
        </>
      )}
    </div>
  );
}

const programmeOf = (courseId: string | null, courseName: (id: string) => string) => (courseId == null ? 'Common courses' : courseName(courseId) || 'Programme');

function SheetList({ org, cohort, sheets, students, courses }: { org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[] }) {
  const a = useExamAccess();
  const toast = useToast();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ scope: courses[0]?.id ?? COMMON, courseName: '', teacherName: a.myName, semester: '1' });
  const name = (id: string) => courses.find((c) => c.id === id)?.name ?? '';

  function create() {
    if (!f.courseName.trim()) return toast.show('Type the course name.');
    if (!f.teacherName.trim()) return toast.show("Type the trainer's name.");
    try {
      const { ref, synced } = createExamSheet(org.id, {
        cohort, courseId: f.scope === COMMON ? null : f.scope, courseName: f.courseName.trim().slice(0, 120), teacherName: f.teacherName.trim().slice(0, 120),
        weights: DEFAULT_EXAM_WEIGHTS, ownerUid: a.uid, ownerName: a.myName.slice(0, 120), semester: f.semester === '1' ? 1 : f.semester === '2' ? 2 : null,
      });
      synced.catch((err) => toast.show(friendlyError(err)));
      navigate(`${BASE}/sheet/${ref.id}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <section className="stack">
      <div className="page-head">
        <h2>{a.canManage ? 'Every marks sheet' : 'My marks sheets'}</h2>
        {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ New marks sheet</button>}
      </div>
      {adding && (
        <div className="card stack">
          <h3>New marks sheet</h3>
          <label className="field"><span>Programme</span>
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={COMMON}>Common courses (every student)</option>
            </select>
          </label>
          <label className="field"><span>Course name</span><input value={f.courseName} maxLength={120} placeholder="e.g. Computer Networking" onChange={(e) => setF({ ...f, courseName: e.target.value })} /></label>
          <label className="field"><span>Trainer's name</span><input value={f.teacherName} maxLength={120} onChange={(e) => setF({ ...f, teacherName: e.target.value })} /></label>
          <label className="field"><span>Semester</span>
            <select value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })}>
              <option value="1">Semester 1</option><option value="2">Semester 2</option><option value="">Not part of a semester</option>
            </select>
          </label>
          <p className="muted small">You set the CAT and Final percentages on the next screen. The default is 10, 10, 10 and 70.</p>
          <div className="row-actions"><button type="button" className="btn btn-primary" onClick={create}>Create sheet</button><button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      {sheets.length === 0 ? <p className="muted">No marks sheets for {cohort} yet. Tap <strong>New marks sheet</strong>, pick the programme and type the course name.</p> : (
        <ul className="exam-cards">
          {sheets.map((sh) => {
            const pctDone = sheetProgress(sh, rosterFor(students, sh.courseId).map((x) => x.id));
            return (
              <li key={sh.id}>
                <Link to={`${BASE}/sheet/${sh.id}`} className="exam-card">
                  <span className="exam-card-head"><strong>{sh.courseName || 'Untitled course'}</strong><StatusPill status={sh.status} /></span>
                  <span className="muted small">{programmeOf(sh.courseId, name)}{sh.semester ? ` · Semester ${sh.semester}` : ''} · {sh.teacherName} · {rosterFor(students, sh.courseId).length} students</span>
                  <span className="exam-bar"><span style={{ width: `${pctDone}%` }} className={pctDone >= 100 ? 'done' : ''} /></span>
                  <span className="muted small">{pctDone}% of marks entered</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return status === 'submitted' ? <span className="badge">Submitted · locked</span> : <span className="badge badge-warn">Draft</span>;
}

function Progress({ cohort, sheets, students, courseName }: { cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courseName: (id: string) => string }) {
  const rows = sheets.map((sh) => ({ sh, roster: rosterFor(students, sh.courseId).length, pct: sheetProgress(sh, rosterFor(students, sh.courseId).map((x) => x.id)) }))
    .sort((x, y) => x.pct - y.pct);
  const submitted = sheets.filter((s) => s.status === 'submitted').length;
  const overall = rows.length ? Math.round(rows.reduce((t, r) => t + r.pct, 0) / rows.length) : 0;
  const remind = (sh: ExamSheetRow, pctDone: number) => `https://wa.me/?text=${encodeURIComponent(`Hello ${sh.teacherName}, a reminder from ADIA: your ${sh.courseName} marks for ${cohort} are ${pctDone}% entered. Please key in the rest and tap Submit in Insight-IQ, Exam Records. Thank you.`)}`;
  return (
    <section className="stack">
      <KpiRow label="Marking progress">
        <KpiCard label="Marks sheets" value={String(sheets.length)} tone="gold" note={`${students.length} students in ${cohort}`} />
        <KpiCard label="Submitted" value={`${submitted} of ${sheets.length}`} tone={submitted === sheets.length && sheets.length ? 'ok' : 'warn'} />
        <KpiCard label="Still drafts" value={String(sheets.length - submitted)} />
        <KpiCard label="Marks entered" value={`${overall}%`} note="Average across every sheet" />
      </KpiRow>
      {rows.length === 0 ? <p className="muted">No trainer has started a marks sheet for {cohort} yet.</p> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Course</th><th>Trainer</th><th className="num">Students</th><th>Entered</th><th>Status</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map(({ sh, roster, pct }) => (
                <tr key={sh.id}>
                  <td><Link to={`${BASE}/sheet/${sh.id}`}>{sh.courseName || 'Untitled'}</Link><div className="muted small">{programmeOf(sh.courseId, courseName)}</div></td>
                  <td>{sh.teacherName}</td>
                  <td className="num">{roster}</td>
                  <td><span className="exam-bar small-bar"><span style={{ width: `${pct}%` }} className={pct >= 100 ? 'done' : ''} /></span> <span className="small">{pct}%</span></td>
                  <td><StatusPill status={sh.status} /></td>
                  <td className="no-print">{sh.status === 'draft' && <a className="btn btn-quiet btn-small" href={remind(sh, pct)} target="_blank" rel="noreferrer">WhatsApp reminder</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Reports({ org, cohort, sheets, students, courses }: { org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courses: { id: string; name: string }[] }) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(org.id);
  const { meta, exists } = useExamMeta(org.id, cohort);
  const [scope, setScope] = useState(courses[0]?.id ?? COMMON);
  const [busy, setBusy] = useState('');
  const courseId = scope === COMMON ? null : scope;
  const title = courseId == null ? 'Common courses' : courses.find((c) => c.id === courseId)?.name ?? 'Programme';
  const report = useMemo(() => buildExamReport(courseId, sheets, students, settings, meta), [courseId, sheets, students, settings, meta]);
  const graded = report.rows.filter((r) => r.average != null);
  const passed = graded.filter((r) => r.average! >= settings.passMark).length;
  const classAvg = graded.length ? Math.round((graded.reduce((t, r) => t + r.average!, 0) / graded.length) * 10) / 10 : null;
  const top = [...graded].sort((x, y) => y.average! - x.average!)[0];

  function remark(studentId: string, text: string, before: string) {
    if (text === before) return;
    try {
      saveExamRemark(org.id, cohort, exists, scopeKey(courseId), studentId, text.slice(0, 300)).catch((err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'remarks', cohort, sheetId: null, detail: `${report.rows.find((r) => r.studentId === studentId)?.name}: ${text || '(back to automatic)'}`, byName: a.myName });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function attendance(studentId: string, text: string, before: number | null) {
    const v = text.trim() === '' ? null : Number(text);
    if (v === before) return;
    if (v != null && !(v >= 0 && v <= 100)) return toast.show('Attendance is a percentage from 0 to 100.');
    try {
      saveExamAttendance(org.id, cohort, exists, studentId, v).catch((err) => toast.show(friendlyError(err)));
      void logExam(org.id, { action: 'attendance', cohort, sheetId: null, detail: `${report.rows.find((r) => r.studentId === studentId)?.name}: ${v ?? 'cleared'}`, byName: a.myName });
    } catch (err) { toast.show(friendlyError(err)); }
  }
  async function slips(rows = report.rows) {
    setBusy(rows.length === 1 ? rows[0]!.studentId : 'all');
    try {
      const file = await resultSlipsPdf({ cohort, reportTitle: title, report, rows, settings });
      if (rows.length === 1) await shareOrDownload(file, `ADIA result slip for ${rows[0]!.name}`); else downloadFile(file);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  const csv = () => toCsv(
    ['Position', 'Name', 'Admission No', 'Programme', ...report.units.map((u) => `${u.courseName}${u.common ? ' (common)' : ''}`), 'Total', 'Average', 'Grade', 'Remarks', 'Attendance %'],
    [...report.rows].sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999)).map((r) => [r.position, r.name, r.admissionNo, r.programme,
      ...report.units.map((u) => r.cells[u.sheetId]?.total ?? null), r.total, r.average, r.grade, r.remarks, r.attendance]),
  );

  return (
    <section className="stack exam-report">
      <div className="dash-controls no-print">
        <label className="field"><span>Report</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name} (with common courses)</option>)}
            <option value={COMMON}>Common courses, every student</option>
          </select>
        </label>
        <span className="row-actions">
          <CsvButton name={`Results-${cohort}-${title}.csv`.replace(/[^A-Za-z0-9.-]+/g, '-')} csv={csv} />
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print report</button>
          <button type="button" className="btn btn-primary" disabled={!report.rows.length || !!busy} onClick={() => void slips()}>{busy === 'all' ? 'Making slips…' : 'All result slips (PDF)'}</button>
        </span>
      </div>
      <div className="print-only exam-print-head"><strong>ADIA Training Centre</strong> · {title} · {cohort}</div>

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

      {report.units.length === 0 ? <p className="muted">No marks sheets for this report yet.</p> : (
        <div className="card exam-table-wrap">
          <table className="table exam-table">
            <thead>
              <tr>
                <th className="num">Pos</th><th>Name</th><th>Adm no</th>
                {report.units.map((u) => <th key={u.sheetId} className="num" title={`${u.courseName} · ${u.teacherName}`}><Link to={`${BASE}/sheet/${u.sheetId}`}>{u.courseName}</Link>{u.common && <span className="muted"> (common)</span>}{u.status === 'draft' && <span className="muted"> · draft</span>}</th>)}
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
                    return <td key={u.sheetId} className="num">{c?.total ?? (c?.partial != null ? <span className="muted" title="Not every paper is marked">({c.partial})</span> : '–')}</td>;
                  })}
                  <td className="num">{r.total ?? '–'}</td>
                  <td className="num"><strong>{r.average ?? '–'}</strong></td>
                  <td>{r.grade}</td>
                  <td><input className="exam-remark" defaultValue={r.remarks} key={`${r.studentId}-${r.remarks}`} maxLength={300} aria-label={`Remarks for ${r.name}`} onBlur={(e) => remark(r.studentId, e.target.value === r.remarksAuto ? '' : e.target.value, r.remarksEdited ? r.remarks : '')} /></td>
                  <td className="num"><input className="exam-att" inputMode="decimal" defaultValue={r.attendance ?? ''} key={`${r.studentId}-${r.attendance}`} aria-label={`Attendance for ${r.name}`} onBlur={(e) => attendance(r.studentId, e.target.value, r.attendance)} /></td>
                  <td className="no-print"><button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => void slips([r])}>{busy === r.studentId ? '…' : 'Slip'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">A figure in brackets is not final: some of that course's papers are not marked yet. Position uses the average; equal averages share a position. Clear a remark to go back to the automatic one.</p>
        </div>
      )}
    </section>
  );
}

function ChangeLog({ org, cohort }: { org: Organization; cohort: string }) {
  const rows = useExamLog(org.id, cohort);
  const when = (r: (typeof rows)[number]) => r.at?.toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) ?? 'just now';
  return (
    <section className="card stack">
      <h2>Changes made by the principal</h2>
      <p className="muted small">Every mark changed on a submitted sheet, every unlock, remark and attendance change, with who made it.</p>
      {rows.length === 0 ? <p className="muted">No changes yet for {cohort}.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{when(r)}</td><td>{r.byName}</td><td>{r.action}</td><td className="small">{r.detail}</td></tr>)}</tbody>
        </table>
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

function SheetEditor({ org }: { org: Organization }) {
  const { sheetId = '' } = useParams();
  const a = useExamAccess();
  const toast = useToast();
  const navigate = useNavigate();
  const { s, studentsOf } = useCohorts(org);
  const { sheet, loading } = useExamSheet(org.id, sheetId);
  const { settings } = useExamSettings(org.id);
  const [details, setDetails] = useState<{ courseName: string; teacherName: string; weights: ExamWeights; semester: 1 | 2 | null } | null>(null);

  if (!a.canMark) return <div className="page narrow"><h1>Marks sheet</h1><p>Exam Records are for trainers and the principal.</p></div>;
  if (!sheet) return <div className="page narrow"><h1>Marks sheet</h1><p className="muted">{loading ? 'Loading…' : 'This sheet was not found.'}</p><Link to={BASE}>Back to Exam Records</Link></div>;

  const roster = rosterFor(studentsOf(sheet.cohort), sheet.courseId);
  const isOwner = sheet.ownerUid === a.uid;
  const editable = a.canManage || (isOwner && sheet.status === 'draft');
  const loggedEdit = a.canManage && (sheet.status === 'submitted' || !isOwner);
  const used = EXAM_COMPONENTS.filter((c) => sheet.weights[c].wt > 0);
  const d = details ?? { courseName: sheet.courseName, teacherName: sheet.teacherName, weights: sheet.weights, semester: sheet.semester ?? null };
  const wtSum = EXAM_COMPONENTS.reduce((t, c) => t + (d.weights[c].wt || 0), 0);
  const done = roster.filter((st) => unitTotal(sheet.weights, sheet.marks?.[st.id]).complete).length;
  const back = `${BASE}?cohort=${encodeURIComponent(sheet.cohort)}`;

  function log(action: string, detail: string) {
    if (loggedEdit) void logExam(org.id, { action, cohort: sheet!.cohort, sheetId: sheet!.id, detail: `${sheet!.courseName}: ${detail}`, byName: a.myName });
  }
  function mark(st: ExamStudent, c: ExamComponent, text: string) {
    const before = sheet!.marks?.[st.id]?.[c] ?? null;
    const t = text.trim();
    const v = t === '' ? null : Number(t);
    if (v === before) return;
    if (v != null && Number.isNaN(v)) return toast.show('Type a number.');
    const problem = markProblem(v, sheet!.weights[c].max);
    if (problem) return toast.show(`${st.name}, ${EXAM_COMPONENT_LABELS[c]}: ${problem}`);
    try {
      saveExamMark(org.id, sheet!.id, st.id, c, v).catch((err) => toast.show(friendlyError(err)));
      log('mark', `${st.name} ${EXAM_COMPONENT_LABELS[c]} ${before ?? 'blank'} → ${v ?? 'blank'}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function saveDetails() {
    if (!d.courseName.trim() || !d.teacherName.trim()) return toast.show('The course name and the trainer are both needed.');
    const problem = weightsProblem(d.weights);
    if (problem) return toast.show(problem);
    saveExamSheetDetails(org.id, sheet!.id, { courseName: d.courseName.trim().slice(0, 120), teacherName: d.teacherName.trim().slice(0, 120), weights: d.weights, semester: d.semester }).catch((err) => toast.show(friendlyError(err)));
    log('details', `${d.teacherName}, ${EXAM_COMPONENTS.map((c) => `${EXAM_COMPONENT_LABELS[c]} ${d.weights[c].wt}% of ${d.weights[c].max}`).join(', ')}`);
    setDetails(null);
    toast.show('Saved.');
  }
  function submit() {
    const missing = roster.length - done;
    if (!sheet!.courseName.trim() || !sheet!.teacherName.trim()) return toast.show('Fill in the course name and trainer before submitting.');
    if (missing > 0 && !window.confirm(`${missing} ${missing === 1 ? 'student does' : 'students do'} not have every mark yet. Submit and lock anyway?`)) return;
    submitExamSheet(org.id, sheet!.id).then(() => toast.show('Submitted. The sheet is now locked.'), (err) => toast.show(friendlyError(err)));
    log('lock', 'submitted and locked');
  }
  function unlock() {
    unlockExamSheet(org.id, sheet!.id).then(() => toast.show('Unlocked. The trainer can change marks again.'), (err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'unlock', cohort: sheet!.cohort, sheetId: sheet!.id, detail: `${sheet!.courseName} / ${sheet!.teacherName}`, byName: a.myName });
  }
  function remove() {
    if (!window.confirm('Delete this marks sheet? It can be restored from the bin within 30 days.')) return;
    deleteExamSheet(org.id, sheet!.id).catch((err) => toast.show(friendlyError(err)));
    log('delete', 'sheet deleted');
    navigate(back);
  }

  return (
    <div className="page narrow exams">
      <p className="no-print"><Link to={back}>← Exam Records</Link></p>
      <div className="page-head">
        <h1>{sheet.courseName || 'Untitled course'}</h1>
        <StatusPill status={sheet.status} />
      </div>
      <p className="lead">{programmeOf(sheet.courseId, s.courseName)} · {sheet.cohort} · {sheet.teacherName}</p>
      {loggedEdit && <div className="notice small">You are changing {sheet.status === 'submitted' ? 'a submitted sheet' : "a trainer's sheet"}. Every change is written to the change log.</div>}
      {!editable && <div className="notice small">This sheet is submitted and locked. Ask the principal to unlock it if a mark must change.</div>}

      <section className="card stack">
        <div className="card-head"><h2>Course and papers</h2></div>
        <div className="form-grid">
          <label className="field"><span>Course name</span><input value={d.courseName} disabled={!editable} maxLength={120} onChange={(e) => setDetails({ ...d, courseName: e.target.value })} /></label>
          <label className="field"><span>Trainer's name</span><input value={d.teacherName} disabled={!editable} maxLength={120} onChange={(e) => setDetails({ ...d, teacherName: e.target.value })} /></label>
          <label className="field"><span>Semester</span>
            <select value={d.semester ?? ''} disabled={!editable} onChange={(e) => setDetails({ ...d, semester: e.target.value === '1' ? 1 : e.target.value === '2' ? 2 : null })}>
              <option value="1">Semester 1</option><option value="2">Semester 2</option><option value="">Not part of a semester</option>
            </select>
          </label>
        </div>
        <table className="table exam-weights">
          <thead><tr><th>Paper</th><th className="num">Marked out of</th><th className="num">Worth (%)</th></tr></thead>
          <tbody>
            {EXAM_COMPONENTS.map((c) => (
              <tr key={c}>
                <td>{EXAM_COMPONENT_LABELS[c]}</td>
                <td className="num"><input className="exam-att" inputMode="decimal" disabled={!editable} value={d.weights[c].max} onChange={(e) => setDetails({ ...d, weights: { ...d.weights, [c]: { ...d.weights[c], max: Number(e.target.value) } } })} aria-label={`${EXAM_COMPONENT_LABELS[c]} marked out of`} /></td>
                <td className="num"><input className="exam-att" inputMode="decimal" disabled={!editable} value={d.weights[c].wt} onChange={(e) => setDetails({ ...d, weights: { ...d.weights, [c]: { ...d.weights[c], wt: Number(e.target.value) } } })} aria-label={`${EXAM_COMPONENT_LABELS[c]} worth`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`small ${wtSum === 100 ? 'muted' : 'up-bad'}`}>The percentages add up to {wtSum}%.{wtSum !== 100 && ' They usually add up to 100; the total is still worked out of 100.'} Set a paper to 0% if it is not used.</p>
        {details && editable && <div className="row-actions"><button type="button" className="btn btn-primary" onClick={saveDetails}>Save course and papers</button><button type="button" className="btn btn-quiet" onClick={() => setDetails(null)}>Cancel</button></div>}
      </section>

      <section className="card stack">
        <div className="card-head"><h2>Marks</h2><span className="muted small">{done} of {roster.length} complete</span></div>
        {roster.length === 0 ? <p className="muted">No enrolled students in {sheet.cohort}{sheet.courseId ? ` for ${s.courseName(sheet.courseId)}` : ''}. Students come from the Students list, by intake.</p> : (
          <div className="exam-table-wrap">
            <table className="table exam-marks">
              <thead><tr><th>Student</th>{used.map((c) => <th key={c} className="num">{EXAM_COMPONENT_LABELS[c]}<div className="muted small">/{sheet.weights[c].max} · {sheet.weights[c].wt}%</div></th>)}<th className="num">Total</th><th>Grade</th></tr></thead>
              <tbody>
                {roster.map((st) => {
                  const m = sheet.marks?.[st.id];
                  const u = unitTotal(sheet.weights, m);
                  return (
                    <tr key={st.id}>
                      <td>{st.name}<div className="muted small">{st.admissionNo}{sheet.courseId == null ? ` · ${st.courseName}` : ''}</div></td>
                      {used.map((c) => (
                        <td key={c} className="num">
                          <input className="exam-mark" inputMode="decimal" disabled={!editable} defaultValue={m?.[c] ?? ''} key={`${st.id}-${c}-${m?.[c] ?? ''}`}
                            aria-label={`${st.name} ${EXAM_COMPONENT_LABELS[c]}`} onBlur={(e) => mark(st, c, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        </td>
                      ))}
                      <td className="num"><strong>{u.total ?? (u.partial != null ? <span className="muted">({u.partial})</span> : '–')}</strong></td>
                      <td>{u.total == null ? '' : gradeFor(u.total, settings).grade}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Marks save as you leave each box, even without internet; they send when you are back online.</p>
      </section>

      <MarksUpload org={org} sheet={sheet} roster={roster} editable={editable} onSaved={(detail) => log('upload', detail)} />

      <div className="row-actions no-print">
        {sheet.status === 'draft' && (isOwner || a.canManage) && <button type="button" className="btn btn-primary" onClick={submit}>Submit and lock</button>}
        {sheet.status === 'submitted' && a.canManage && <button type="button" className="btn btn-quiet" onClick={unlock}>Unlock for the trainer</button>}
        {((isOwner && sheet.status === 'draft') || a.canManage) && <button type="button" className="btn btn-quiet" onClick={remove}>Delete sheet</button>}
      </div>
    </div>
  );
}
