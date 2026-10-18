import { attended } from './attendance.js';
import { addDays } from './metrics.js';

/**
 * ADIA Training Centre: students, courses, results, fees, certificates and the school's own numbers.
 * Pure functions, shared by the app (screens and PDFs) and the Cloud Functions (balances, reports).
 */

export const STUDENT_STATUSES = ['applicant', 'enrolled', 'deferred', 'graduated', 'withdrawn'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  applicant: 'Applicant', enrolled: 'Enrolled', deferred: 'Deferred', graduated: 'Graduated', withdrawn: 'Withdrawn',
};

export const ASSESSMENT_TYPES = ['continuous', 'practical', 'exam'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  continuous: 'Continuous assessment', practical: 'Practical', exam: 'Exam',
};

export const OUTCOME_CHECKPOINTS = [3, 6, 12] as const;
export type OutcomeCheckpoint = (typeof OUTCOME_CHECKPOINTS)[number];
export const OUTCOME_STATUSES = ['employed', 'self_employed', 'studying', 'seeking', 'unreachable'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];
export const OUTCOME_LABELS: Record<OutcomeStatus, string> = {
  employed: 'Employed', self_employed: 'Self-employed', studying: 'Studying further', seeking: 'Looking for work', unreachable: 'Could not reach',
};
export const isWorking = (s: string | undefined | null) => s === 'employed' || s === 'self_employed';

export const DEFAULT_ATTENDANCE_THRESHOLD = 75;
export const FEES_FUND_ID = 'school_fees';

export interface GradeBand { min: number; grade: string }
export interface SchoolSettings {
  gradingScale: GradeBand[];
  passMark: number;
  attendanceThreshold: number;
  /** How much each kind of assessment counts for within a unit, in per cent. */
  weights: Record<AssessmentType, number>;
  director?: string;
}

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  gradingScale: [{ min: 80, grade: 'Distinction' }, { min: 60, grade: 'Credit' }, { min: 50, grade: 'Pass' }, { min: 0, grade: 'Fail' }],
  passMark: 50,
  attendanceThreshold: DEFAULT_ATTENDANCE_THRESHOLD,
  weights: { continuous: 30, practical: 30, exam: 40 },
};

export function withDefaults(s: Partial<SchoolSettings> | null | undefined): SchoolSettings {
  return {
    ...DEFAULT_SCHOOL_SETTINGS,
    ...(s ?? {}),
    gradingScale: s?.gradingScale?.length ? [...s.gradingScale].sort((a, b) => b.min - a.min) : DEFAULT_SCHOOL_SETTINGS.gradingScale,
    weights: { ...DEFAULT_SCHOOL_SETTINGS.weights, ...(s?.weights ?? {}) },
  };
}

/** The grade for a mark out of 100: the highest band whose minimum it reaches. */
export function gradeFor(percent: number, scale: readonly GradeBand[]): string {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  return sorted.find((b) => percent >= b.min)?.grade ?? sorted[sorted.length - 1]?.grade ?? '';
}

// ---- Identifiers ---------------------------------------------------------------------------------

