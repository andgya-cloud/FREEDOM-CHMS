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

export type StudentMarks = Partial<Record<ExamComponent, number | null>>;

export type ExamSheetStatus = 'draft' | 'submitted';
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
  deletedAt?: unknown;
}

export interface GradeBand { min: number; grade: string; remark: string }
export interface ExamSettings {
  passMark: number;
  /** Checked from the top: the first band whose minimum the average reaches. */
  bands: GradeBand[];
  principalName: string;
  principalTitle: string;
  directorName: string;
  directorTitle: string;
}
export const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  passMark: 70,
  bands: [
    { min: 85, grade: 'Distinction', remark: 'Outstanding performance' },
    { min: 78, grade: 'Credit', remark: 'Very good performance' },
    { min: 70, grade: 'Pass', remark: 'Satisfactory performance' },
    { min: 0, grade: 'Fail', remark: 'Below pass mark; resit required' },
  ],
  principalName: 'Flavier Akinyichange',
  principalTitle: 'Principal',
  directorName: 'Andrew Guya',
  directorTitle: 'Director',
};

export function examSettingsWithDefaults(raw: Partial<ExamSettings> | null | undefined): ExamSettings {
  const s = { ...DEFAULT_EXAM_SETTINGS, ...(raw ?? {}) };
  const bands = Array.isArray(s.bands) && s.bands.length ? [...s.bands].sort((a, b) => b.min - a.min) : DEFAULT_EXAM_SETTINGS.bands;
  return { ...s, bands };
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
export function markProblem(value: number | null, max: number): string | null {
  if (value == null) return null;
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
}

/** Σ (mark ÷ out-of × percentage) ÷ Σ percentages × 100. */
export function unitTotal(weights: ExamWeights, m: StudentMarks | null | undefined): UnitTotal {
  let sumWt = 0, acc = 0, complete = true, filled = 0, needed = 0;
  for (const c of EXAM_COMPONENTS) {
    const { max, wt } = weights[c];
    if (!(wt > 0) || !(max > 0)) continue;
    needed++;
    sumWt += wt;
    const v = m?.[c];
    if (v == null) { complete = false; continue; }
    filled++;
    acc += (v / max) * wt;
  }
  if (sumWt <= 0) return { total: null, partial: null, complete: false, filled, needed };
  const partial = round1((acc / sumWt) * 100);
  return { total: complete ? partial : null, partial, complete, filled, needed };
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

export interface ReportCell extends StudentMarks { total: number | null; partial: number | null; complete: boolean; grade: string }
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
      const u = unitTotal(sh.weights, m);
      cells[sh.id] = { ...(m ?? {}), total: u.total, partial: u.partial, complete: u.complete, grade: u.total == null ? '' : gradeFor(u.total, settings).grade };
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
  const needed = EXAM_COMPONENTS.filter((c) => sheet.weights[c].wt > 0 && sheet.weights[c].max > 0);
  const cells = rosterIds.length * needed.length;
  if (!cells) return 0;
  let filled = 0;
  for (const id of rosterIds) for (const c of needed) if (sheet.marks?.[id]?.[c] != null) filled++;
  return Math.round((filled / cells) * 100);
}
