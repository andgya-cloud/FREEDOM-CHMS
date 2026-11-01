/**
 * Filling in past registers and exams (Andy, 2026-11-01, 1A-6A): a month grid of class days for a cohort's
 * register, back to the day that cohort started, and one total mark per student per course.
 */
import type { ExamWeights } from './exams.js';

const DAY = 86_400_000;
const keyOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Monday to Friday of a month ("YYYY-MM"), kept between `from` and `to` (YYYY-MM-DD). */
export function classDays(month: string, from: string, to: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let t = Date.UTC(y, m - 1, 1); new Date(t).getUTCMonth() === m - 1; t += DAY) {
    const wd = new Date(t).getUTCDay();
    const key = keyOf(t);
    if (wd >= 1 && wd <= 5 && key >= from && key <= to) out.push(key);
  }
  return out;
}

/** Every month from `from` to `to` (YYYY-MM-DD), newest first, as "YYYY-MM". */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = to.slice(0, 7).split('-').map(Number);
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    if (out.length > 120) break;
  }
  return out;
}

/** The earliest start date among a cohort's intakes (each department has its own intake of that name). */
export function cohortStart(intakes: readonly { name: string; startDate?: string | null }[], cohort: string): string | null {
  const dates = intakes.filter((i) => i.name.trim() === cohort.trim() && i.startDate).map((i) => i.startDate!).sort();
  return dates[0] ?? null;
}

/** A course typed in as one total mark out of 100 (6A): the Final carries the whole mark. */
export const TOTAL_ONLY_WEIGHTS: ExamWeights = {
  cat1: { max: 100, wt: 0 },
  cat2: { max: 100, wt: 0 },
  cat3: { max: 100, wt: 0 },
  final: { max: 100, wt: 100 },
};

export function isTotalOnly(w: ExamWeights): boolean {
  return w.cat1.wt === 0 && w.cat2.wt === 0 && w.cat3.wt === 0 && w.final.wt === 100 && w.final.max === 100;
}
