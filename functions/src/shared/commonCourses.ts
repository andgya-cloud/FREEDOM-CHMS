import { cohortKey } from './examCohorts.js';

/** The "Common courses" department a lecturer can have ticked (Andy, 2026-10-28). Common courses carry courseId null. */
export const COMMON_DEPARTMENT = 'common';
/** One register per common course and cohort, e.g. "Communication Skills · Cohort 4". */
export const commonClassName = (courseName: string, cohort: string) => `${courseName.trim()} · ${cohort.trim()}`;
/** The names-only class list of a whole cohort, read by its common-course lecturers. */
export const commonRosterId = (cohort: string) => `common-${cohortKey(cohort)}`;
/** The cohort named at the end of a common-course register, or ''. */
export const cohortOfCommonClass = (name: string) => { const i = name.lastIndexOf(' · '); return i > 0 ? name.slice(i + 3) : ''; };
