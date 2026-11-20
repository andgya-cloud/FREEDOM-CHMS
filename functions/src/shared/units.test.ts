import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAM_SETTINGS, DEFAULT_EXAM_WEIGHTS, examSettingsWithDefaults, honoursFor, type ExamSheet } from './exams';
import { finalResult, semesterFromSheets } from './examResults';
import {
  ADIA_UNITS, creditPoints, guessUnitDept, matchUnit, normCode, sheetsThatDontFit, unitContext, unitDeptOf, unitProblem, unitsFor, unitsMissing, type UnitDept,
} from './units';

const sheet = (id: string, courseName: string, courseId: string | null, semester: 1 | 2, marks: Record<string, number> = {}, extra: Partial<ExamSheet> = {}): ExamSheet => ({
  id, cohort: 'Cohort 4', courseId, ownerUid: 'u', ownerName: 'T', courseName, teacherName: 'T', weights: DEFAULT_EXAM_WEIGHTS, status: 'approved', semester,
  marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, { cat1: v, cat2: v, cat3: v, final: v }])), ...extra,
});
const DEPTS: Record<string, UnitDept> = { ict: 'it', fd: 'fashion', ctr: 'hospitality' };
const deptOf = (id: string) => DEPTS[id] ?? null;

describe('units list', () => {
  it('grades A to E, gives Honours, and replaces the old Distinction bands', () => {
    expect([honoursFor(79), honoursFor(78.9), honoursFor(59), honoursFor(39), honoursFor(38.9)]).toEqual(['Distinction', 'Credit', 'Credit', 'Pass', 'Fail']);
    const old = examSettingsWithDefaults({ bands: [{ min: 79, grade: 'Distinction', remark: '' }, { min: 59.01, grade: 'Credit', remark: '' }, { min: 39, grade: 'Pass', remark: '' }, { min: 0, grade: 'Fail', remark: '' }] });
    expect(old.bands.map((b) => b.grade)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(finalResult(70, 80, DEFAULT_EXAM_SETTINGS)).toMatchObject({ final: 75, grade: 'Credit', letter: 'B' });
  });

  it('lists each department\'s units per semester with the right common units', () => {
    const it1 = unitsFor(ADIA_UNITS, 'it', 1).map((x) => x.code);
    expect(it1).toEqual(['COP 101', 'COP 102', 'COP 103', 'COP 104', 'COP 105', 'COP 106', 'COM 100', 'SBM 100', 'AFLT 100']);
    expect(unitsFor(ADIA_UNITS, 'fashion', 1).map((x) => x.code)).toContain('ICT 102');
    expect(unitsFor(ADIA_UNITS, 'hospitality', 2).map((x) => x.code)).toContain('SBM 101');
    expect(unitsFor(ADIA_UNITS, 'fashion', 2).map((x) => x.code)).not.toContain('SBM 101');
    expect(normCode('cop-101')).toBe('COP 101');
    expect([guessUnitDept('ICT'), guessUnitDept('Fashion and Design'), guessUnitDept('Catering'), guessUnitDept('Beauty Therapy & Cosmetology'), guessUnitDept('Music')]).toEqual(['it', 'fashion', 'hospitality', 'cosmetology', null]);
    expect(unitDeptOf('x', 'Music', { x: 'it' })).toBe('it');
    expect(unitDeptOf('x', 'ICT', { x: 'none' })).toBe(null);
  });

  it('matches marks sheets to units by code, common course or name', () => {
    expect(matchUnit(sheet('a', 'Leadership', null, 2), null, ADIA_UNITS)?.unit.code).toBe('AFLT 101');
    expect(matchUnit(sheet('a', 'Basic Mathematics', null, 1), null, ADIA_UNITS)?.unit.code).toBe('SBM 100');
    expect(matchUnit(sheet('a', 'Business Skills', null, 1), null, ADIA_UNITS)?.unit).toMatchObject({ code: 'BUS 100', semester: 2 });
    expect(matchUnit(sheet('a', 'Dress Making Practical', 'fd', 2), 'fashion', ADIA_UNITS)?.unit.code).toBe('DRS 104');
    expect(matchUnit(sheet('a', 'COP 103 Spreadsheets', 'ict', 1), 'it', ADIA_UNITS)?.unit.code).toBe('COP 103');
    expect(matchUnit(sheet('a', 'Food and Beverage Production', 'ctr', 1), 'hospitality', ADIA_UNITS)).toBe(null);
    expect(matchUnit(sheet('a', 'Anything', 'ctr', 1, {}, { unitCode: 'FBSS 102' }), 'hospitality', ADIA_UNITS)?.unit.kind).toBe('practical');
  });

  it('weights semester points by credit, and leaves out common units a department does not take', () => {
    expect(creditPoints([{ value: 80, credit: 1.4 }, { value: 60, credit: 12.1 }])).toEqual({ points: 62.07, weighted: true, missing: 0 });
    expect(creditPoints([{ value: 80, credit: null }, { value: 60, credit: 0.3 }])).toEqual({ points: 70, weighted: false, missing: 1 });
    const sheets = [
      sheet('t', 'Dress Making Theory', 'fd', 2, { f: 80 }), sheet('p', 'Dress Making Practical', 'fd', 2, { f: 60 }),
      sheet('m', 'Basic Mathematics', null, 2, { f: 10, h: 10 }),
    ];
    const ctx = unitContext(ADIA_UNITS, deptOf);
    const f = semesterFromSheets(sheets, { id: 'f', courseId: 'fd' }, 2, 39, ctx);
    expect(f).toMatchObject({ points: 62.07, weighted: true });
    expect(f.courses.map((c) => c.code)).toEqual(['DRS 103', 'DRS 104']);
    const h = semesterFromSheets(sheets, { id: 'h', courseId: 'ctr' }, 2, 39, ctx);
    expect(h.courses.map((c) => c.code)).toEqual(['SBM 101']);
  });

  it('lists the sheets that don\'t fit and the units a cohort is missing', () => {
    const sheets = [
      sheet('b', 'Business Skills', null, 1), sheet('c1', 'Communication', null, 1), sheet('c2', 'Communication', null, 2),
      sheet('l1', 'Leadership', null, 1), sheet('l2', 'Leadership', null, 2), sheet('x', 'Computer Packages', 'ict', 1),
      sheet('cos', 'Hair Dressing', 'cos', 1),
    ].map((s) => ({ ...s, hasMarks: false }));
    const out = sheetsThatDontFit(sheets, ADIA_UNITS, deptOf).map((o) => [o.sheet.id, o.problem.kind]);
    expect(out).toEqual(expect.arrayContaining([['b', 'semester'], ['c2', 'duplicate'], ['x', 'unmatched']]));
    expect(out).toHaveLength(3);
    const missing = unitsMissing(sheets, ADIA_UNITS, [{ id: 'fd', dept: 'fashion' }, { id: 'cos', dept: 'cosmetology' }]);
    expect(missing.filter((m) => m.courseId === 'fd')).toHaveLength(8);
    expect(missing.some((m) => m.courseId === 'cos')).toBe(false);
    expect(missing.filter((m) => m.courseId == null).map((m) => m.unit.code)).not.toContain('AFLT 100');
  });

  it('checks a unit before saving', () => {
    expect(unitProblem({ ...ADIA_UNITS[0]!, code: 'X' }, ADIA_UNITS)).toMatch(/not a unit code/);
    expect(unitProblem({ ...ADIA_UNITS[0]!, credit: 0 }, ADIA_UNITS)).toMatch(/credit/);
    expect(unitProblem(ADIA_UNITS[0]!, [...ADIA_UNITS, ADIA_UNITS[0]!])).toMatch(/twice/);
    expect(ADIA_UNITS.map((x) => unitProblem(x, ADIA_UNITS)).filter(Boolean)).toEqual([]);
  });
});
