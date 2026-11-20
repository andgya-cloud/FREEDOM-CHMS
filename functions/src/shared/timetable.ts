/**
 * ADIA's class timetable and exam timetable (Andy, 2026-11-20: 1A, "director" = Admin, 2A-14A).
 *
 * Class timetable: one weekly grid for each cohort, semester and department. The day's periods are set once for
 * the grid (with tea and lunch breaks), each box holds a course, its lecturer and a room. Exam timetable: one list
 * of papers for each cohort and exam period (CAT 2 · Semester 1 · Oct 2026). Both stay drafts until published.
 * The principal, Admin, the pastor and Doreen keep them; everyone at ADIA reads the published ones.
 */
import { cohortKey } from './examCohorts.js';
import { STANDARD_COMMON_COURSES, standardCourse } from './commonCourses.js';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface Period { start: string; end: string; label: string; isBreak: boolean }
/** ADIA's day from the Semester I and II timetables (Andy, 2026-11-20, 14A): 8-10, 11-1 and 2-4. Each grid can still change it. */
export const DEFAULT_PERIODS: Period[] = [
  { start: '08:00', end: '10:00', label: '', isBreak: false },
  { start: '10:00', end: '11:00', label: 'Break', isBreak: true },
  { start: '11:00', end: '13:00', label: '', isBreak: false },
  { start: '13:00', end: '14:00', label: 'Lunch', isBreak: true },
  { start: '14:00', end: '16:00', label: '', isBreak: false },
];
export const MAX_PERIODS = 12;

export interface ClassSlot { course: string; sheetId: string | null; lecturer: string; lecturerUid: string; room: string }

export interface ClassTimetable {
  orgId: string;
  cohort: string;
  semester: 1 | 2;
  /** The department (programme) id. */
  courseId: string;
  periods: Period[];
  saturday: boolean;
  /** "day-period" (0 = Monday, period index in periods) to the class in that box. */
  slots: Record<string, ClassSlot>;
  /** The semester's dates, so Today shows only the timetable running now. */
  from: string | null;
  to: string | null;
  published: boolean;
  publishedOn: string | null;
  changedOn: string | null;
}

export const slotKey = (day: number, period: number) => `${day}-${period}`;
export const parseSlotKey = (k: string) => { const [d, p] = k.split('-').map(Number); return { day: d ?? 0, period: p ?? 0 }; };
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
export const classTimetableId = (cohort: string, semester: number, courseId: string) => `${cohortKey(cohort)}__s${semester}__${slug(courseId)}`;

/** "8:00" from "08:00". */
export const clock = (t: string) => t.replace(/^0(\d)/, '$1');
export const periodText = (p: Pick<Period, 'start' | 'end'>) => `${clock(p.start)} – ${clock(p.end)}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const datesOverlap = (a: { from: string | null; to: string | null }, b: { from: string | null; to: string | null }) =>
  (!a.from || !b.to || a.from <= b.to) && (!b.from || !a.to || b.from <= a.to);

/** A period's times: HH:mm, the end after the start. */
export function periodProblem(p: Pick<Period, 'start' | 'end'>): string | null {
  if (!/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) return 'Choose a start and an end time.';
  return toMin(p.end) <= toMin(p.start) ? 'The end must be after the start.' : null;
}

export interface Named { id: string; cohort: string; departmentName: string }

/**
 * 9A: warnings, never blocks. A lecturer or a room in two places at once, in any other grid running in the same
 * weeks. The same common course for the whole cohort (Leadership in every department's grid) is one class, not a clash.
 */
export function classClashes(me: ClassTimetable & Named, others: readonly (ClassTimetable & Named)[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, s] of Object.entries(me.slots)) {
    const { day, period } = parseSlotKey(k);
    const p = me.periods[period];
    if (!p || p.isBreak || !s.course) continue;
    const msgs = new Set<string>();
    for (const o of others) {
      if (o.id === me.id || !datesOverlap(me, o)) continue;
      for (const [k2, s2] of Object.entries(o.slots)) {
        const at = parseSlotKey(k2);
        const p2 = o.periods[at.period];
        if (at.day !== day || !p2 || p2.isBreak || !s2.course || !overlaps(p, p2)) continue;
        const shared = o.cohort === me.cohort && s2.course === s.course && (s2.sheetId ?? '') === (s.sheetId ?? '');
        if (shared) continue;
        const where = `${o.cohort} (${o.departmentName})`;
        if (s.lecturer && (s.lecturerUid ? s2.lecturerUid === s.lecturerUid : s2.lecturer === s.lecturer)) msgs.add(`${s.lecturer} also teaches ${where} at this time`);
        if (s.room && s2.room === s.room) msgs.add(`${s.room} is also used by ${where} at this time`);
      }
    }
    if (msgs.size) out[k] = [...msgs];
  }
  return out;
}

/** Monday 0 … Saturday 5 for a YYYY-MM-DD date; -1 for Sunday. */
export function weekdayIndex(date: string): number {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
  return d === 0 ? -1 : d - 1;
}

export interface TodayClass { start: string; end: string; course: string; cohort: string; room: string; departmentName: string }

/** 13A: "Your classes today", from the published grids running today. */
export function classesOn(date: string, uid: string, timetables: readonly (ClassTimetable & Named)[]): TodayClass[] {
  const day = weekdayIndex(date);
  if (day < 0) return [];
  const seen = new Set<string>();
  const out: TodayClass[] = [];
  for (const t of timetables) {
    if (!t.published || (t.from && date < t.from) || (t.to && date > t.to) || (day === 5 && !t.saturday)) continue;
    for (const [k, s] of Object.entries(t.slots)) {
      const at = parseSlotKey(k);
      const p = t.periods[at.period];
      if (at.day !== day || !p || p.isBreak || s.lecturerUid !== uid) continue;
      // A common course appears in every department's grid: list it once.
      const key = `${t.cohort}|${p.start}|${s.course}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ start: p.start, end: p.end, course: s.course, cohort: t.cohort, room: s.room, departmentName: t.departmentName });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---- Common courses (Andy, 2026-11-20) -------------------------------------------------------

