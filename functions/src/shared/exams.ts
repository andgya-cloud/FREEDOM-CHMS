/**
 * ADIA Exam Records, from Andy's ADIA Results System: each trainer keys in their own marks sheet
 * (one course, CAT 1 to 3 and a Final, each marked out of its own figure and worth its own
 * percentage), submits it to lock it, and the principal compiles a report per programme with the
 * common courses, edits remarks and attendance, and prints result slips.
 */

export const EXAM_COMPONENTS = ['cat1', 'cat2', 'cat3', 'final'] as const;
export type ExamComponent = (typeof EXAM_COMPONENTS)[number];
export const EXAM_COMPONENT_LABELS: Record<ExamComponent, string> = { cat1: 'CAT 1', cat2: 'CAT 2', cat3: 'CAT 3', final: 'Final' };

/** "Marked out of" and "percentage it is worth" for each paper. A paper worth 0% is not used. */
export type ExamWeights = Record<ExamComponent, { max: number; wt: number }>;
export const DEFAULT_EXAM_WEIGHTS: ExamWeights = {
  cat1: { max: 100, wt: 10 }, cat2: { max: 100, wt: 10 }, cat3: { max: 100, wt: 10 }, final: { max: 100, wt: 70 },
};

/** A paper's mark: a number, ABS (absent, counts as 0) or EX (exempt, left out of the weighting). */
export type MarkValue = number | 'ABS' | 'EX' | null;
export const ABSENT = 'ABS';
export const EXEMPT = 'EX';
/** A student's papers, and a resit mark out of 100 for a failed course (Andy, 2026-10-24). */
export type StudentMarks = Partial<Record<ExamComponent, MarkValue>> & { resit?: number | null };

/** Draft (the trainer keys in), submitted (waiting for the principal), approved (final). */
export type ExamSheetStatus = 'draft' | 'submitted' | 'approved';
export const EXAM_STATUS_LABELS: Record<ExamSheetStatus, string> = { draft: 'Marking', submitted: 'Waiting for approval', approved: 'Approved' };

/** Reads what a trainer typed: a number, ABS, EX, or blank. Anything else is a problem. */
export function parseMark(text: unknown): { value: MarkValue; problem: string | null } {
  if (typeof text === 'number') return Number.isFinite(text) ? { value: text, problem: null } : { value: null, problem: 'Type a number.' };
  const t = String(text ?? '').trim();
  if (t === '') return { value: null, problem: null };
  const u = t.toUpperCase().replace(/[^A-Z]/g, '');
  if (u === 'ABS' || u === 'ABSENT' || u === 'A') return { value: ABSENT, problem: null };
  if (u === 'EX' || u === 'EXEMPT' || u === 'E') return { value: EXEMPT, problem: null };
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(t.replace(/,/g, '')) ? { value: n, problem: null } : { value: null, problem: `"${t}" is not a mark. Type a number, ABS or EX.` };
}
export const markText = (v: MarkValue | undefined) => (v == null ? '' : String(v));
export interface ExamSheet {
  id: string;
  /** The intake name every programme shares, such as "September 2026". */
  cohort: string;
  /** The programme (course) it belongs to; null for a common course every student takes. */
  courseId: string | null;
  ownerUid: string;
  ownerName: string;
  courseName: string;
  teacherName: string;
  weights: ExamWeights;
  status: ExamSheetStatus;
  marks: Record<string, StudentMarks>;
  /** Which semester the course belongs to; its totals make up that semester's points. */
  semester?: 1 | 2 | null;
  /** Why the principal sent it back, shown to the trainer. */
  returnNote?: string | null;
  approvedByName?: string | null;
  /** Papers the trainer has sent to the principal: locked until the principal unlocks them (Andy, 2026-10-25). */
  locked?: Partial<Record<ExamComponent, boolean>>;
  /** The trainer's request to change a sent paper, waiting for the principal. */
  changeRequest?: ExamChangeRequest | null;
  deletedAt?: unknown;
}
export interface ExamChangeRequest { component: ExamComponent; reason: string; byName: string }

/**
 * Since 2026-10-25 each paper's marks are kept in their own field (cat1Marks, ..., finalMarks,
 * resitMarks), so a sent paper can be locked by the server on its own. Older sheets keep `marks`;
 * the per-paper fields go on top of it.
 */
