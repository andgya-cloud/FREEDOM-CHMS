import { describe, expect, it } from 'vitest';
import { buildExamReport, departmentSummary, mergedMarks, DEFAULT_EXAM_SETTINGS, DEFAULT_EXAM_WEIGHTS, examSettingsWithDefaults, gradeFor, markProblem, parseMark, rankOf, sheetProgress, unitTotal, weightsProblem, type ExamSheet, type ExamStudent } from './exams';

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
  it('reads ABS and EX: absent counts as 0, exempt is left out of the weighting', () => {
    expect(parseMark(' abs ')).toEqual({ value: 'ABS', problem: null });
    expect(parseMark('Exempt').value).toBe('EX');
    expect(parseMark('72.5').value).toBe(72.5);
    expect(parseMark('').value).toBeNull();
    expect(parseMark('7o').problem).toMatch(/not a mark/);
    expect(markProblem('ABS', 10)).toBeNull();
    // 10/10/10/70: CAT 1 absent, the rest full marks -> 90.
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { cat1: 'ABS', cat2: 100, cat3: 100, final: 100 })).toMatchObject({ total: 90, complete: true, filled: 4 });
    // CAT 1 exempt: 100 over the 90% that is left.
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { cat1: 'EX', cat2: 100, cat3: 100, final: 100 })).toMatchObject({ total: 100, needed: 3 });
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { cat1: 'EX', cat2: 'EX', cat3: 'EX', final: 'EX' })).toMatchObject({ total: null, exempt: true, complete: true });
    expect(sheetProgress(sheet('x', 'ict', { a: { cat1: 'ABS', cat2: 'EX', cat3: 1, final: 1 } }), ['a'])).toBe(100);
  });
  it('lets a resit replace a failed course, never above the pass mark', () => {
    const fail = { cat1: 30, cat2: 30, cat3: 30, final: 30 };
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { ...fail, resit: 80 }, 39)).toMatchObject({ total: 39, resitUsed: true });
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { ...fail, resit: 35 }, 39)).toMatchObject({ total: 35, resitUsed: true });
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { ...fail, resit: 20 }, 39)).toMatchObject({ total: 30, resitUsed: false });
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { cat1: 50, cat2: 50, cat3: 50, final: 50, resit: 90 }, 39)).toMatchObject({ total: 50, resitUsed: false });
    expect(unitTotal(DEFAULT_EXAM_WEIGHTS, { ...fail, resit: 80 })).toMatchObject({ total: 30 });
  });
  it('marks a report provisional until every course is approved, and leaves exempt courses out', () => {
    const students = [st('a', 'Amina', 'ict')];
    const full = (v: number) => ({ cat1: v, cat2: v, cat3: v, final: v });
    const one = { ...sheet('Networking', 'ict', { a: full(80) }), status: 'approved' as const };
    const two = sheet('Entrepreneurship', null, { a: { cat1: 'EX', cat2: 'EX', cat3: 'EX', final: 'EX' } });
    const r = buildExamReport('ict', [one, two], students, DEFAULT_EXAM_SETTINGS);
    expect(r.rows[0]).toMatchObject({ average: 80, missing: 0, provisional: true });
    expect(r.rows[0]!.cells.Entrepreneurship!.exempt).toBe(true);
    expect(buildExamReport('ict', [one], students, DEFAULT_EXAM_SETTINGS).rows[0]!.provisional).toBe(false);
  });
  it('keeps one weighting scheme in the settings, with 10/10/10/70 when none is saved', () => {
    expect(examSettingsWithDefaults({}).weights).toEqual(DEFAULT_EXAM_WEIGHTS);
    const w = { ...DEFAULT_EXAM_WEIGHTS, final: { max: 60, wt: 70 } };
    expect(examSettingsWithDefaults({ weights: w }).weights.final.max).toBe(60);
  });
  it('lays each paper\'s own marks over the older marks map', () => {
    const merged = mergedMarks({ marks: { a: { cat1: 5, cat2: 6 }, b: { final: 40 } }, cat1Marks: { a: 9, c: 'ABS' }, finalMarks: { b: null }, resitMarks: { b: 50 } });
    expect(merged).toEqual({ a: { cat1: 9, cat2: 6 }, b: { final: null, resit: 50 }, c: { cat1: 'ABS' } });
  });
  it('sums up a department so far, with running totals while CATs come in', () => {
    const students = [st('a', 'Amina', 'ict'), st('b', 'Brian', 'ict'), st('c', 'Cate', 'catering')];
    const sheets = [
      { ...sheet('Networking', 'ict', { a: { cat1: 80 }, b: { cat1: 30 } }), status: 'draft' as const },
      sheet('Entrepreneurship', null, { a: { cat1: 60 }, c: { cat1: 90 } }),
    ];
    const d = departmentSummary('ict', sheets, students, DEFAULT_EXAM_SETTINGS);
    expect(d.rows.map((r) => [r.name, r.soFar, r.marked, r.courses, r.position, r.grade])).toEqual([
      ['Amina', 70, 2, 2, 1, 'Credit'], ['Brian', 30, 1, 2, 2, 'Fail'],
    ]);
    expect(d).toMatchObject({ classAverage: 50, passed: 1, graded: 2, courses: 2, provisional: true });
    expect(d.byGrade).toMatchObject({ Credit: 1, Fail: 1, Distinction: 0 });
  });
});
