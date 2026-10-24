/**
 * Semester results and transcripts (Andy, 2026-10-24). Past cohorts come from Excel as one points
 * score per student per semester; new cohorts build each semester's points from the trainers'
 * marks sheets (the plain average of the student's course totals). The final result is the average
 * of Semester 1 and Semester 2, graded on ADIA's bands; a missing semester makes it Incomplete.
 */
import { gradeFor, unitTotal, type ExamSettings, type ExamSheet, type StudentMarks } from './exams.js';

export type Cell = string | number | Date | boolean | null | undefined;
export const SEMESTERS = [1, 2] as const;
export type Semester = (typeof SEMESTERS)[number];

export interface SemesterScore { points: number; grade: string | null }
/** organizations/{org}/examResults/{studentId}_{cohortKey}: one student's past results for one cohort. */
export interface ExamResult {
  cohort: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  courseId: string | null;
  semesters: Partial<Record<'1' | '2', SemesterScore>>;
  /** The figure on the printed graduation list, kept beside the worked-out final. */
  printed: SemesterScore | null;
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const key = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v: Cell) => (v instanceof Date ? '' : String(v ?? '').replace(/\s+/g, ' ').trim());
const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = text(v).replace(/,/g, '');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** "ADIA/ CTR/2025/1/001" and "adia/ctr/2025/1/001" are the same admission number. */
export const admissionKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/\s+/g, '');
/** 1, "1", "Cohort 1" → "Cohort 1"; anything else is kept as typed. */
export const cohortName = (v: Cell) => { const t = text(v); return /^\d+$/.test(t) ? `Cohort ${t}` : t; };
const semesterOf = (v: Cell): Semester | null => { const m = /([12])\s*$/.exec(text(v)); return m ? (Number(m[1]) as Semester) : null; };

export interface ParsedResultRow {
  sheet: string;
  cohort: string;
  programme: string;
  admissionNo: string;
  name: string;
  semester: Semester;
  points: number | null;
  grade: string | null;
  /** Why the file held this row back for review, when it did. */
  held: string | null;
}
export interface ParsedResults { rows: ParsedResultRow[]; printed: Map<string, SemesterScore>; problems: string[] }

const COLS = {
  admission: ['admissionno', 'admissionnumber', 'admno', 'regno', 'registrationno', 'studentno'],
  name: ['studentname', 'name', 'fullname', 'student'],
  semester: ['semester', 'sem', 'term'],
  points: ['points', 'score', 'marks', 'average'],
  grade: ['grade', 'gradeasinsource'],
  cohort: ['cohort', 'intake'],
  programme: ['programme', 'programmecode', 'program', 'course'],
  reason: ['reasonheldback', 'reason'],
  printedPoints: ['printedgradlistpoints', 'printedpoints', 'graduationlistpoints'],
  printedGrade: ['printedgradlistgrade', 'printedgrade', 'graduationlistgrade'],
} as const;

function columns(head: Cell[]) {
  const ks = head.map(key);
  const find = (names: readonly string[]) => { for (const n of names) { const i = ks.indexOf(n); if (i >= 0) return i; } return -1; };
  return Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, find(names)])) as Record<keyof typeof COLS, number>;
}

/**
 * Reads a results workbook. A sheet with Admission No, Semester and Points columns gives semester
 * rows ("Upload_All" is skipped when "Upload_Clean" is there, as it repeats it); a sheet named like
 * "Hold..." marks its rows as held back; a column of printed graduation-list points is kept too.
 */
export function parseResultsWorkbook(sheets: { name: string; rows: Cell[][] }[]): ParsedResults {
  const rows: ParsedResultRow[] = [];
  const printed = new Map<string, SemesterScore>();
  const problems: string[] = [];
  const hasClean = sheets.some((s) => key(s.name) === 'uploadclean');
  for (const sh of sheets) {
    if (hasClean && key(sh.name) === 'uploadall') continue;
    const at = sh.rows.slice(0, 10).findIndex((r) => columns(r).admission >= 0);
    if (at < 0) continue;
    const c = columns(sh.rows[at]!);
    const heldSheet = /hold|review/i.test(sh.name);
    if (c.printedPoints >= 0) {
      for (const r of sh.rows.slice(at + 1)) {
        const adm = admissionKey(r[c.admission]);
        const p = num(r[c.printedPoints]);
        if (adm && p != null) printed.set(adm, { points: round2(p), grade: c.printedGrade >= 0 ? text(r[c.printedGrade]) || null : null });
      }
    }
    if (c.semester < 0 || c.points < 0) continue;
    sh.rows.slice(at + 1).forEach((r, i) => {
      const adm = text(r[c.admission]);
      if (!adm) return;
      const semester = semesterOf(r[c.semester]);
      if (!semester) { problems.push(`${sh.name} row ${at + i + 2}: the semester "${text(r[c.semester])}" is not 1 or 2.`); return; }
      const p = num(r[c.points]);
      const grade = c.grade >= 0 ? text(r[c.grade]) || null : null;
      const bad = p == null || (p === 0 && (grade == null || /false/i.test(grade)));
      rows.push({
        sheet: sh.name, cohort: c.cohort >= 0 ? cohortName(r[c.cohort]) : '', programme: c.programme >= 0 ? text(r[c.programme]) : '',
        admissionNo: adm, name: c.name >= 0 ? text(r[c.name]) : '', semester, points: p == null ? null : round2(p), grade,
        held: heldSheet ? (c.reason >= 0 ? text(r[c.reason]) : '') || 'Held for review in the file' : bad ? 'No usable score' : null,
      });
    });
  }
  if (!rows.length) problems.push('No results found. The file needs columns for Admission No, Semester and Points (like the Upload_Clean sheet).');
  return { rows, printed, problems };
}

