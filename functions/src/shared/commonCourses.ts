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
 * ADIA's ready-made common courses and who teaches them (Andy, 2026-10-28). Each runs in Semester 1 and Semester 2,
 * one marks sheet per semester, with one register.
 */
export const STANDARD_COMMON_COURSES: { name: string; tutor: string[] }[] = [
  { name: 'Leadership', tutor: ['Andrew Guya', 'Andy Guya', 'Andy'] },
  { name: 'Communication', tutor: ['Flavier Akinyi'] },
  { name: 'Basic Mathematics', tutor: ['Alphonse Nyaoro'] },
  { name: 'Business Skills', tutor: ['Flavier Akinyi'] },
  { name: 'Critical Thinking', tutor: ['Flavier Akinyi'] },
];

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
