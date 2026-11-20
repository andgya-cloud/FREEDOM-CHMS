import { describe, expect, it } from 'vitest';
import { academicYearOf, academicYearText, adiaAcademicYears, adiaDateProblem, adiaYears, schoolPeriod, schoolPeriodLabel } from './adiaYears';

describe('ADIA years from 2025 (Andy, 2026-11-20)', () => {
  it('lists years from 2025 and grows by itself', () => {
    expect(adiaYears('2026-11-20')).toEqual([2027, 2026, 2025]);
    expect(adiaYears('2031-01-02')).toEqual([2032, 2031, 2030, 2029, 2028, 2027, 2026, 2025]);
    expect(adiaAcademicYears('2026-07-31')).toEqual([2025]);
    expect(adiaAcademicYears('2026-08-01')).toEqual([2026, 2025]);
  });
  it('academic years run August to July', () => {
    expect(academicYearOf('2026-03-15')).toBe(2025);
    expect(academicYearOf('2026-08-01')).toBe(2026);
    expect(academicYearText(2029)).toBe('2029/30');
    expect(academicYearText(2099)).toBe('2099/00');
    expect(schoolPeriod('academic', '2026-02-10')).toEqual({ from: '2025-08-01', to: '2026-07-31' });
    expect(schoolPeriod('yearly', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(schoolPeriodLabel('academic', schoolPeriod('academic', '2025-09-01'))).toBe('Academic year 2025/26');
    expect(schoolPeriodLabel('yearly', schoolPeriod('yearly', '2025-09-01'))).toBe('Year 2025');
  });
  it('does not take dates before ADIA began', () => {
    expect(adiaDateProblem('2025-07-31')).toMatch(/1 Aug 2025/);
    expect(adiaDateProblem('2025-08-01')).toBeNull();
    expect(adiaDateProblem('')).toBeNull();
  });
});
