import { useMemo, useState, type ChangeEvent } from 'react';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { examResultId, logExam, saveExamMarks, saveExamResults } from '../../lib/examWrites';
import { correctAdmissionNo } from '../../lib/schoolWrites';
import { transcriptsPdf, type Transcript, type TranscriptSemester } from '../../lib/examPdf';
import { downloadFile } from '../../lib/givingPdf';
import { toCsv } from '../../lib/analytics';
import { CsvButton, KpiCard, KpiRow } from '../../components/charts';
import { useExamAccess, useExamResults, useExamSettings, type ExamSheetRow } from '../../state/useExams';
import { EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, markProblem, type ExamComponent, type ExamSettings, type ExamStudent, type MarkValue, type StudentMarks } from '../../../functions/src/shared/exams';
import {
  admissionKey, finalResult, parseMarksFile, parseResultsWorkbook, planResultImport, printedDiffers, semesterFromSheets,
  type ExamResult, type ImportStudent, type ParsedResults, type Semester,
} from '../../../functions/src/shared/examResults';
import type { Organization } from '../../state/OrgContext';

/**
 * Results and transcripts (Andy, 2026-10-24): the principal uploads past cohorts' semester results from
 * Excel, sees every student's Semester 1, Semester 2 and final result, and prints transcripts. New
 * cohorts' semesters are worked out from the trainers' marks sheets as the CATs come in.
 */
export function ResultsAndTranscripts({ org, cohort, sheets, students, courseName }: {
  org: Organization; cohort: string; sheets: ExamSheetRow[]; students: ExamStudent[]; courseName: (id: string) => string;
}) {
  const { settings } = useExamSettings(org.id);
  const { results: cohortResults } = useExamResults(org.id, cohort);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => buildRows(cohort, students, cohortResults, sheets, settings, courseName), [cohort, students, cohortResults, sheets, settings, courseName]);
  const counts = { provisional: rows.filter((r) => r.sems.some((x) => x.provisional)).length, done: rows.filter((r) => r.final.complete).length, incomplete: rows.filter((r) => !r.final.complete).length, differ: rows.filter((r) => printedDiffers(r.printed, r.final.final, settings)).length };
  const byGrade = (g: string) => rows.filter((r) => r.final.grade === g).length;

  async function pdf(list: Row[], title: string) {
    setBusy(true);
    try { downloadFile(await transcriptsPdf({ transcripts: list.map(toTranscript), settings, title })); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  return (
    <section className="stack">
      <section className="card stack">
        <div className="card-head"><h2>Results · {cohort}</h2><span className="muted small">{rows.length} students</span></div>
        <KpiRow label="Final results">
          <KpiCard label="Final result ready" value={String(counts.done)} />
          <KpiCard label="Distinction" value={String(byGrade('Distinction'))} />
          <KpiCard label="Credit" value={String(byGrade('Credit'))} />
          <KpiCard label="Pass" value={String(byGrade('Pass'))} />
          <KpiCard label="Fail" value={String(byGrade('Fail'))} />
          <KpiCard label="Incomplete" value={String(counts.incomplete)} tone={counts.incomplete ? 'warn' : undefined} />
        </KpiRow>
        {counts.provisional > 0 && <p className="notice small">{counts.provisional} {counts.provisional === 1 ? 'student’s semester includes' : 'students’ semesters include'} courses not yet approved; those figures are provisional.</p>}
        {counts.differ > 0 && <p className="notice small">{counts.differ} {counts.differ === 1 ? 'student’s printed graduation-list figure differs' : 'students’ printed graduation-list figures differ'} from the Semester 1 and 2 average. They are marked below for the principal to confirm.</p>}
        {rows.length === 0 ? <p className="muted">No students or results for {cohort} yet. Upload past results under Setup, or set up the cohort's Semester 1 and 2 courses.</p> : (
          <>
            <div className="row-actions no-print">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void pdf(rows, `${cohort} transcripts`)}>{busy ? 'Preparing…' : 'Transcripts for everyone (PDF)'}</button>
              <CsvButton name={`${cohort} results`} csv={() => toCsv(['Admission no', 'Name', 'Programme', 'Semester 1', 'Semester 2', 'Final points', 'Final grade', 'Printed list points', 'Printed list grade', 'Matches printed list'],
                rows.map((r) => [r.admissionNo, r.name, r.programme, r.sems[0].points ?? '', r.sems[1].points ?? '', r.final.final ?? '', r.final.grade, r.printed?.points ?? '', r.printed?.grade ?? '',
                  r.printed ? (printedDiffers(r.printed, r.final.final, settings) ? 'No' : 'Yes') : '']))} />
            </div>
            <div className="exam-table-wrap">
              <table className="table">
                <thead><tr><th>Student</th><th className="num">Sem 1</th><th className="num">Sem 2</th><th className="num">Final</th><th>Grade</th><th>Printed list</th><th className="no-print" /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}<div className="muted small">{r.admissionNo} · {r.programme}</div></td>
                      {r.sems.map((s, i) => <td key={i} className="num">{s.points != null ? <>{s.points}{s.provisional && <div className="muted small">provisional</div>}</> : s.partial != null ? <span className="muted">({s.partial})</span> : '–'}</td>)}
                      <td className="num"><strong>{r.final.final ?? '–'}</strong></td>
                      <td>{r.final.grade === 'Incomplete' ? <span className="badge badge-warn">Incomplete</span> : r.final.grade}</td>
                      <td className="small">{r.printed ? <span className={printedDiffers(r.printed, r.final.final, settings) ? 'up-bad' : 'muted'}>{r.printed.points}{r.printed.grade ? ` ${r.printed.grade}` : ''}{printedDiffers(r.printed, r.final.final, settings) ? ' · check' : ''}</span> : ''}</td>
                      <td className="no-print"><button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void pdf([r], r.name)}>Transcript</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Final points are the average of Semester 1 and Semester 2. A figure in brackets is a running total while CATs are still coming in. Semesters come from past results uploaded under Setup, or from that semester's courses; a semester with a course not yet approved is provisional.</p>
          </>
        )}
      </section>
    </section>
  );
}