export interface ImportStudent { id: string; admissionNo: string; name: string; courseId: string; cohort: string }
export interface PlannedResult extends ExamResult { warnings: string[] }
export interface ResultPlan {
  results: PlannedResult[];
  /** Rows whose admission number is not in Students. */
  unmatched: ParsedResultRow[];
  /** Rows held back and not saved (unless the person chose to include them). */
  held: ParsedResultRow[];
  semesterCount: number;
}

/** Matches every row to a student by admission number and groups them into one result per student and cohort. */
export function planResultImport(parsed: ParsedResults, students: readonly ImportStudent[], opts: { includeHeld?: boolean } = {}): ResultPlan {
  const byAdm = new Map(students.map((s) => [admissionKey(s.admissionNo), s]));
  const out = new Map<string, PlannedResult>();
  const unmatched: ParsedResultRow[] = [];
  const held: ParsedResultRow[] = [];
  let semesterCount = 0;
  for (const r of parsed.rows) {
    const st = byAdm.get(admissionKey(r.admissionNo));
    if (!st) { unmatched.push(r); continue; }
    const usable = r.points != null && r.points > 0;
    if (r.held && !(opts.includeHeld && usable)) { held.push(r); continue; }
    if (r.points == null) { held.push(r); continue; }
    const cohort = r.cohort || st.cohort;
    const id = `${st.id}|${cohort}`;
    let res = out.get(id);
    if (!res) {
      res = { cohort, studentId: st.id, admissionNo: st.admissionNo, studentName: st.name, courseId: st.courseId || null, semesters: {}, printed: parsed.printed.get(admissionKey(r.admissionNo)) ?? null, notes: [], warnings: [] };
      if (st.cohort && cohort !== st.cohort) res.warnings.push(`Students lists ${st.name} in ${st.cohort}, the file says ${cohort}.`);
      out.set(id, res);
    }
    const k = String(r.semester) as '1' | '2';
    if (res.semesters[k] && res.semesters[k]!.points !== r.points) res.warnings.push(`Semester ${r.semester} appears twice (${res.semesters[k]!.points} and ${r.points}); the last one is kept.`);
    if (!res.semesters[k]) semesterCount++;
    res.semesters[k] = { points: r.points, grade: r.grade };
    if (r.held) res.notes.push(`Semester ${r.semester}: ${r.held}`.slice(0, 200));
  }
  for (const res of out.values()) {
    for (const s of SEMESTERS) if (!res.semesters[String(s) as '1' | '2']) res.warnings.push(`No Semester ${s} score: the final result will show Incomplete.`);
    const held1 = held.filter((h) => byAdm.get(admissionKey(h.admissionNo))?.id === res.studentId);
    for (const h of held1) res.notes.push(`Semester ${h.semester} held back: ${h.held}`.slice(0, 200));
  }
  return { results: [...out.values()].sort((a, b) => a.admissionNo.localeCompare(b.admissionNo)), unmatched, held, semesterCount };
}

export interface FinalResult { sem1: number | null; sem2: number | null; final: number | null; grade: string; remark: string; complete: boolean }

/** Average of Semester 1 and Semester 2 to 2 decimals; Incomplete until both are in. */
export function finalResult(sem1: number | null, sem2: number | null, settings: Pick<ExamSettings, 'bands'>): FinalResult {
  if (sem1 == null || sem2 == null) return { sem1, sem2, final: null, grade: 'Incomplete', remark: 'A semester result is missing', complete: false };
  const final = round2((sem1 + sem2) / 2);
  return { sem1, sem2, final, ...gradeFor(final, settings), complete: true };
}

/**
 * True when the printed graduation list gives a different grade from the worked-out final (as the
 * cohort files' "Matches printed list?" column does); with no printed grade, when the points differ.
 */
