/**
 * ADIA's years (Andy, 2026-11-20: 2A 3A-both 4B 5A). Cohort 1 started in August 2025, so ADIA's records begin
 * on 1 August 2025; year lists start at 2025 and add the next year by themselves, with no end. Reports come
 * by calendar year (January to December) or by academic year (August to July, "2025/26").
 */
import { periodFor, periodLabel, type DayRange, type ReportType } from './metrics.js';

export const ADIA_FIRST_YEAR = 2025;
/** The first day of ADIA's records: Cohort 1 began in August 2025. */
export const ADIA_START = '2025-08-01';

/** 2025 up to next year, newest first. */
export function adiaYears(today: string): number[] {
  const last = Math.max(ADIA_FIRST_YEAR, Number(today.slice(0, 4)) + 1);
  return Array.from({ length: last - ADIA_FIRST_YEAR + 1 }, (_, i) => last - i);
}

/** The academic year a day falls in, by its first year: 15 Mar 2026 is in 2025 (2025/26). */
export const academicYearOf = (date: string) => (Number(date.slice(5, 7)) >= 8 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1);
/** "2025/26". */
export const academicYearText = (first: number) => `${first}/${String((first + 1) % 100).padStart(2, '0')}`;
/** Academic years from 2025/26 up to the one running now, newest first. */
export function adiaAcademicYears(today: string): number[] {
  const last = Math.max(ADIA_FIRST_YEAR, academicYearOf(today));
  return Array.from({ length: last - ADIA_FIRST_YEAR + 1 }, (_, i) => last - i);
}

/** 4B: an ADIA date before 1 August 2025 is not allowed (a birth date is not an ADIA date). */
export const adiaDateProblem = (date: string | null | undefined) =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < ADIA_START ? 'ADIA began on 1 Aug 2025. Choose a date from then on.' : null;

export type SchoolReportType = ReportType | 'yearly' | 'academic';
export const SCHOOL_REPORT_TYPES: SchoolReportType[] = ['weekly', 'monthly', 'yearly', 'academic'];

/** The days a school report covers: a week, a month, a calendar year or an academic year. */
export function schoolPeriod(type: SchoolReportType, from: string): DayRange {
  const y = Number(from.slice(0, 4));
  if (type === 'yearly') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (type === 'academic') { const a = academicYearOf(from); return { from: `${a}-08-01`, to: `${a + 1}-07-31` }; }
  return periodFor(type, from);
}

export function schoolPeriodLabel(type: SchoolReportType, p: DayRange): string {
  if (type === 'yearly') return `Year ${p.from.slice(0, 4)}`;
  if (type === 'academic') return `Academic year ${academicYearText(Number(p.from.slice(0, 4)))}`;
  return periodLabel(type, p);
}

export const SCHOOL_REPORT_TYPE_LABELS: Record<SchoolReportType, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Year', academic: 'Academic year' };
