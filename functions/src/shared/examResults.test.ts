import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAM_SETTINGS, DEFAULT_EXAM_WEIGHTS, gradeFor } from './exams';
import { admissionKey, finalResult, parseMarksFile, parseResultsWorkbook, planResultImport, printedDiffers, semesterFromSheets } from './examResults';

const clean = ['Cohort', 'Programme_Code', 'Admission_No', 'Student_Name', 'Semester', 'Points', 'Grade'];
const workbook = [
  { name: 'README', rows: [['ADIA Training Centre - Cohort 3 Results']] },
  { name: 'Final_C3', rows: [['#', 'Programme', 'Admission No', 'Student Name', 'Sem 1 Points', 'Sem 2 Points', 'Final Points', 'Final Grade', 'Remark', 'Printed grad. list points', 'Printed grad. list grade'],
    [1, 'Hospitality', 'ADIA/CTR/2026/3/027', 'DORCAS', 54.8, 61.1, 57.95, 'PASS', null, 60.2, 'CREDIT']] },
  { name: 'Upload_Clean', rows: [clean,
    [3, 'CTR', 'ADIA/CTR/2026/3/027', 'DORCAS', 1, 54.8, 'PASS'],
    [3, 'CTR', 'ADIA/CTR/2026/3/027', 'DORCAS', 2, 61.1, 'CREDIT'],
    [3, 'IT', 'ADIA/IT/2026/3/042', 'GRACE', 1, 70, 'CREDIT'],
    [3, 'IT', 'ADIA/IT/9999/9/999', 'NOBODY', 1, 50, 'PASS']] },
  { name: 'Hold_For_Review', rows: [[...clean.slice(0, 6), 'Grade (as in source)', 'Reason held back'],
    [3, 'IT', 'ADIA/IT/2026/3/042', 'GRACE', 2, 0, 'FALSE', 'Score 0.0 / grade FALSE'],
    [3, 'COS', 'ADIA/COS/2026/3/001', 'ESTHER', 1, 52.4, 'PASS', 'Possibly incomplete marks']] },
  { name: 'Upload_All', rows: [['Cohort', 'Programme', 'Admission No', 'Student Name', 'Semester', 'Points'], ['Cohort 3', 'X', 'ADIA/CTR/2026/3/027', 'DORCAS', 'Semester 1', 99]] },
];
const students = [
  { id: 'd', admissionNo: 'ADIA/ CTR/2026/3/027', name: 'Dorcas', courseId: 'ctr', cohort: 'Cohort 3' },
  { id: 'g', admissionNo: 'ADIA/IT/2026/3/042', name: 'Grace', courseId: 'it', cohort: 'Cohort 3' },
  { id: 'e', admissionNo: 'ADIA/COS/2026/3/001', name: 'Esther', courseId: 'cos', cohort: 'Cohort 3' },
];