/**
 * The seven common courses sit in the Department dropdown under the cohort's departments, so each can have its
 * own class grid and its own exam list: Business Skills, Communication, Critical Thinking, ICT Skills, Leadership,
 * Life Skills and Basic Mathematics.
 */
export const TIMETABLE_COMMON_COURSES: string[] = STANDARD_COMMON_COURSES.map((c) => c.name).sort((a, b) => a.localeCompare(b));
const COMMON_PREFIX = 'common:';
export const commonDeptId = (name: string) => `${COMMON_PREFIX}${name}`;
/** "Leadership" for "common:Leadership"; null for a real department. */
export const commonDeptName = (id: string | null | undefined) => (id?.startsWith(COMMON_PREFIX) ? id.slice(COMMON_PREFIX.length) : null);
/** The common course a course name stands for ("Communication Skills" is Communication), or null. */
export const commonCourseOf = (name: string) => standardCourse(name)?.name ?? null;

export interface CourseOption { sheetId: string; name: string; courseId: string | null; semester: number | null; lecturer: string; lecturerUid: string }
/** A common course offered before the cohort has its marks sheet: no sheet, the standard tutor. */
const STD = 'std:';
export const isStandInSheet = (sheetId: string | null | undefined) => !!sheetId?.startsWith(STD);
/** The value a course dropdown shows for a saved box or row. */
export const courseOptionValue = (sheetId: string | null, course: string) => sheetId ?? (commonCourseOf(course) ? `${STD}${commonCourseOf(course)}` : '');

/** The cohort's courses plus any of the seven common courses it has no sheet for yet, so all seven can be picked. */
export function withCommonCourses(courses: readonly CourseOption[], staff: readonly { uid: string; name: string }[]): CourseOption[] {
  const have = new Set(courses.filter((c) => c.courseId == null).map((c) => commonCourseOf(c.name)).filter(Boolean));
  const extra = STANDARD_COMMON_COURSES.filter((c) => !have.has(c.name)).map((c): CourseOption => {
    const tutors = c.tutor.map((n) => n.toLowerCase());
    const who = staff.find((p) => tutors.includes(p.name.trim().toLowerCase()));
    return { sheetId: `${STD}${c.name}`, name: c.name, courseId: null, semester: null, lecturer: who?.name ?? c.tutor[0] ?? '', lecturerUid: who?.uid ?? '' };
  });
  return [...courses, ...extra];
}

// ---- Exam timetable --------------------------------------------------------------------------

export const EXAM_PAPERS = ['cat1', 'cat2', 'cat3', 'final', 'nita', 'other'] as const;
export type ExamPaper = (typeof EXAM_PAPERS)[number];
export const EXAM_PAPER_LABELS: Record<ExamPaper, string> = { cat1: 'CAT 1', cat2: 'CAT 2', cat3: 'CAT 3', final: 'End of semester exams', nita: 'NITA exams', other: 'Other exams' };

export interface ExamRow { id: string; date: string | null; start: string; end: string; course: string; sheetId: string | null; courseId: string | null; room: string; invigilator: string; invigilatorUid: string }

