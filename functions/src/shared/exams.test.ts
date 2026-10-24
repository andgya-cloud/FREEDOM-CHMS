import { describe, expect, it } from 'vitest';
import { buildExamReport, DEFAULT_EXAM_SETTINGS, DEFAULT_EXAM_WEIGHTS, gradeFor, markProblem, rankOf, sheetProgress, unitTotal, weightsProblem, type ExamSheet, type ExamStudent } from './exams';

const sheet = (id: string, courseId: string | null, marks: ExamSheet['marks'], weights = DEFAULT_EXAM_WEIGHTS): ExamSheet => ({
  id, cohort: 'September 2026', courseId, ownerUid: 'u', ownerName: 'T', courseName: id, teacherName: 'Grace', weights, status: 'draft', marks,
});
const st = (id: string, name: string, courseId: string): ExamStudent => ({ id, name, admissionNo: id.toUpperCase(), courseId, courseName: courseId.toUpperCase() });

// The bands these tests were written with (before ADIA's 79 / 59 / 39, Andy 2026-10-24).
const OLD = { ...DEFAULT_EXAM_SETTINGS, passMark: 70, bands: [
  { min: 85, grade: 'Distinction', remark: 'Outstanding performance' }, { min: 78, grade: 'Credit', remark: 'Very good performance' },
  { min: 70, grade: 'Pass', remark: 'Satisfactory performance' }, { min: 0, grade: 'Fail', remark: 'Below pass mark; resit required' }] };

describe('exam records', () => {
  it('weights each paper by its percentage and its own out-of', () => {
    // CAT 1 8/10 at 10%, CAT 2 15/20 at 10%, CAT 3 9/10 at 10%, Final 56/70 at 70% -> 80+75+90 = 24.5, + 56 = 80.5
    const w = { cat1: { max: 10, wt: 10 }, cat2: { max: 20, wt: 10 }, cat3: { max: 10, wt: 10 }, final: { max: 70, wt: 70 } };
    expect(unitTotal(w, { cat1: 8, cat2: 15, cat3: 9, final: 56 })).toMatchObject({ total: 80.5, complete: true, filled: 4, needed: 4 });
    expect(unitTotal(w, { cat1: 8 })).toMatchObject({ total: null, partial: 8, complete: false, filled: 1 });
    // A paper worth 0% is not needed.
    expect(unitTotal({ ...w, cat3: { max: 10, wt: 0 } }, { cat1: 10, cat2: 20, final: 70 })).toMatchObject({ total: 100, needed: 3 });
  });
  it('grades, ranks with shared positions and checks typed values', () => {
    expect(gradeFor(85, OLD).grade).toBe('Distinction');
    expect(gradeFor(69.9, OLD).grade).toBe('Fail');
    expect(rankOf([70, 90, 70, null, 60])).toEqual([2, 1, 2, null, 4]);
    expect(markProblem(11, 10)).toMatch(/most/);
    expect(markProblem(-1, 10)).toMatch(/negative/);
    expect(markProblem(null, 10)).toBeNull();
    expect(weightsProblem({ ...DEFAULT_EXAM_WEIGHTS, final: { max: 0, wt: 70 } })).toMatch(/Final/);
    expect(weightsProblem({ cat1: { max: 1, wt: 0 }, cat2: { max: 1, wt: 0 }, cat3: { max: 1, wt: 0 }, final: { max: 1, wt: 0 } })).toMatch(/more than 0/);
  });
  it('compiles a programme with its common courses, keeps edited remarks and attendance', () => {
    const students = [st('a', 'Amina', 'ict'), st('b', 'Brian', 'ict'), st('c', 'Cate', 'catering')];
    const full = (v: number) => ({ cat1: v, cat2: v, cat3: v, final: v });
    const sheets = [
      sheet('Networking', 'ict', { a: full(90), b: full(70) }),
      sheet('Cookery', 'catering', { c: full(80) }),
      sheet('Entrepreneurship', null, { a: full(80), b: { cat1: 50 }, c: full(60) }),
    ];
    const r = buildExamReport('ict', sheets, students, OLD, { remarks: { ict: { b: 'See me' } }, attendance: { a: 96 } });
    expect(r.units.map((u) => [u.courseName, u.common])).toEqual([['Networking', false], ['Entrepreneurship', true]]);
    expect(r.rows.map((x) => x.name)).toEqual(['Amina', 'Brian']);
    const [a, b] = r.rows;
    expect(a).toMatchObject({ average: 85, total: 170, grade: 'Distinction', position: 1, attendance: 96, missing: 0, remarks: 'Outstanding performance' });
    expect(b).toMatchObject({ average: 70, grade: 'Pass', position: 2, missing: 1, remarks: 'See me', remarksEdited: true });
    expect(b!.remarksAuto).toBe('Satisfactory performance. 1 unit not yet marked');
    const common = buildExamReport(null, sheets, students, OLD);
    expect(common.rows.map((x) => [x.name, x.average])).toEqual([['Amina', 80], ['Brian', null], ['Cate', 60]]);
  });
  it('measures how much of a sheet is keyed in', () => {
    expect(sheetProgress(sheet('x', 'ict', { a: { cat1: 1, cat2: 1, cat3: 1, final: 1 }, b: { cat1: 2 } }), ['a', 'b'])).toBe(63);
    expect(sheetProgress(sheet('x', 'ict', {}), [])).toBe(0);
  });
});