describe('semester results', () => {
  it('grades on ADIA bands: 79 Distinction, above 59 Credit, 39 to 59 Pass', () => {
    const g = (n: number) => gradeFor(n, DEFAULT_EXAM_SETTINGS).grade;
    expect([g(79), g(78.99), g(59.01), g(59), g(39), g(38.99)]).toEqual(['Distinction', 'Credit', 'Credit', 'Pass', 'Pass', 'Fail']);
  });

  it('reads Upload_Clean and held rows, skips Upload_All, and keeps printed figures', () => {
    const p = parseResultsWorkbook(workbook);
    expect(p.rows).toHaveLength(6);
    expect(p.rows.every((r) => r.points !== 99)).toBe(true);
    expect(p.rows[0]).toMatchObject({ cohort: 'Cohort 3', semester: 1, points: 54.8, held: null });
    expect(p.printed.get('ADIA/CTR/2026/3/027')).toEqual({ points: 60.2, grade: 'CREDIT' });
    expect(admissionKey('adia/ ctr/2026/3/027')).toBe('ADIA/CTR/2026/3/027');
  });

  it('matches by admission number, leaves held rows out unless asked, and lists strangers', () => {
    const p = parseResultsWorkbook(workbook);
    const plan = planResultImport(p, students);
    expect(plan.unmatched.map((r) => r.name)).toEqual(['NOBODY']);
    expect(plan.held).toHaveLength(2);
    const d = plan.results.find((r) => r.studentId === 'd')!;
    expect(d.semesters).toEqual({ 1: { points: 54.8, grade: 'PASS' }, 2: { points: 61.1, grade: 'CREDIT' } });
    expect(d.printed?.points).toBe(60.2);
    expect(plan.results.find((r) => r.studentId === 'g')!.warnings.join()).toMatch(/No Semester 2/);
    // Including held rows takes real scores but never a 0 / FALSE one.
    const withHeld = planResultImport(p, students, { includeHeld: true });
    expect(withHeld.results.find((r) => r.studentId === 'e')!.semesters['1']!.points).toBe(52.4);
    expect(withHeld.results.find((r) => r.studentId === 'g')!.semesters['2']).toBeUndefined();
  });

  it('averages the two semesters, and is incomplete without both', () => {
    expect(finalResult(54.8, 61.1, DEFAULT_EXAM_SETTINGS)).toMatchObject({ final: 57.95, grade: 'Pass', complete: true });
    expect(finalResult(70, null, DEFAULT_EXAM_SETTINGS)).toMatchObject({ final: null, grade: 'Incomplete' });
    expect(printedDiffers({ points: 60.2, grade: 'CREDIT' }, 57.95, DEFAULT_EXAM_SETTINGS)).toBe(true);
    expect(printedDiffers({ points: 50, grade: 'PASS' }, 57.95, DEFAULT_EXAM_SETTINGS)).toBe(false);
    expect(printedDiffers({ points: 57.96, grade: null }, 57.95, DEFAULT_EXAM_SETTINGS)).toBe(false);
  });

  it('builds a semester from the course sheets as the CATs come in', () => {
    const sheet = (id: string, semester: number | null, courseId: string | null, m: Record<string, number>) =>
      ({ id, semester, courseId, courseName: id, teacherName: 'T', weights: DEFAULT_EXAM_WEIGHTS, marks: { s: m } });
    const sheets = [sheet('a', 1, 'it', { cat1: 80, cat2: 80, cat3: 80, final: 80 }), sheet('b', 1, null, { cat1: 60 }), sheet('c', 2, 'it', { cat1: 50 }), sheet('d', 1, 'ctr', { cat1: 10 })];
    const s1 = semesterFromSheets(sheets, { id: 's', courseId: 'it' }, 1);
    expect(s1.courses.map((c) => c.sheetId)).toEqual(['a', 'b']);
    // The running total adds each paper's share as it is marked: (80 + 6) ÷ 2.
    expect(s1).toMatchObject({ partial: 43, points: null, complete: false });
    sheets[1]!.marks.s = { cat1: 60, cat2: 60, cat3: 60, final: 60 };
    expect(semesterFromSheets(sheets, { id: 's', courseId: 'it' }, 1)).toMatchObject({ points: 70, complete: true });
  });

  it("reads a trainer's marks file and flags what is not a number", () => {
    const f = parseMarksFile([{ name: 'Marks', rows: [['Course: Networking'], ['Admission No', 'Name', 'CAT 1', 'CAT 2', 'CAT 3', 'Final Exam'], ['ADIA/IT/1', 'Ann', 8, '', 'abs', 60], [null, null]] }]);
    expect(f.columns).toEqual(['cat1', 'cat2', 'cat3', 'final']);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ admissionNo: 'ADIA/IT/1', marks: { cat1: 8, final: 60 } });
    expect(f.rows[0]!.problems).toEqual(['"abs" is not a number']);
  });
});
