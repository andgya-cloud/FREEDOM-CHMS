import { describe, expect, it } from 'vitest';
import {
  classOf, classText, cohortKey, daysBetween, dueText, latePapers, nextDue, notEligible, cohortLabel, courseListFromSheets, dayMonthYear, lastTrainers, missingCourses, monthYear, nextCohortName, orderCohorts, withCourse,
} from './examCohorts';

const sheet = (cohort: string, courseName: string, courseId: string | null, semester: 1 | 2 | null, ownerUid = 'u1', teacherName = 'Jane') =>
  ({ cohort, courseName, courseId, semester, ownerUid, teacherName });

describe('cohort names and dates', () => {
  it('keys a cohort like the rules do', () => {
    expect(cohortKey('Cohort 3')).toBe('Cohort-3');
    expect(cohortKey(' 2025 / Jan intake ')).toBe('2025-Jan-intake');
  });
  it('writes dates the ADIA way', () => {
    expect(monthYear('2026-01-12')).toBe('Jan 2026');
    expect(dayMonthYear('2025-12-05')).toBe('5 Dec 2025');
    expect(classOf('2025-12-05')).toBe('Class of 2025');
    expect(classText('2025-12-05', '2026-10-25')).toBe('Class of 2025 · Graduated 5 Dec 2025');
    expect(classText('2026-12-11', '2026-10-25')).toBe('Class of 2026 · Graduates 11 Dec 2026');
    expect(classText(null, '2026-10-25')).toBe('');
  });
  it('names the next cohort', () => {
    expect(nextCohortName(['Cohort 1', 'Cohort 4', 'Cohort 2'])).toBe('Cohort 5');
    expect(nextCohortName([])).toBe('Cohort 1');
  });
});

describe('orderCohorts', () => {
  const intakes = [
    { name: 'Cohort 1', startDate: '2024-09-02' }, { name: 'Cohort 2', startDate: '2025-01-13' }, { name: 'Cohort 2', startDate: '2025-01-06' },
    { name: 'Cohort 3', startDate: '2025-09-01' }, { name: 'Cohort 10', startDate: '' },
  ];
  it('puts the newest first and the closed ones under past', () => {
    const { current, past } = orderCohorts(['Cohort 1', 'Cohort 2', 'Cohort 3', 'Cohort 10'], intakes, { 'Cohort 1': { cohort: 'Cohort 1', graduationDate: '2025-12-05', closed: true } });
    expect(current.map((c) => c.name)).toEqual(['Cohort 10', 'Cohort 3', 'Cohort 2']);
    expect(current[2]!.startDate).toBe('2025-01-06');
    expect(past.map((c) => c.name)).toEqual(['Cohort 1']);
    expect(cohortLabel(current[1]!)).toBe('Cohort 3 · started Sep 2025');
    expect(cohortLabel(past[0]!)).toBe('Cohort 1 · Class of 2025');
    expect(cohortLabel(current[0]!)).toBe('Cohort 10');
  });
});

describe('the course list', () => {
  const sheets = [
    sheet('Cohort 2', 'networking ', 'it', 1, 'old', 'Old Trainer'),
    sheet('Cohort 3', 'Networking', 'it', 1, 'new', 'New Trainer'),
    sheet('Cohort 3', 'Life Skills', null, 2),
    sheet('Cohort 2', 'Pattern Drafting', 'fashion', 1),
  ];
  const order = ['Cohort 3', 'Cohort 2'];
  it('takes every course once, as the newest cohort names it', () => {
    expect(courseListFromSheets(sheets, order)).toEqual([
      { name: 'Networking', courseId: 'it', semester: 1 },
      { name: 'Pattern Drafting', courseId: 'fashion', semester: 1 },
      { name: 'Life Skills', courseId: null, semester: 2 },
    ]);
  });
  it('remembers the latest trainer', () => {
    expect(lastTrainers(sheets, order).get('it|networking|1')).toEqual({ uid: 'new', name: 'New Trainer' });
  });
  it('finds what a new cohort still needs', () => {
    const list = courseListFromSheets(sheets, order);
    expect(missingCourses(list, [sheet('Cohort 4', 'NETWORKING', 'it', 1)]).map((c) => c.name)).toEqual(['Pattern Drafting', 'Life Skills']);
    expect(withCourse(list, { name: 'networking', courseId: 'it', semester: 1 })).toHaveLength(3);
    expect(withCourse(list, { name: 'Baking', courseId: 'hosp', semester: 1 })).toHaveLength(4);
  });
});

describe('deadlines and attendance', () => {
  const weights = { cat1: { max: 30, wt: 20 }, cat2: { max: 100, wt: 20 }, cat3: { max: 100, wt: 0 }, final: { max: 100, wt: 60 } };
  const deadlines = { cat1: '2026-10-01', cat2: '2026-10-20', cat3: '2026-10-01', final: '2026-12-01' };
  it('counts days', () => { expect(daysBetween('2026-10-20', '2026-10-25')).toBe(5); });
  it('finds late papers that are not sent, leaving out unused ones', () => {
    const late = latePapers({ weights, status: 'draft', locked: { cat1: true } }, deadlines, '2026-10-25');
    expect(late).toEqual([{ component: 'cat2', due: '2026-10-20', daysLate: 5 }]);
    expect(dueText(late[0]!)).toBe('CAT 2 · 5 days late');
    expect(latePapers({ weights, status: 'submitted', locked: {} }, deadlines, '2026-10-25')).toEqual([]);
  });
  it('gives the next deadline', () => {
    const d = nextDue({ weights, status: 'draft', locked: { cat1: true, cat2: true } }, deadlines, '2026-10-25')!;
    expect(dueText(d)).toBe('Final due 1 Dec 2026');
    expect(dueText({ component: 'cat1', due: '2026-10-25', daysLate: 0 })).toBe('CAT 1 due today');
  });
  it('flags attendance below the rule only', () => {
    expect(notEligible(62, 75)).toBe(true);
    expect(notEligible(75, 75)).toBe(false);
    expect(notEligible(null, 75)).toBe(false);
    expect(notEligible(40, null)).toBe(false);
  });
});