export function admissionNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}/${year}/${String(sequence).padStart(4, '0')}`;
}
export function certificateSerial(prefix: string, year: number, sequence: number): string {
  return `${prefix}-CERT-${year}-${String(sequence).padStart(4, '0')}`;
}

// ---- Structures -----------------------------------------------------------------------------------

export interface CourseUnit { id: string; name: string; level: string; trainer: string }
export interface Course { id: string; name: string; levels: string[]; units: CourseUnit[]; timetable: string[]; active?: boolean }
export interface Intake { id: string; courseId: string; name: string; startDate: string; capacity: number | null; active?: boolean }
export interface Student {
  id: string; // the person's id
  courseId: string;
  intakeId: string;
  level: string;
  status: StudentStatus;
  admissionNo?: string | null;
  deletedAt?: unknown;
}

export function unitId(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'unit';
}

/** Places taken, free and whether the intake is full. Withdrawn, deferred and graduated students don't hold a place. */
export function capacityOf(intake: Pick<Intake, 'id' | 'capacity'>, students: readonly Pick<Student, 'intakeId' | 'status' | 'deletedAt'>[]) {
  const taken = students.filter((s) => !s.deletedAt && s.intakeId === intake.id && (s.status === 'enrolled' || s.status === 'applicant')).length;
  return { taken, free: intake.capacity == null ? null : Math.max(0, intake.capacity - taken), full: intake.capacity != null && taken >= intake.capacity };
}

// ---- Attendance -----------------------------------------------------------------------------------

export interface ClassRecord { personId: string; eventId: string; status: string; deletedAt?: unknown }
export interface ClassEvent { id: string; date: string; name: string; activity?: string | null; deletedAt?: unknown }

/**
 * A student's attendance in their course: classes attended divided by classes held on or after they
 * started. Only classes with a register taken count, so a class nobody marked doesn't hurt anyone.
 */
export function studentAttendance(
  studentId: string,
  courseName: string,
  events: readonly ClassEvent[],
  records: readonly ClassRecord[],
  since?: string | null,
): { held: number; attended: number; percent: number | null } {
  const courseEvents = events.filter((e) => !e.deletedAt && (e.activity ?? e.name) === courseName && (!since || e.date >= since));
  const marked = new Set(records.filter((r) => !r.deletedAt).map((r) => r.eventId));
  const held = courseEvents.filter((e) => marked.has(e.id));
  const mine = new Map(records.filter((r) => !r.deletedAt && r.personId === studentId).map((r) => [r.eventId, r.status]));
  // A student not on a taken register is counted absent, so a missing mark can't hide a gap.
  const count = held.filter((e) => attended(mine.get(e.id))).length;
  return { held: held.length, attended: count, percent: held.length ? Math.round((count / held.length) * 100) : null };
}

export interface AttendanceAlert { studentId: string; percent: number; held: number }

/** Students whose attendance is below the threshold, lowest first. Needs at least 3 classes held to say anything. */
export function attendanceAlerts(
  students: readonly Student[],
  courses: readonly Course[],
  events: readonly ClassEvent[],
  records: readonly ClassRecord[],
  threshold: number,
): AttendanceAlert[] {
  const out: AttendanceAlert[] = [];
  for (const s of students) {
    if (s.deletedAt || s.status !== 'enrolled') continue;
    const course = courses.find((c) => c.id === s.courseId);
    if (!course) continue;
    const a = studentAttendance(s.id, course.name, events, records);
    if (a.percent != null && a.held >= 3 && a.percent < threshold) out.push({ studentId: s.id, percent: a.percent, held: a.held });
  }
  return out.sort((a, b) => a.percent - b.percent);
}

// ---- Results --------------------------------------------------------------------------------------

export interface Assessment { id: string; courseId: string; unitId: string; type: AssessmentType; name: string; maxMarks: number; date: string; deletedAt?: unknown }
export interface Mark { assessmentId: string; studentId: string; marks: number; deletedAt?: unknown }

export interface UnitResult {
  unitId: string;
  name: string;
  trainer: string;
  /** Out of 100, weighted by assessment type. Null when nothing has been marked yet. */
  percent: number | null;
  grade: string | null;
  passed: boolean | null;
  assessed: number;
}

/**
 * A unit's result: each assessment type's average (as a percentage of its maximum) is weighted by the
 * settings. Types with no marks are left out and the weights of the rest are scaled to 100.
 */
export function unitResult(unit: CourseUnit, studentId: string, assessments: readonly Assessment[], marks: readonly Mark[], settings: SchoolSettings): UnitResult {
  const mine = new Map(marks.filter((m) => !m.deletedAt && m.studentId === studentId).map((m) => [m.assessmentId, m.marks]));
  const byType = new Map<AssessmentType, number[]>();
  let assessed = 0;
  for (const a of assessments) {
    if (a.deletedAt || a.unitId !== unit.id || !(a.maxMarks > 0)) continue;
    const got = mine.get(a.id);
    if (got == null) continue;
    assessed += 1;
    byType.set(a.type, [...(byType.get(a.type) ?? []), Math.min(100, (got / a.maxMarks) * 100)]);
  }
  let weighted = 0;
  let weights = 0;
  for (const [type, list] of byType) {
    const w = settings.weights[type] ?? 0;
    weighted += w * (list.reduce((a, b) => a + b, 0) / list.length);
    weights += w;
  }
  const percent = weights > 0 ? Math.round((weighted / weights) * 10) / 10 : null;
  return {
    unitId: unit.id, name: unit.name, trainer: unit.trainer, percent, assessed,
    grade: percent == null ? null : gradeFor(percent, settings.gradingScale),
    passed: percent == null ? null : percent >= settings.passMark,
  };
}

export function studentResults(course: Course, level: string | null, studentId: string, assessments: readonly Assessment[], marks: readonly Mark[], settings: SchoolSettings): UnitResult[] {
  return course.units
    .filter((u) => !level || !u.level || u.level === level)
    .map((u) => unitResult(u, studentId, assessments, marks, settings));
}

export function overallResult(results: readonly UnitResult[], settings: SchoolSettings): { percent: number | null; grade: string | null; passedUnits: number; assessedUnits: number } {
  const done = results.filter((r) => r.percent != null);
  if (!done.length) return { percent: null, grade: null, passedUnits: 0, assessedUnits: 0 };
  const percent = Math.round((done.reduce((s, r) => s + (r.percent ?? 0), 0) / done.length) * 10) / 10;
  return { percent, grade: gradeFor(percent, settings.gradingScale), passedUnits: done.filter((r) => r.passed).length, assessedUnits: done.length };
}

// ---- Fees -----------------------------------------------------------------------------------------

export interface FeeItem { name: string; amountCents: number }
export interface Invoice { id: string; studentId: string; items: FeeItem[]; totalCents: number; dueDate: string | null; label: string; status: 'open' | 'void'; deletedAt?: unknown }
export interface FeePayment { personId: string | null; amountCents: number; status: string; fundId?: string | null; date?: string; deletedAt?: unknown }

export const invoiceTotal = (items: readonly FeeItem[]): number => items.reduce((s, i) => s + (Number.isFinite(i.amountCents) ? i.amountCents : 0), 0);

export interface FeeBalance { billedCents: number; paidCents: number; balanceCents: number }

/** Billed minus paid. A negative balance means the student has paid ahead. */
export function feeBalance(studentId: string, invoices: readonly Invoice[], payments: readonly FeePayment[]): FeeBalance {
  const billed = invoices.filter((i) => !i.deletedAt && i.status !== 'void' && i.studentId === studentId).reduce((s, i) => s + i.totalCents, 0);
  const paid = payments
    .filter((p) => !p.deletedAt && p.status === 'confirmed' && p.personId === studentId && (p.fundId ?? FEES_FUND_ID) === FEES_FUND_ID)
    .reduce((s, p) => s + p.amountCents, 0);
  return { billedCents: billed, paidCents: paid, balanceCents: billed - paid };
}

/**
 * The due date of the oldest invoice not yet covered, when payments are applied to invoices oldest first.
 * Null when everything billed is covered, or the first unpaid invoice has no due date.
 */
export function oldestUnpaidDue(invoices: readonly Invoice[], paidCents: number): string | null {
  const live = invoices.filter((i) => !i.deletedAt && i.status !== 'void').sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
  let left = paidCents;
  for (const i of live) {
    if (left >= i.totalCents) { left -= i.totalCents; continue; }
    return i.dueDate;
  }
  return null;
}

/** Students who owe money, largest balance first. Overdue means an unpaid invoice past its due date. */
export function arrearsList(
  balances: readonly (FeeBalance & { studentId: string; oldestDue?: string | null })[],
  today: string,
): { studentId: string; balanceCents: number; overdue: boolean }[] {
  return balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ studentId: b.studentId, balanceCents: b.balanceCents, overdue: !!b.oldestDue && b.oldestDue < today }))
    .sort((a, b) => b.balanceCents - a.balanceCents);
}

/** Share of billed fees collected, as a whole per cent; null when nothing was billed. */
export function collectionRate(billed: number, paid: number): number | null {
  return billed > 0 ? Math.round((Math.min(paid, billed) / billed) * 100) : null;
}

// ---- Graduation and outcomes ----------------------------------------------------------------------

/** The date an outcome check is due: this many whole months after graduating (end of month if shorter). */
export function outcomeDueDate(graduationDate: string, months: number): string {
  const [y, m, d] = graduationDate.split('-').map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const outcomeId = (studentId: string, months: number) => `${studentId}_m${months}`;

// ---- The school's numbers -------------------------------------------------------------------------

export interface SchoolInput {
  courses: readonly Course[];
  students: readonly Student[];
  events: readonly ClassEvent[];
  records: readonly ClassRecord[];
  assessments: readonly Assessment[];
  marks: readonly Mark[];
  invoices: readonly Invoice[];
  payments: readonly FeePayment[];
  outcomes: readonly { studentId: string; months: number; status: OutcomeStatus | null }[];
  settings: SchoolSettings;
  /** Graduation dates, by student id. */
  graduatedOn?: Record<string, string>;
}

export interface SchoolMetrics {
  enrolled: number;
  byCourse: { courseId: string; name: string; enrolled: number; trainers: number; ratio: number | null }[];
  withdrawn: number;
  /** Still enrolled (or graduated) out of everyone who started. */
  retentionRate: number | null;
  attendanceRate: number | null;
  passRate: number | null;
  billedCents: number;
  paidCents: number;
  arrearsCents: number;
  collectionRate: number | null;
  graduationRate: number | null;
  employmentRate: number | null;
  belowThreshold: number;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

/** All the school metrics from the brief. Dates are optional: with `from`/`to`, attendance and payments are counted in that period. */
export function schoolMetrics(input: SchoolInput, period?: { from: string; to: string }): SchoolMetrics {
  const live = input.students.filter((s) => !s.deletedAt);
  const enrolled = live.filter((s) => s.status === 'enrolled');
  const started = live.filter((s) => s.status !== 'applicant');
  const kept = started.filter((s) => s.status === 'enrolled' || s.status === 'graduated');
  const inPeriod = (d: string) => !period || (d >= period.from && d <= period.to);

  const events = input.events.filter((e) => !e.deletedAt && (!period || inPeriod(e.date)));
  const courseOf = (id: string) => input.courses.find((c) => c.id === id);
  let sessions = 0;
  let present = 0;
  for (const e of events) {
    const course = input.courses.find((c) => c.name === (e.activity ?? e.name));
    if (!course) continue;
    const roster = enrolled.filter((s) => s.courseId === course.id);
    if (!roster.length) continue;
    const marks = input.records.filter((r) => !r.deletedAt && r.eventId === e.id);
    if (!marks.length) continue;
    sessions += roster.length;
    const here = new Map(marks.map((r) => [r.personId, r.status]));
    present += roster.filter((s) => attended(here.get(s.id))).length;
  }

  // Pass rate: for each unit with marks, students passing out of students assessed.
  let assessed = 0;
  let passed = 0;
  for (const s of started) {
    const course = courseOf(s.courseId);
    if (!course) continue;
    for (const r of studentResults(course, s.level, s.id, input.assessments, input.marks, input.settings)) {
      if (r.passed == null) continue;
      assessed += 1;
      if (r.passed) passed += 1;
    }
  }

  const balances = live.map((s) => feeBalance(s.id, input.invoices, input.payments));
  const billed = balances.reduce((a, b) => a + b.billedCents, 0);
  const paid = input.payments.filter((p) => p.status === 'confirmed' && !p.deletedAt && p.personId && (p.fundId ?? FEES_FUND_ID) === FEES_FUND_ID && (!period || (p.date != null && inPeriod(p.date)))).reduce((a, p) => a + p.amountCents, 0);
  const totalPaid = balances.reduce((a, b) => a + b.paidCents, 0);
  const arrears = balances.reduce((a, b) => a + Math.max(0, b.balanceCents), 0);

  const graduated = live.filter((s) => s.status === 'graduated');
  const sixMonth = input.outcomes.filter((o) => o.months === 6 && o.status != null && o.status !== 'unreachable');
  const alerts = attendanceAlerts(live, input.courses, input.events, input.records, input.settings.attendanceThreshold);

  return {
    enrolled: enrolled.length,
    byCourse: input.courses.map((c) => {
      const n = enrolled.filter((s) => s.courseId === c.id).length;
      const trainers = new Set(c.units.map((u) => u.trainer.trim().toLowerCase()).filter(Boolean)).size;
      return { courseId: c.id, name: c.name, enrolled: n, trainers, ratio: trainers ? Math.round((n / trainers) * 10) / 10 : null };
    }),
    withdrawn: live.filter((s) => s.status === 'withdrawn').length,
    retentionRate: pct(kept.length, started.length),
    attendanceRate: pct(present, sessions),
    passRate: pct(passed, assessed),
    billedCents: billed,
    paidCents: period ? paid : totalPaid,
    arrearsCents: arrears,
    collectionRate: collectionRate(billed, totalPaid),
    // Of everyone who started, how many graduated. Withdrawn and still-studying students stay in the base.
    graduationRate: pct(graduated.length, started.length),
    employmentRate: sixMonth.length ? pct(sixMonth.filter((o) => isWorking(o.status)).length, sixMonth.length) : null,
    belowThreshold: alerts.length,
  };
}

/** A weekly school report covers the Monday-to-Sunday week before `today`. */
export function lastSchoolWeek(today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -dow);
  return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
}

// ---- Reports to the director ----------------------------------------------------------------------

export interface SchoolReportDoc {
  type: 'weekly' | 'monthly';
  from: string;
  to: string;
  label: string;
  metrics: SchoolMetrics;
  alerts: { studentId: string; name: string; course: string; percent: number; held: number }[];
  arrears: { studentId: string; name: string; course: string; balanceCents: number; overdue: boolean }[];
  outcomesDue: { studentId: string; name: string; months: number; due: string }[];
}

/**
 * The weekly attendance-and-alerts report and the monthly enrolment, results and fees report share
 * one shape; the monthly one simply has all of it filled in meaningfully. `names` maps ids to names.
 */
export function buildSchoolReport(
  input: SchoolInput & { dueOutcomes: readonly { studentId: string; months: number; due: string; status: string | null }[] },
  names: Record<string, string>,
  type: 'weekly' | 'monthly',
  period: { from: string; to: string },
  label: string,
  today: string,
): SchoolReportDoc {
  const name = (id: string) => names[id] ?? 'Unknown student';
  const courseName = (courseId: string) => input.courses.find((c) => c.id === courseId)?.name ?? '';
  const live = input.students.filter((s) => !s.deletedAt);
  const balances = live.map((s) => {
    const mine = input.invoices.filter((i) => i.studentId === s.id);
    const b = feeBalance(s.id, input.invoices, input.payments);
    return { studentId: s.id, courseId: s.courseId, ...b, oldestDue: oldestUnpaidDue(mine, b.paidCents) };
  });
  const arrears = arrearsList(balances, today).map((a) => ({
    studentId: a.studentId, name: name(a.studentId), course: courseName(live.find((s) => s.id === a.studentId)?.courseId ?? ''),
    balanceCents: a.balanceCents, overdue: a.overdue,
  }));
  const alerts = attendanceAlerts(live, input.courses, input.events, input.records, input.settings.attendanceThreshold).map((a) => ({
    ...a, name: name(a.studentId), course: courseName(live.find((s) => s.id === a.studentId)?.courseId ?? ''),
  }));
  return {
    type, from: period.from, to: period.to, label,
    metrics: schoolMetrics(input, period),
    alerts,
    arrears,
    outcomesDue: input.dueOutcomes.filter((o) => o.status == null && o.due <= today).map((o) => ({ studentId: o.studentId, name: name(o.studentId), months: o.months, due: o.due })),
  };
}
