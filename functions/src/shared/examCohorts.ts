/**
 * Cohorts and the course list for ADIA's Exam Records (Andy, 2026-10-25, answers 1A-6A): many cohorts
 * in one dropdown, newest first; each graduating class dated ("Class of 2025 · Graduated 12 Dec 2025");
 * a closed (graduated) cohort is read only; and one course list for every programme, so a new cohort
 * gets its courses in one step.
 */

/** A cohort's record id, the same as examMeta's: "Cohort 3" → "Cohort-3". The rules work it out the same way. */
export function cohortKey(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'cohort';
}

/** organizations/{org}/examCohorts/{cohortKey}. */
export interface ExamCohort {
  cohort: string;
  /** YYYY-MM-DD: the day the class graduates (or graduated). */
  graduationDate: string | null;
  /** Graduated and closed: its marks are read only until someone reopens it with their password. */
  closed: boolean;
  closedByName?: string | null;
  reopenedByName?: string | null;
}

export interface CohortChoice { name: string; startDate: string | null; graduationDate: string | null; closed: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (date: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date); return m ? { y: m[1]!, m: Number(m[2]), d: Number(m[3]) } : null; };

/** "Jan 2026". */
export function monthYear(date: string | null | undefined): string {
  const p = date ? parts(date) : null;
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : '';
}
/** "12 Dec 2025". */
export function dayMonthYear(date: string | null | undefined): string {
  const p = date ? parts(date) : null;
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : '';
}
/** "Class of 2025", from the graduation date. */
export function classOf(graduationDate: string | null | undefined): string {
  const p = graduationDate ? parts(graduationDate) : null;
  return p ? `Class of ${p.y}` : '';
}
/** "Class of 2025 · Graduated 12 Dec 2025", or "Graduates" for a date still to come. */
export function classText(graduationDate: string | null | undefined, today: string): string {
  if (!graduationDate || !parts(graduationDate)) return '';
  return `${classOf(graduationDate)} · ${graduationDate <= today ? 'Graduated' : 'Graduates'} ${dayMonthYear(graduationDate)}`;
}

/** What the cohort dropdown shows: "Cohort 5 · started Jan 2027", or "Cohort 1 · Class of 2025" once it has closed. */
export function cohortLabel(c: CohortChoice): string {
  if (c.closed && c.graduationDate) return `${c.name} · ${classOf(c.graduationDate)}`;
  return c.startDate ? `${c.name} · started ${monthYear(c.startDate)}` : c.name;
}

const byNumber = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/**
 * The cohorts, newest first (by the earliest start date of the cohort's intakes, then by the number in
 * the name), split into the current ones and the past (closed) ones.
 */
export function orderCohorts(names: readonly string[], intakes: readonly { name: string; startDate?: string | null }[], info: Readonly<Record<string, ExamCohort | undefined>>): { current: CohortChoice[]; past: CohortChoice[] } {
  const start = new Map<string, string>();
  for (const i of intakes) {
    if (!i.startDate) continue;
    const was = start.get(i.name);
    if (!was || i.startDate < was) start.set(i.name, i.startDate);
  }
  const all = [...new Set(names)].map((name): CohortChoice => ({
    name, startDate: start.get(name) ?? null, graduationDate: info[name]?.graduationDate ?? null, closed: info[name]?.closed === true,
  })).sort((a, b) => (a.startDate && b.startDate && a.startDate !== b.startDate ? b.startDate.localeCompare(a.startDate) : byNumber(a.name, b.name)));
  return { current: all.filter((c) => !c.closed), past: all.filter((c) => c.closed) };
}

/** The next cohort's name: "Cohort 5" after "Cohort 4". */
export function nextCohortName(names: readonly string[]): string {
  const n = Math.max(0, ...names.map((x) => Number(/(\d+)\s*$/.exec(x)?.[1] ?? 0)));
  return `Cohort ${n + 1}`;
}

/* ---------- the course list ---------- */

/** One course on ADIA's course list: a programme's course (courseId), or a common course for everyone (null). */
export interface CourseListItem { name: string; courseId: string | null; semester: 1 | 2 | null }
interface SheetLike { cohort: string; courseId: string | null; courseName: string; semester?: 1 | 2 | null; ownerUid: string; ownerName?: string; teacherName?: string; deletedAt?: unknown }

/** The same course, whatever the capitals or spaces in its name. */
export const courseListKey = (c: { courseId: string | null; name?: string; courseName?: string; semester?: 1 | 2 | null }) =>
  `${c.courseId ?? 'common'}|${(c.name ?? c.courseName ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}|${c.semester ?? 0}`;

/** Semester 1 first, then by name. */
export function sortCourseList<T extends CourseListItem>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.semester ?? 9) - (b.semester ?? 9) || a.name.localeCompare(b.name));
}

/**
 * The course list as the cohorts so far have it, for when none is saved yet: every course of every
 * cohort once, named as the newest cohort names it.
 */
export function courseListFromSheets(sheets: readonly SheetLike[], newestFirst: readonly string[]): CourseListItem[] {
  const rank = (c: string) => { const i = newestFirst.indexOf(c); return i < 0 ? newestFirst.length : i; };
  const seen = new Map<string, CourseListItem>();
  for (const s of [...sheets].filter((x) => !x.deletedAt).sort((a, b) => rank(a.cohort) - rank(b.cohort))) {
    const k = courseListKey(s);
    if (!seen.has(k) && s.courseName.trim()) seen.set(k, { name: s.courseName.trim(), courseId: s.courseId, semester: s.semester ?? null });
  }
  return sortCourseList([...seen.values()]);
}

/** Who marked each course most recently, so a new cohort starts with the same trainers. */
export function lastTrainers(sheets: readonly SheetLike[], newestFirst: readonly string[]): Map<string, { uid: string; name: string }> {
  const rank = (c: string) => { const i = newestFirst.indexOf(c); return i < 0 ? newestFirst.length : i; };
  const out = new Map<string, { uid: string; name: string }>();
  for (const s of [...sheets].filter((x) => !x.deletedAt).sort((a, b) => rank(a.cohort) - rank(b.cohort))) {
    const k = courseListKey(s);
    if (!out.has(k) && s.ownerUid) out.set(k, { uid: s.ownerUid, name: s.teacherName || s.ownerName || '' });
  }
  return out;
}

/** The courses on the list that a cohort does not have yet. */
export function missingCourses(list: readonly CourseListItem[], cohortSheets: readonly SheetLike[]): CourseListItem[] {
  const have = new Set(cohortSheets.filter((s) => !s.deletedAt).map(courseListKey));
  return list.filter((c) => !have.has(courseListKey(c)));
}

/** Adds a course to the list unless it is already there. */
export function withCourse(list: readonly CourseListItem[], c: CourseListItem): CourseListItem[] {
  const k = courseListKey(c);
  return list.some((x) => courseListKey(x) === k) ? [...list] : sortCourseList([...list, { name: c.name.trim().slice(0, 120), courseId: c.courseId, semester: c.semester }]);
}