interface RowSem extends TranscriptSemester { points: number | null; provisional: boolean }
interface Row { key: string; name: string; admissionNo: string; programme: string; cohort: string; sems: [RowSem, RowSem]; final: ReturnType<typeof finalResult>; printed: ExamResult['printed']; notes: string[] }

function buildRows(cohort: string, students: ExamStudent[], results: ExamResult[], sheets: ExamSheetRow[], settings: ExamSettings, courseName: (id: string) => string): Row[] {
  const byStudent = new Map(results.map((r) => [r.studentId, r]));
  const people: { id: string; name: string; admissionNo: string; courseId: string; programme: string }[] = students.map((s) => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, courseId: s.courseId, programme: s.courseName }));
  for (const r of results) if (!people.some((p) => p.id === r.studentId)) people.push({ id: r.studentId, name: r.studentName, admissionNo: r.admissionNo, courseId: r.courseId ?? '', programme: courseName(r.courseId ?? '') });
  return people.map((p) => {
    const res = byStudent.get(p.id);
    const sem = (n: Semester): RowSem => {
      const saved = res?.semesters[String(n) as '1' | '2'];
      if (saved) return { label: `Semester ${n}`, points: saved.points, partial: null, grade: gradeFor(saved.points, settings).grade, source: 'Past results', courses: [], provisional: false };
      const fromSheets = semesterFromSheets(sheets, { id: p.id, courseId: p.courseId }, n, settings.passMark);
      const provisional = fromSheets.courses.length > 0 && !fromSheets.approved;
      return {
        label: `Semester ${n}`, points: fromSheets.points, partial: fromSheets.partial, grade: fromSheets.points == null ? '' : gradeFor(fromSheets.points, settings).grade,
        source: fromSheets.courses.length ? (provisional ? 'Courses (provisional: not all approved)' : 'Courses') : '', courses: fromSheets.courses, provisional,
      };
    };
    const sems: [RowSem, RowSem] = [sem(1), sem(2)];
    return { key: p.id, name: p.name, admissionNo: p.admissionNo, programme: p.programme, cohort, sems, final: finalResult(sems[0].points, sems[1].points, settings), printed: res?.printed ?? null, notes: res?.notes ?? [] };
  }).sort((a, b) => a.programme.localeCompare(b.programme) || a.admissionNo.localeCompare(b.admissionNo));
}

const toTranscript = (r: Row): Transcript => ({ name: r.name, admissionNo: r.admissionNo, programme: r.programme, cohort: r.cohort, semesters: r.sems, final: r.final, printed: r.printed, notes: r.notes });

