import { describe, expect, it } from 'vitest';
import { classDays, cohortStart, isTotalOnly, monthsBetween, TOTAL_ONLY_WEIGHTS } from './pastRecords';
import { DEFAULT_EXAM_WEIGHTS } from './exams';

describe('past records', () => {
  it('lists Monday to Friday of a month within the dates', () => {
    const days = classDays('2025-09', '2025-09-03', '2025-09-12');
    expect(days).toEqual(['2025-09-03', '2025-09-04', '2025-09-05', '2025-09-08', '2025-09-09', '2025-09-10', '2025-09-11', '2025-09-12']);
  });
  it('lists months newest first', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
  it('takes the earliest intake start for a cohort', () => {
    expect(cohortStart([{ name: 'Cohort 2', startDate: '2025-09-08' }, { name: 'Cohort 2 ', startDate: '2025-09-01' }, { name: 'Cohort 3', startDate: '2024-01-01' }], 'Cohort 2')).toBe('2025-09-01');
    expect(cohortStart([], 'Cohort 2')).toBeNull();
  });
  it('knows a total-only course', () => {
    expect(isTotalOnly(TOTAL_ONLY_WEIGHTS)).toBe(true);
    expect(isTotalOnly(DEFAULT_EXAM_WEIGHTS)).toBe(false);
  });
});