export interface ExamTimetable {
  orgId: string;
  cohort: string;
  paper: ExamPaper;
  semester: 1 | 2 | null;
  /** YYYY-MM */
  month: string;
  name: string;
  rows: ExamRow[];
  published: boolean;
  publishedOn: string | null;
  changedOn: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthText = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
/** "CAT 2 · Semester 1 · Oct 2026". */
export function examPeriodName(paper: ExamPaper, semester: 1 | 2 | null, month: string): string {
  return [EXAM_PAPER_LABELS[paper], semester ? `Semester ${semester}` : '', monthText(month)].filter(Boolean).join(' · ');
}
export const examTimetableId = (cohort: string, paper: ExamPaper, semester: 1 | 2 | null, month: string) => `${cohortKey(cohort)}__${paper}__s${semester ?? 0}__${month}`;

/** 9A for exams: a room or an invigilator with two papers at once, here or in another published list. */
export function examClashes(me: ExamTimetable & { id: string }, others: readonly (ExamTimetable & { id: string })[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const all = [...me.rows.map((r) => ({ r, tt: me })), ...others.filter((o) => o.id !== me.id).flatMap((o) => o.rows.map((r) => ({ r, tt: o })))];
  for (const r of me.rows) {
    if (!r.date || periodProblem(r)) continue;
    const msgs = new Set<string>();
    for (const { r: x, tt } of all) {
      if (x.id === r.id && tt === me) continue;
      if (x.date !== r.date || periodProblem(x) || !overlaps(r, x)) continue;
      // The same paper sat by every department at once is one sitting.
      if (tt.cohort === me.cohort && x.course === r.course) continue;
      const where = tt === me ? '' : ` (${tt.cohort})`;
      if (r.room && x.room === r.room) msgs.add(`${r.room} has two papers at once${where}`);
      if (r.invigilator && (r.invigilatorUid ? x.invigilatorUid === r.invigilatorUid : x.invigilator === r.invigilator)) msgs.add(`${r.invigilator} invigilates two papers at once${where}`);
    }
    if (msgs.size) out[r.id] = [...msgs];
  }
  return out;
}

/** 8A: the day of the last paper, which becomes that paper's deadline in Exam Records. */
export function lastExamDate(rows: readonly Pick<ExamRow, 'date'>[]): string | null {
  return rows.map((r) => r.date).filter((d): d is string => !!d).sort().pop() ?? null;
}

/** The rows in date and time order. */
export const sortExamRows = <T extends Pick<ExamRow, 'date' | 'start' | 'course'>>(rows: readonly T[]) =>
  // A paper just added (no course yet) stays at the bottom while it is filled in.
  [...rows].sort((a, b) => Number(!a.course) - Number(!b.course) || (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.start.localeCompare(b.start) || a.course.localeCompare(b.course));

/** The calendar event id for one exam paper (written by the server when the list is published). */
export const examEventId = (timetableId: string, rowId: string) => `exam__${timetableId}__${rowId}`;

/** 14A: rooms typed once in Setup. */
export const DEFAULT_ROOMS: string[] = [];
export const cleanRoom = (v: string) => v.replace(/\s+/g, ' ').trim().slice(0, 40);

/* ---------- the whole school on one grid (Andy, 2026-11-20, 14A) ---------- */

export interface SchoolEntry { title: string; course: string; lecturer: string; room: string; common: boolean }
export interface WholeSchool { times: { start: string; end: string }[]; days: number; cells: Record<string, SchoolEntry[]> }

/**
 * Every department's grid for one cohort and semester on one sheet, as ADIA's printed timetables are: the days
 * down the side, the teaching periods across, and in each box the departments (or the common course everyone
 * takes) with their class. A grid's period goes in the column whose times it overlaps.
 */
export function wholeSchool(grids: readonly (Pick<ClassTimetable, 'periods' | 'slots' | 'saturday'> & { title: string; common: boolean })[]): WholeSchool {
  const seen = new Map<string, { start: string; end: string }>();
  for (const g of grids) for (const p of g.periods) if (!p.isBreak && !periodProblem(p)) seen.set(`${p.start}-${p.end}`, { start: p.start, end: p.end });
  if (!seen.size) for (const p of DEFAULT_PERIODS) if (!p.isBreak) seen.set(`${p.start}-${p.end}`, { start: p.start, end: p.end });
  // Overlapping times share one column, under the earliest.
  const times: { start: string; end: string }[] = [];
  for (const t of [...seen.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))) {
    if (!times.some((x) => overlaps(x, t))) times.push(t);
  }
  const days = grids.some((g) => g.saturday) ? 6 : 5;
  const cells: Record<string, SchoolEntry[]> = {};
  for (const g of [...grids].sort((a, b) => Number(b.common) - Number(a.common) || a.title.localeCompare(b.title))) {
    for (const [k, slot] of Object.entries(g.slots)) {
      if (!slot?.course) continue;
      const { day, period } = parseSlotKey(k);
      const p = g.periods[period];
      if (!p || p.isBreak || day >= days) continue;
      const col = times.findIndex((t) => overlaps(t, p));
      if (col < 0) continue;
      const key = slotKey(day, col);
      (cells[key] ??= []).push({ title: g.common ? slot.course : g.title, course: slot.course, lecturer: slot.lecturer, room: slot.room, common: g.common });
    }
  }
  return { times, days, cells };
}