export const MARK_FIELDS = { cat1: 'cat1Marks', cat2: 'cat2Marks', cat3: 'cat3Marks', final: 'finalMarks', resit: 'resitMarks' } as const;
export type MarkField = keyof typeof MARK_FIELDS;
export function mergedMarks(raw: Partial<Record<string, unknown>> & { marks?: Record<string, StudentMarks> }): Record<string, StudentMarks> {
  const out: Record<string, StudentMarks> = {};
  for (const [id, m] of Object.entries(raw.marks ?? {})) out[id] = { ...m };
  for (const [f, field] of Object.entries(MARK_FIELDS) as [MarkField, string][]) {
    const map = raw[field];
    if (!map || typeof map !== 'object') continue;
    for (const [id, v] of Object.entries(map as Record<string, MarkValue>)) out[id] = { ...(out[id] ?? {}), [f]: v };
  }
  return out;
}
export const isLocked = (sheet: Pick<ExamSheet, 'locked'>, c: ExamComponent) => sheet.locked?.[c] === true;
/** The papers that count for this course (worth more than 0%). */
export const usedComponents = (w: ExamWeights) => EXAM_COMPONENTS.filter((c) => w[c].wt > 0 && w[c].max > 0);

export interface GradeBand { min: number; grade: string; remark: string }
export interface ExamSettings {
  passMark: number;
  /** Checked from the top: the first band whose minimum the average reaches. */
  bands: GradeBand[];
  principalName: string;
  principalTitle: string;
  directorName: string;
  directorTitle: string;
  /** ADIA's one weighting for every course (Andy, 2026-10-24); trainers cannot change it. */
  weights: ExamWeights;
}
/** ADIA's grade bands (Andy, 2026-10-24): Distinction 79 and above, Credit above 59, Pass 39 to 59, Fail below 39. */
export const ADIA_BANDS: GradeBand[] = [
  { min: 79, grade: 'Distinction', remark: 'Outstanding performance' },
  { min: 59.01, grade: 'Credit', remark: 'Very good performance' },
  { min: 39, grade: 'Pass', remark: 'Satisfactory performance' },
  { min: 0, grade: 'Fail', remark: 'Below pass mark; resit required' },
];
export const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  passMark: 39,
  bands: ADIA_BANDS,
  principalName: 'Flavier Akinyichange',
  principalTitle: 'Principal',
  directorName: 'Andrew Guya',
  directorTitle: 'Director',
  weights: DEFAULT_EXAM_WEIGHTS,
};