export function printedDiffers(printed: SemesterScore | null | undefined, final: number | null, settings: Pick<ExamSettings, 'bands'>) {
  if (!printed || final == null) return false;
  if (printed.grade) return printed.grade.trim().toLowerCase() !== gradeFor(final, settings).grade.toLowerCase();
  return Math.abs(printed.points - final) > 0.05;
}

export interface CourseLine { sheetId: string; courseName: string; teacherName: string; total: number | null; partial: number | null; complete: boolean }
export interface SemesterFromSheets { courses: CourseLine[]; points: number | null; partial: number | null; complete: boolean }

/**
 * A student's semester worked out from the marks sheets set to that semester: the plain average of
 * their course totals. `partial` grows as each CAT comes in; `points` is set once every course is complete.
 */
export type SemesterSheet = Pick<ExamSheet, 'id' | 'courseId' | 'courseName' | 'teacherName' | 'weights' | 'marks'> & { semester?: number | null };
export function semesterFromSheets(sheets: readonly SemesterSheet[], student: { id: string; courseId: string }, semester: Semester): SemesterFromSheets {
  const mine = sheets.filter((s) => s.semester === semester && (s.courseId == null || s.courseId === student.courseId));
  const courses = mine.map((s) => {
    const u = unitTotal(s.weights, (s.marks?.[student.id] ?? null) as StudentMarks | null);
    return { sheetId: s.id, courseName: s.courseName, teacherName: s.teacherName, total: u.total, partial: u.partial, complete: u.complete };
  });
  const parts = courses.map((c) => c.partial).filter((p): p is number => p != null);
  const complete = courses.length > 0 && courses.every((c) => c.complete);
  return {
    courses,
    partial: parts.length ? round2(parts.reduce((a, b) => a + b, 0) / parts.length) : null,
    points: complete ? round2(courses.reduce((a, c) => a + (c.total ?? 0), 0) / courses.length) : null,
    complete,
  };
}

export type MarkColumn = 'cat1' | 'cat2' | 'cat3' | 'final';
export interface ParsedMarkRow { row: number; admissionNo: string; name: string; marks: Partial<Record<MarkColumn, number | null>>; problems: string[] }

const MARK_COLS: Record<MarkColumn, string[]> = {
  cat1: ['cat1', 'cat01', 'test1', 'assignment1'],
  cat2: ['cat2', 'cat02', 'test2', 'assignment2'],
  cat3: ['cat3', 'cat03', 'test3', 'assignment3'],
  final: ['final', 'finalexam', 'exam', 'endterm', 'endtermexam', 'endofterm', 'finalmark'],
};

/** Reads a trainer's marks file: Admission No (or Name) and any of CAT 1, CAT 2, CAT 3 and Final. */
export function parseMarksFile(sheets: { name: string; rows: Cell[][] }[]): { rows: ParsedMarkRow[]; columns: MarkColumn[]; problems: string[] } {
  for (const sh of sheets) {
    const at = sh.rows.slice(0, 10).findIndex((r) => { const ks = r.map(key); return Object.values(MARK_COLS).some((names) => names.some((n) => ks.includes(n))); });
    if (at < 0) continue;
    const ks = sh.rows[at]!.map(key);
    const adm = COLS.admission.map((n) => ks.indexOf(n)).find((i) => i >= 0) ?? -1;
    const nm = COLS.name.map((n) => ks.indexOf(n)).find((i) => i >= 0) ?? -1;
    if (adm < 0 && nm < 0) return { rows: [], columns: [], problems: ['The file needs an Admission No or a Name column.'] };
    const cols = (Object.keys(MARK_COLS) as MarkColumn[]).map((c) => [c, MARK_COLS[c].map((n) => ks.indexOf(n)).find((i) => i >= 0) ?? -1] as const).filter(([, i]) => i >= 0);
    const rows: ParsedMarkRow[] = [];
    sh.rows.slice(at + 1).forEach((r, i) => {
      const a = adm >= 0 ? text(r[adm]) : '';
      const n = nm >= 0 ? text(r[nm]) : '';
      if (!a && !n) return;
      const marks: Partial<Record<MarkColumn, number | null>> = {};
      const problems: string[] = [];
      for (const [c, idx] of cols) {
        const raw = r[idx];
        if (text(raw) === '') continue;
        const v = num(raw);
        if (v == null) problems.push(`"${text(raw)}" is not a number`);
        else marks[c] = v;
      }
      rows.push({ row: at + i + 2, admissionNo: a, name: n, marks, problems });
    });
    return { rows, columns: cols.map(([c]) => c), problems: [] };
  }
  return { rows: [], columns: [], problems: ['No marks found. The file needs columns such as Admission No, CAT 1, CAT 2, CAT 3 and Final.'] };
}

export { ADIA_BANDS } from './exams.js';