/** The principal's upload of past semester results, with a preview before anything is saved. */
export function ResultsUpload({ org, allStudents }: { org: Organization; allStudents: ImportStudent[] }) {
  const toast = useToast();
  const a = useExamAccess();
  const { results: all } = useExamResults(org.id);
  const [file, setFile] = useState<{ name: string; parsed: ParsedResults } | null>(null);
  const [includeHeld, setIncludeHeld] = useState(false);
  const [fixNumbers, setFixNumbers] = useState(true);
  const [saving, setSaving] = useState(false);
  const plan = useMemo(() => (file ? planResultImport(file.parsed, allStudents, { includeHeld }) : null), [file, allStudents, includeHeld]);
  const existing = useMemo(() => new Set(all.map((r) => r.id)), [all]);
  const replacing = plan ? plan.results.filter((r) => existing.has(examResultId(r.studentId, r.cohort))).length : 0;
  const cohorts = plan ? [...new Set(plan.results.map((r) => r.cohort))] : [];
  // Students whose admission number differs from the file only by the year; the file can correct them.
  const taken = new Set(allStudents.map((s) => admissionKey(s.admissionNo)));
  const fixes = plan ? plan.results.filter((r) => r.fileAdmissionNo && !taken.has(admissionKey(r.fileAdmissionNo))) : [];

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { setFile({ name: f.name, parsed: parseResultsWorkbook(await readSpreadsheetSheets(f)) }); } catch (err) { toast.show(friendlyError(err)); }
  }
  async function save() {
    if (!plan || !file) return;
    setSaving(true);
    try {
      const tried = a.canManage && fixNumbers ? fixes : [];
      // A number that can't be corrected never stops the results from saving.
      const outcomes = await Promise.allSettled(tried.map((r) => correctAdmissionNo(org.id, r.studentId, r.fileAdmissionNo!)));
      const fixing = tried.filter((_, i) => outcomes[i]!.status === 'fulfilled');
      if (fixing.length < tried.length) toast.show(`${tried.length - fixing.length} admission numbers could not be corrected; correct them under Students.`);
      if (fixing.length) {
        for (const c of [...new Set(fixing.map((r) => r.cohort))]) {
          const list = fixing.filter((r) => r.cohort === c);
          void logExam(org.id, { action: 'admission', cohort: c, sheetId: null, detail: `Admission numbers corrected from ${file.name}: ${list.map((r) => `${r.admissionNo} → ${r.fileAdmissionNo}`).join(', ')}`.slice(0, 500), byName: a.myName });
        }
      }
      const fixed = new Set(fixing.map((r) => r.studentId));
      await saveExamResults(org.id, plan.results.map((r) => (fixed.has(r.studentId) ? { ...r, admissionNo: r.fileAdmissionNo! } : r)), existing);
      for (const c of cohorts) {
        const n = plan.results.filter((r) => r.cohort === c).length;
        void logExam(org.id, { action: 'upload', cohort: c, sheetId: null, detail: `Semester results for ${n} students uploaded from ${file.name}${replacing ? ' (earlier results replaced)' : ''}`, byName: a.myName });
      }
      toast.show(`Saved results for ${plan.results.length} students${fixing.length ? ` and corrected ${fixing.length} admission numbers` : ''}.`);
      setFile(null);
    } catch (err) { toast.show(friendlyError(err)); } finally { setSaving(false); }
  }

  return (
    <section className="card stack">
      <div className="card-head"><h2>Upload past results from Excel</h2></div>
      <p className="muted small">Use a file with Admission No, Semester and Points columns, like the Upload_Clean sheet in your cohort files. Each result is matched to a student by admission number, and you see everything before it is saved. Saved results are final, and every upload is written to the change log.</p>
      <label className="btn btn-primary align-start">Choose Excel file<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => void choose(e)} /></label>
      {file && plan && (
        <div className="stack">
          <p><strong>{file.name}</strong></p>
          {file.parsed.problems.map((p) => <p key={p} className="up-bad small">{p}</p>)}
          <KpiRow label="What the file holds">
            <KpiCard label="Students matched" value={String(plan.results.length)} />
            <KpiCard label="Semester scores" value={String(plan.semesterCount)} />
            <KpiCard label="Not found in Students" value={String(plan.unmatched.length)} tone={plan.unmatched.length ? 'warn' : undefined} />
            <KpiCard label="Held back" value={String(plan.held.length)} tone={plan.held.length ? 'warn' : undefined} />
          </KpiRow>
          {cohorts.length > 0 && <p className="small">Cohort{cohorts.length > 1 ? 's' : ''}: {cohorts.join(', ')}.{replacing > 0 && ` ${replacing} of these students already have results saved; theirs will be replaced.`}</p>}
          {fixes.length > 0 && (
            <div className="notice stack">
              <p><strong>{fixes.length} admission {fixes.length === 1 ? 'number differs' : 'numbers differ'} from the file only by the year</strong>, for example {fixes[0]!.admissionNo} in Students and {fixes[0]!.fileAdmissionNo} in the file.</p>
              <label className="check"><input type="checkbox" checked={fixNumbers} onChange={(e) => setFixNumbers(e.target.checked)} /> Correct {fixes.length === 1 ? 'it' : 'them'} in Students to match the file</label>
              <details><summary className="small">See the list</summary><ul className="small">{fixes.map((r) => <li key={r.studentId}>{r.studentName}: {r.admissionNo} → {r.fileAdmissionNo}</li>)}</ul></details>
            </div>
          )}
          {plan.held.length > 0 && (
            <details>
              <summary>{plan.held.length} rows held back and not saved</summary>
              <ul className="small">{plan.held.map((h, i) => <li key={i}>{h.admissionNo} {h.name}, Semester {h.semester}{h.points != null ? ` (${h.points})` : ''}: {h.held}</li>)}</ul>
              <label className="check small"><input type="checkbox" checked={includeHeld} onChange={(e) => setIncludeHeld(e.target.checked)} /> Save held rows that have a real score (a 0 or FALSE score is never saved)</label>
            </details>
          )}
          {plan.unmatched.length > 0 && (
            <details>
              <summary>{plan.unmatched.length} rows whose admission number is not in Students</summary>
              <ul className="small">{plan.unmatched.map((u, i) => <li key={i}>{u.admissionNo} {u.name}, Semester {u.semester}</li>)}</ul>
              <p className="muted small">Add these students under Students (or correct the admission number in the file), then upload again.</p>
            </details>
          )}
          {plan.results.some((r) => r.warnings.length) && (
            <details>
              <summary>{plan.results.filter((r) => r.warnings.length).length} students to look at</summary>
              <ul className="small">{plan.results.filter((r) => r.warnings.length).map((r) => <li key={r.studentId + r.cohort}>{r.studentName} ({r.admissionNo}): {r.warnings.join(' ')}</li>)}</ul>
            </details>
          )}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={!plan.results.length || saving} onClick={() => void save()}>{saving ? 'Saving…' : `Save results for ${plan.results.length} students`}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * A trainer's Excel upload for their own marks sheet (Andy, 2026-10-24): download the class list as a
 * template, fill in the CATs and Final, upload it, check the preview and save every mark at once.
 */
export function MarksUpload({ org, sheet, roster, editable, withResit, locked, onSaved }: {
  org: Organization; sheet: ExamSheetRow; roster: ExamStudent[]; editable: boolean; withResit: boolean;
  /** Papers sent and locked for this person: their columns in the file are left out (Andy, 2026-10-25). */
  locked: (ExamComponent | 'resit')[]; onSaved: (detail: string) => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<{ name: string; marks: Record<string, StudentMarks>; changed: number; problems: string[]; unknown: string[]; papers: (ExamComponent | 'resit')[] } | null>(null);
  const used = EXAM_COMPONENTS.filter((c) => sheet.weights[c].wt > 0);
  const cellOf = (v: MarkValue | undefined) => (v == null ? null : typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String });

  async function template() {
    try {
      const { default: writeXlsxFile } = await import('write-excel-file');
      const head = ['Admission No', 'Name', ...used.map((c) => `${EXAM_COMPONENT_LABELS[c]} (out of ${sheet.weights[c].max})`), ...(withResit ? ['Resit (out of 100)'] : [])].map((value) => ({ value, fontWeight: 'bold' as const }));
      const body = roster.map((st) => [{ value: st.admissionNo, type: String }, { value: st.name, type: String },
        ...used.map((c) => cellOf(sheet.marks?.[st.id]?.[c])), ...(withResit ? [cellOf(sheet.marks?.[st.id]?.resit)] : [])]);
      const blob = await writeXlsxFile([head, ...body] as never, { columns: [{ width: 24 }, { width: 32 }, ...used.map(() => ({ width: 16 })), ...(withResit ? [{ width: 16 }] : [])], sheet: 'Marks' } as never) as unknown as Blob;
      downloadFile(new File([blob], `${(sheet.courseName || 'Marks').replace(/[^A-Za-z0-9]+/g, '-')}-${sheet.cohort.replace(/[^A-Za-z0-9]+/g, '-')}-marks.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (err) { toast.show(friendlyError(err)); }
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = parseMarksFile(await readSpreadsheetSheets(f));
      const byAdm = new Map(roster.map((st) => [admissionKey(st.admissionNo), st]));
      const byName = new Map(roster.map((st) => [st.name.toLowerCase().replace(/\s+/g, ' ').trim(), st]));
      const marks: Record<string, StudentMarks> = JSON.parse(JSON.stringify(sheet.marks ?? {}));
      const problems = [...parsed.problems];
      const unknown: string[] = [];
      let changed = 0;
      const skipped = parsed.columns.filter((c) => locked.includes(c));
      for (const c of skipped) problems.push(`${c === 'resit' ? 'Resit' : EXAM_COMPONENT_LABELS[c]} is sent and locked, so that column was left as it is.`);
      const papers = parsed.columns.filter((c) => !locked.includes(c) && (c === 'resit' || sheet.weights[c as ExamComponent].wt > 0));
      for (const r of parsed.rows) {
        const st = (r.admissionNo && byAdm.get(admissionKey(r.admissionNo))) || byName.get(r.name.toLowerCase());
        if (!st) { unknown.push(`${r.admissionNo || ''} ${r.name}`.trim()); continue; }
        for (const p of r.problems) problems.push(`${st.name}: ${p}`);
        for (const c of papers) {
          if (!(c in r.marks)) continue;
          const v = r.marks[c] ?? null;
          if (c !== 'resit' && sheet.weights[c as ExamComponent].wt <= 0) continue;
          const label = c === 'resit' ? 'Resit' : EXAM_COMPONENT_LABELS[c];
          const bad = markProblem(v, c === 'resit' ? 100 : sheet.weights[c].max);
          if (bad) { problems.push(`${st.name}, ${label}: ${bad}`); continue; }
          if ((marks[st.id]?.[c] ?? null) !== v) { marks[st.id] = { ...(marks[st.id] ?? {}), [c]: v }; changed++; }
        }
      }
      setPreview({ name: f.name, marks, changed, problems, unknown, papers });
    } catch (err) { toast.show(friendlyError(err)); }
  }

  function save() {
    if (!preview) return;
    saveExamMarks(org.id, sheet.id, preview.marks, preview.papers).then(() => toast.show(`${preview.changed} marks saved.`), (err) => toast.show(friendlyError(err)));
    onSaved(`${preview.changed} marks uploaded from ${preview.name}`);
    setPreview(null);
  }

  return (
    <section className="card stack no-print">
      <div className="card-head"><h2>Upload marks from Excel</h2></div>
      <p className="muted small">Download the class list, fill in the marks in Excel (a number, ABS or EX), and upload it. Totals and grades work themselves out as each CAT comes in. Blank boxes are left as they are.</p>
      <div className="row-actions">
        <button type="button" className="btn btn-quiet" onClick={() => void template()}>Download class list (Excel)</button>
        {editable && <label className="btn btn-primary">Upload marks<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => void choose(e)} /></label>}
      </div>
      {preview && (
        <div className="stack">
          <p><strong>{preview.name}</strong>: {preview.changed} {preview.changed === 1 ? 'mark' : 'marks'} to save.</p>
          {preview.problems.length > 0 && <details open><summary className="up-bad">{preview.problems.length} {preview.problems.length === 1 ? 'mark was' : 'marks were'} not taken</summary><ul className="small">{preview.problems.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}</ul></details>}
          {preview.unknown.length > 0 && <details><summary>{preview.unknown.length} rows not on this class list</summary><ul className="small">{preview.unknown.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}</ul></details>}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={!preview.changed} onClick={save}>Save {preview.changed} marks</button>
            <button type="button" className="btn btn-quiet" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

