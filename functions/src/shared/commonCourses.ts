import { cohortKey } from './examCohorts.js';

/** The "Common courses" department a lecturer can have ticked (Andy, 2026-10-28). Common courses carry courseId null. */
export const COMMON_DEPARTMENT = 'common';
/** One register per common course and cohort, e.g. "Communication Skills · Cohort 4". */
export const commonClassName = (courseName: string, cohort: string) => `${courseName.trim()} · ${cohort.trim()}`;
/** The names-only class list of a whole cohort, read by its common-course lecturers. */
export const commonRosterId = (cohort: string) => `common-${cohortKey(cohort)}`;
/** The cohort named at the end of a common-course register, or ''. */
export const cohortOfCommonClass = (name: string) => { const i = name.lastIndexOf(' · '); return i > 0 ? name.slice(i + 3) : ''; };

/**
 * ADIA's common courses and who teaches them (Andy, 2026-10-29), in his order, grouped by tutor. Each runs in
 * Semester 1 and Semester 2, one marks sheet per semester, with one register, and a Finals average of the two.
 * `was` lists older names, so a course set up under one is not added twice.
 */
export const STANDARD_COMMON_COURSES: { name: string; tutor: string[]; was?: string[] }[] = [
  { name: 'Leadership', tutor: ['Andrew Guya', 'Andy Guya', 'Andy'] },
  { name: 'Business Skills', tutor: ['Flavier Akinyi'] },
  { name: 'Life Skills', tutor: ['Flavier Akinyi'] },
  { name: 'Communication', tutor: ['Flavier Akinyi'], was: ['Communication Skills'] },
  { name: 'Critical Thinking', tutor: ['Alphonse Nyaoro'] },
  { name: 'Basic Mathematics', tutor: ['Alphonse Nyaoro'], was: ['Basic Math', 'Basic Maths', 'Simple Basic Math'] },
  // Not "ICT", so it is not mixed up with the IT / ICT department (Andy, 2026-10-29, 2A).
  { name: 'ICT Skills', tutor: ['Alphonse Nyaoro'], was: ['ICT', 'Basic ICT'] },
];

const courseKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
/** The ready-made course a course name stands for, under its name or an older one. */
export function standardCourse(name: string) {
  const k = courseKey(name);
  return STANDARD_COMMON_COURSES.find((c) => courseKey(c.name) === k || c.was?.some((w) => courseKey(w) === k));
}
/** Where a course sits in Andy's list; courses added by hand come after, A to Z. */
export const standardOrder = (name: string) => { const c = standardCourse(name); return c ? STANDARD_COMMON_COURSES.indexOf(c) : STANDARD_COMMON_COURSES.length; };

/** Finals for a common course: the average of the Semester 1 and Semester 2 totals, once both are in (Andy, 2026-10-29, 4A). */
export function commonFinal(sem1: number | null, sem2: number | null): number | null {
  if (sem1 == null || sem2 == null) return null;
  return Math.round(((sem1 + sem2) / 2) * 10) / 10;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/** The account whose name matches one of `names`: the whole name first, then first and last name in any order. */
export function matchTutor<T extends { name: string }>(names: string[], people: T[]): T | undefined {
  for (const n of names) {
    const want = words(n).join(' ');
    const exact = people.find((p) => words(p.name).join(' ') === want);
    if (exact) return exact;
  }
  for (const n of names) {
    const want = words(n);
    if (want.length < 2) continue;
    const found = people.filter((p) => { const have = words(p.name); return want.every((w) => have.includes(w)); });
    if (found.length === 1) return found[0];
  }
  return undefined;
}
