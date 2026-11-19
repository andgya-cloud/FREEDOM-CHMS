import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERIODS, classClashes, classTimetableId, classesOn, examClashes, examPeriodName, lastExamDate, periodProblem, periodText, weekdayIndex,
  type ClassTimetable, type ExamTimetable, type Named,
} from './timetable';

const grid = (id: string, cohort: string, dept: string, slots: ClassTimetable['slots'], over: Partial<ClassTimetable> = {}): ClassTimetable & Named => ({
  id, cohort, departmentName: dept, orgId: 'adia', semester: 1, courseId: dept, periods: DEFAULT_PERIODS, saturday: false, slots, from: null, to: null,
  published: true, publishedOn: null, changedOn: null, ...over,
});
const s = (course: string, lecturer: string, room: string, sheetId: string | null = course) => ({ course, sheetId, lecturer, lecturerUid: lecturer.toLowerCase(), room });

describe('class timetable', () => {
  it('names and times', () => {
    expect(classTimetableId('Cohort 4', 1, 'fd')).toBe('Cohort-4__s1__fd');
    expect(periodText(DEFAULT_PERIODS[0]!)).toBe('8:00 – 10:00');
    expect(periodProblem({ start: '10:00', end: '09:00' })).not.toBeNull();
    expect(periodProblem({ start: '10:00', end: '12:00' })).toBeNull();
    expect(weekdayIndex('2026-11-23')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-22')).toBe(-1); // Sunday
  });

  it('warns about a lecturer or room in two places, not a shared common course', () => {
    const me = grid('a', 'Cohort 4', 'Fashion', { '2-4': s('Business Skills', 'Flavier', 'Hall'), '0-0': s('Leadership', 'Andy', 'Hall', 'lead') });
    const ict4 = grid('b', 'Cohort 4', 'ICT', { '0-0': s('Leadership', 'Andy', 'Hall', 'lead') });
    const c3 = grid('c', 'Cohort 3', 'ICT', { '2-4': s('Communication', 'Flavier', 'Room 1'), '0-0': s('Web Design', 'Grace', 'Hall') });
    const out = classClashes(me, [me, ict4, c3]);
    expect(out['2-4']).toEqual(['Flavier also teaches Cohort 3 (ICT) at this time']);
    expect(out['0-0']).toEqual(['Hall is also used by Cohort 3 (ICT) at this time']);
    // Grids for other weeks do not clash.
    expect(classClashes({ ...me, from: '2026-09-01', to: '2026-12-11' }, [{ ...c3, from: '2027-01-05', to: '2027-04-10' }])).toEqual({});
  });

  it("lists a lecturer's classes today once, in time order", () => {
    const a = grid('a', 'Cohort 4', 'Fashion', { '0-4': s('Communication', 'Flavier', 'Hall'), '0-0': s('Garment Construction', 'Flavier', 'Room 3'), '0-2': s('Leadership', 'Andy', 'Hall') });
    const b = grid('b', 'Cohort 4', 'ICT', { '0-4': s('Communication', 'Flavier', 'Hall') });
    const draft = grid('d', 'Cohort 3', 'ICT', { '0-2': s('Web', 'Flavier', 'Lab') }, { published: false });
    expect(classesOn('2026-11-23', 'flavier', [a, b, draft]).map((c) => `${c.start} ${c.course}`)).toEqual(['08:00 Garment Construction', '14:00 Communication']);
    expect(classesOn('2026-11-24', 'flavier', [a, b])).toEqual([]);
    expect(classesOn('2026-11-23', 'flavier', [{ ...a, to: '2026-11-01' }])).toEqual([]);
  });
});

describe('exam timetable', () => {
  const row = (id: string, date: string, start: string, end: string, course: string, room: string, invigilator: string) => ({ id, date, start, end, course, sheetId: null, courseId: null, room, invigilator, invigilatorUid: '' });
  const tt = (id: string, cohort: string, rows: ExamTimetable['rows']): ExamTimetable & { id: string } => ({ id, orgId: 'adia', cohort, paper: 'final', semester: 1, month: '2026-12', name: '', rows, published: true, publishedOn: null, changedOn: null });
  it('names exam periods', () => {
    expect(examPeriodName('cat2', 1, '2026-10')).toBe('CAT 2 · Semester 1 · Oct 2026');
    expect(examPeriodName('final', 2, '2027-04')).toBe('End of semester exams · Semester 2 · Apr 2027');
  });
  it('warns about a room or invigilator twice at once', () => {
    const me = tt('a', 'Cohort 4', [row('1', '2026-12-01', '08:00', '11:00', 'Garment', 'Room 3', 'Mary'), row('2', '2026-12-01', '08:00', '10:00', 'Computers', 'Room 3', 'Grace'), row('3', '2026-12-02', '08:00', '10:00', 'Maths', 'Hall', 'Mary')]);
    const other = tt('b', 'Cohort 3', [row('9', '2026-12-02', '09:00', '10:00', 'Web', 'Lab', 'Mary')]);
    const out = examClashes(me, [other]);
    expect(out['1']).toEqual(['Room 3 has two papers at once']);
    expect(out['3']).toEqual(['Mary invigilates two papers at once (Cohort 3)']);
    expect(lastExamDate(me.rows)).toBe('2026-12-02');
    expect(lastExamDate([{ date: null }])).toBeNull();
  });
});