export function examSettingsWithDefaults(raw: Partial<ExamSettings> | null | undefined): ExamSettings {
  const s = { ...DEFAULT_EXAM_SETTINGS, ...(raw ?? {}) };
  const bands = Array.isArray(s.bands) && s.bands.length ? [...s.bands].sort((a, b) => b.min - a.min) : DEFAULT_EXAM_SETTINGS.bands;
  const weights = s.weights && EXAM_COMPONENTS.every((c) => s.weights[c] && typeof s.weights[c].max === 'number') ? s.weights : DEFAULT_EXAM_WEIGHTS;
  return { ...s, bands, weights };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Why a sheet's papers can't be used, or null when they are fine. */
export function weightsProblem(w: ExamWeights): string | null {
  let sum = 0;
  for (const c of EXAM_COMPONENTS) {
    const { max, wt } = w[c];
    if (!(max > 0) || max > 1000) return `${EXAM_COMPONENT_LABELS[c]}: "marked out of" must be between 1 and 1000.`;
    if (!(wt >= 0) || wt > 100) return `${EXAM_COMPONENT_LABELS[c]}: the percentage must be between 0 and 100.`;
    sum += wt;
  }
  return sum <= 0 ? 'At least one paper must be worth more than 0%.' : null;
}

/** Why a typed mark can't be saved, or null when it is fine. */
export function markProblem(value: MarkValue | undefined, max: number): string | null {
  if (value == null || value === ABSENT || value === EXEMPT) return null;
  if (!Number.isFinite(value) || value < 0) return 'Marks cannot be negative.';
  if (value > max) return `The most for this paper is ${max}.`;
  return null;
}

export interface UnitTotal {
  /** Out of 100, once every paper that counts has a mark. */
  total: number | null;
  /** Out of 100 from the papers marked so far. */
  partial: number | null;
  complete: boolean;
  filled: number;
  needed: number;
  /** Every paper is EX: the course is left out of the student's average. */
  exempt: boolean;
  /** The resit mark replaced a failed total (capped at the pass mark). */
  resitUsed: boolean;
}

/**
 * Σ (mark ÷ out-of × percentage) ÷ Σ percentages × 100. ABS counts as 0; an EX paper is left out of
 * the weighting. With a pass mark, a resit replaces a failed total, but never above the pass mark.
 */
export function unitTotal(weights: ExamWeights, m: StudentMarks | null | undefined, passMark?: number): UnitTotal {
  let sumWt = 0, acc = 0, complete = true, filled = 0, needed = 0, used = 0;
  for (const c of EXAM_COMPONENTS) {
    const { max, wt } = weights[c];
    if (!(wt > 0) || !(max > 0)) continue;
    used++;
    const v = m?.[c];
    if (v === EXEMPT) continue;
    needed++;
    sumWt += wt;
    if (v == null) { complete = false; continue; }
    filled++;
    if (typeof v === 'number') acc += (v / max) * wt;
  }
  const exempt = used > 0 && needed === 0;
  if (sumWt <= 0) return { total: null, partial: null, complete: exempt, filled, needed, exempt, resitUsed: false };
  // Nothing keyed in yet: no running total either.
  const partial = filled ? round1((acc / sumWt) * 100) : null;
  let total = complete ? partial : null;
  let resitUsed = false;
  const resit = m?.resit;
  if (total != null && passMark != null && total < passMark && typeof resit === 'number' && Number.isFinite(resit)) {
    const r = Math.min(resit, passMark);
    if (r > total) { total = round1(r); resitUsed = true; }
  }
  return { total, partial: resitUsed ? total : partial, complete, filled, needed, exempt, resitUsed };
}

export function gradeFor(avg: number | null, settings: Pick<ExamSettings, 'bands'>): { grade: string; remark: string } {
  if (avg == null || Number.isNaN(avg)) return { grade: '', remark: '' };
  for (const b of settings.bands) if (avg >= b.min) return { grade: b.grade, remark: b.remark };
  return { grade: '', remark: '' };
}

/** Standard competition ranking: ties share a position, the next one skips. */
export function rankOf(values: (number | null)[]): (number | null)[] {
  return values.map((v) => (v == null ? null : 1 + values.filter((o) => o != null && o > v).length));
}

export interface ExamStudent { id: string; name: string; admissionNo: string; courseId: string; courseName: string }

export interface ReportCell extends StudentMarks { total: number | null; partial: number | null; complete: boolean; grade: string; exempt: boolean; resitUsed: boolean }
export interface ReportRow {
  studentId: string;
  name: string;
  admissionNo: string;
  programme: string;
  cells: Record<string, ReportCell>;
  total: number | null;
  average: number | null;
  grade: string;
  remarks: string;
  remarksAuto: string;
  remarksEdited: boolean;
  attendance: number | null;
  missing: number;
  position: number | null;
  /** Some of the student's courses are not approved yet. */
  provisional: boolean;
}
export interface ReportUnit { sheetId: string; courseName: string; teacherName: string; status: ExamSheetStatus; common: boolean; weights: ExamWeights }
export interface ExamReport { units: ReportUnit[]; rows: ReportRow[] }

export interface ReportMeta { remarks?: Record<string, Record<string, string>>; attendance?: Record<string, number | null> }

/** Where a report's remarks are kept: the programme's id, or "common". */
export const scopeKey = (courseId: string | null) => courseId ?? 'common';

/**
 * The compiled report for one programme (its own courses and then the common courses, for the
 * students of that programme) or, with courseId null, the common courses for every student.
 */
export function buildExamReport(courseId: string | null, sheets: readonly ExamSheet[], students: readonly ExamStudent[], settings: ExamSettings, meta: ReportMeta = {}): ExamReport {
  const live = sheets.filter((s) => !s.deletedAt);
  const own = courseId == null ? [] : live.filter((s) => s.courseId === courseId);
  const common = live.filter((s) => s.courseId == null);
  const all = [...own, ...common];
  const roster = (courseId == null ? [...students] : students.filter((s) => s.courseId === courseId)).sort((a, b) => a.name.localeCompare(b.name));
  const remarks = meta.remarks?.[scopeKey(courseId)] ?? {};

  const rows: ReportRow[] = roster.map((st) => {
    const cells: Record<string, ReportCell> = {};
    const totals: number[] = [];
    let missing = 0;
    for (const sh of all) {
      const m = sh.marks?.[st.id] ?? null;
      const u = unitTotal(sh.weights, m, settings.passMark);
      cells[sh.id] = { ...(m ?? {}), total: u.total, partial: u.partial, complete: u.complete, grade: u.total == null ? '' : gradeFor(u.total, settings).grade, exempt: u.exempt, resitUsed: u.resitUsed };
      if (u.exempt) continue;
      if (u.total == null) missing++; else totals.push(u.total);
    }
    const sum = totals.reduce((a, b) => a + b, 0);
    const average = totals.length ? round1(sum / totals.length) : null;
    const g = gradeFor(average, settings);
    const auto = average == null ? '' : missing ? `${g.remark}. ${missing} ${missing === 1 ? 'unit' : 'units'} not yet marked` : g.remark;
    const edited = typeof remarks[st.id] === 'string' && remarks[st.id] !== '';
    const att = meta.attendance?.[st.id];
    return {
      studentId: st.id, name: st.name, admissionNo: st.admissionNo, programme: st.courseName,
      cells, total: totals.length ? round1(sum) : null, average, grade: g.grade,
      remarks: edited ? remarks[st.id]! : auto, remarksAuto: auto, remarksEdited: edited,
      attendance: typeof att === 'number' ? att : null, missing, position: null,
      provisional: all.some((sh) => sh.status !== 'approved'),
    };
  });
  const positions = rankOf(rows.map((r) => r.average));
  rows.forEach((r, i) => { r.position = positions[i] ?? null; });
  const unit = (s: ExamSheet, isCommon: boolean): ReportUnit => ({
    sheetId: s.id, courseName: s.courseName || '(course name not set)', teacherName: s.teacherName || '(trainer not set)',
    status: s.status, common: isCommon, weights: s.weights,
  });
  return { units: [...own.map((s) => unit(s, false)), ...common.map((s) => unit(s, true))], rows };
}

/** How much of a sheet has been keyed in: marks entered out of marks needed for its roster. */
export function sheetProgress(sheet: Pick<ExamSheet, 'weights' | 'marks'>, rosterIds: readonly string[]): number {
  // ABS and EX count as entered.
  const needed = EXAM_COMPONENTS.filter((c) => sheet.weights[c].wt > 0 && sheet.weights[c].max > 0);
  const cells = rosterIds.length * needed.length;
  if (!cells) return 0;
  let filled = 0;
  for (const id of rosterIds) for (const c of needed) if (sheet.marks?.[id]?.[c] != null) filled++;
  return Math.round((filled / cells) * 100);
}

/** Out of 100 on the papers marked so far only (8 of 10 in CAT 1 alone is 80), or null with none marked. */
export function markedSoFar(weights: ExamWeights, m: StudentMarks | null | undefined): number | null {
  let wt = 0, acc = 0;
  for (const c of usedComponents(weights)) {
    const v = m?.[c];
    if (v == null || v === EXEMPT) continue;
    wt += weights[c].wt;
    if (typeof v === 'number') acc += (v / weights[c].max) * weights[c].wt;
  }
  return wt > 0 ? round1((acc / wt) * 100) : null;
}

export interface DepartmentRow { studentId: string; name: string; admissionNo: string; marked: number; courses: number; soFar: number | null; grade: string; position: number | null; complete: boolean }
export interface DepartmentSummary { rows: DepartmentRow[]; classAverage: number | null; passed: number; graded: number; byGrade: Record<string, number>; courses: number; provisional: boolean }

/**
 * One department (programme) of a cohort so far (Andy, 2026-10-25): each student's average over their
 * courses (the programme's and the common ones, both semesters). A course whose papers are not all in
 * counts on the papers marked so far, so the figure moves as each CAT is keyed in.
 */
export function departmentSummary(courseId: string, sheets: readonly ExamSheet[], students: readonly ExamStudent[], settings: ExamSettings): DepartmentSummary {
  const all = sheets.filter((s) => !s.deletedAt && (s.courseId === courseId || s.courseId == null));
  const roster = students.filter((s) => s.courseId === courseId).sort((a, b) => a.name.localeCompare(b.name));
  const byGrade: Record<string, number> = Object.fromEntries(settings.bands.map((b) => [b.grade, 0]));
  let anyPartial = false;
  const rows: DepartmentRow[] = roster.map((st) => {
    const values: number[] = [];
    let courses = 0, complete = true;
    for (const sh of all) {
      const u = unitTotal(sh.weights, sh.marks?.[st.id] ?? null, settings.passMark);
      if (u.exempt) continue;
      courses++;
      const v = u.total ?? markedSoFar(sh.weights, sh.marks?.[st.id]);
      if (u.total == null) complete = false;
      if (v != null) values.push(v);
    }
    if (!complete) anyPartial = true;
    const soFar = values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
    const grade = gradeFor(soFar, settings).grade;
    if (grade) byGrade[grade] = (byGrade[grade] ?? 0) + 1;
    return { studentId: st.id, name: st.name, admissionNo: st.admissionNo, marked: values.length, courses, soFar, grade, position: null, complete: complete && courses > 0 };
  });
  rankOf(rows.map((r) => r.soFar)).forEach((p, i) => { rows[i]!.position = p; });
  const graded = rows.filter((r) => r.soFar != null);
  const classAverage = graded.length ? round1(graded.reduce((t, r) => t + r.soFar!, 0) / graded.length) : null;
  return {
    rows, classAverage, graded: graded.length, passed: graded.filter((r) => r.soFar! >= settings.passMark).length, byGrade, courses: all.length,
    provisional: anyPartial || all.some((s) => s.status !== 'approved'),
  };
}
