import { describe, expect, it } from 'vitest';
import { findColumns, importDate, planStudentImport, suggestCourse } from './studentImport';

const have = {
  courses: [{ id: 'ict', name: 'ICT', levels: ['Level 1', 'Level 2'] }],
  intakes: [{ id: 'i1', courseId: 'ict', name: 'September 2026' }],
  people: [{ id: 'p1', fullName: 'Amina Hassan', phone: '+254712345678' }, { id: 'p2', fullName: 'Brian Otieno', phone: null }],
  students: [{ id: 'p2', admissionNo: 'ADIA/2026/0001' }],
};

describe('student import', () => {
  it('finds the header under a title row and understands other column names', () => {
    const f = findColumns([['ADIA class list'], [], ['No.', 'Student Name', 'Reg No', 'Course', 'Cohort', 'Mobile']]);
    expect(f).toEqual({ headerRow: 2, columns: { name: 1, admissionNo: 2, programme: 3, intake: 4, phone: 5 }, nameParts: [] });
    expect(findColumns([['S/N', 'NAMES OF TRAINEES', 'Course']])?.columns.name).toBe(1);
    expect(findColumns([['Guardian name', 'Course name']])).toBeNull();
    const split = planStudentImport([['First Name', 'Other Names', 'Surname', 'Course', 'Intake'], ['Jane', '', 'Wanjiru', 'ICT', 'September 2026']], have, { startDate: '2026-10-22' })!;
    expect(split.ready[0]!.name).toBe('Jane Wanjiru');
    expect(findColumns([['a', 'b']])).toBeNull();
  });
  it('reads Excel and typed dates', () => {
    expect(importDate(new Date(Date.UTC(2026, 8, 1)))).toBe('2026-09-01');
    expect(importDate(46266)).toBe('2026-09-01');
    expect(importDate('1/9/2026')).toBe('2026-09-01');
    expect(importDate('2026-09-01')).toBe('2026-09-01');
    expect(importDate('31/2/2026')).toBeNull();
  });
  it('plans what will be added, created and skipped', () => {
    const plan = planStudentImport([
      ['Name', 'Admission no', 'Phone', 'Gender', 'Programme', 'Intake', 'Level', 'Status', 'Sponsor name', 'Sponsor phone'],
      ['Amina Hassan', 'A-100', 712345678, 'F', 'ict', 'september 2026', 'level 1', 'Active', 'Mama Amina', '0722000000'],
      ['Brian Otieno', '', '', 'M', 'ICT', 'September 2026', '', '', '', ''],
      ['Cate Wairimu', 'ADIA/2026/0001', '', '', 'ICT', 'September 2026', '', '', '', ''],
      ['Dan Mwangi', 'A-101', 'not a phone', 'male', 'Catering', 'January 2027', '', 'Graduated', 'Uncle', ''],
      ['Dan Mwangi', 'A-101', '', '', 'Catering', 'January 2027', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['Eve Njeri', '', '', '', 'ICT', '', '', 'Dropped out', '', ''],
    ], have, { startDate: '2026-10-22' })!;
    const by = (n: string) => plan.rows.filter((r) => r.name === n);
    expect(by('Amina Hassan')[0]).toMatchObject({ personId: 'p1', courseId: 'ict', intakeId: 'i1', level: 'Level 1', gender: 'Female', phone: '+254712345678', skip: null, sponsor: { phone: '+254722000000' } });
    expect(by('Brian Otieno')[0]!.skip).toBe('already a student');
    expect(by('Cate Wairimu')[0]!.skip).toMatch(/already in ADIA/);
    expect(by('Dan Mwangi')[0]).toMatchObject({ newCourse: true, newIntake: true, graduated: true, status: 'enrolled', sponsor: null, skip: null });
    expect(by('Dan Mwangi')[0]!.notes.join(' ')).toMatch(/phone "not a phone" left out/);
    expect(by('Dan Mwangi')[1]!.skip).toMatch(/twice/);
    expect(by('Eve Njeri')[0]).toMatchObject({ skip: 'no intake' });
    expect(plan.rows).toHaveLength(6);
    expect(plan.ready.map((r) => r.name)).toEqual(['Amina Hassan', 'Dan Mwangi']);
    expect(plan.newCourses).toEqual(['Catering']);
    expect(plan.newIntakes).toEqual([{ courseName: 'Catering', name: 'January 2027' }]);
    const withDefault = planStudentImport([['Name'], ['Faith Akinyi']], have, { programme: 'ICT', intake: 'September 2026', startDate: '2026-10-22' })!;
    expect(withDefault.ready[0]).toMatchObject({ courseId: 'ict', intakeId: 'i1' });
    expect(withDefault.missingColumns).toEqual([]);
  });
  it('reads a workbook of one sheet per programme with cohort numbers', () => {
    const courses = [
      { id: 'food', name: 'Food and Beverage Production', levels: [] }, { id: 'ict', name: 'ICT', levels: [] },
      { id: 'tailor', name: 'Dressmaking & Tailoring', levels: [] }, { id: 'beauty', name: 'Beauty Therapy & Cosmetology', levels: [] },
    ];
    expect(['CATERING', 'HOSPITALITY', 'IT', 'TAILORING', 'COSMETOLOGY', 'Plumbing'].map((n) => suggestCourse(n, courses)?.id ?? null))
      .toEqual(['food', 'food', 'ict', 'tailor', 'beauty', null]);
    const head = [' NO', 'FULL NAMES', 'GENDER', 'ID', 'CONTACT', 'ADMISSION NUMBER', 'COURSE', 'REGISTRATION FEE', 'COHORT'];
    const plan = planStudentImport([
      { name: 'CATERING', rows: [head, [1, 'MAGDALINE NDANU MUTUKU', 'FEMALE', 35886851, 768436056, 'ADIA/ CTR/2025/1/001', 'CATERING', null, 1], [54, 'VIVIENNE ANYANGO', 'FEMALE', null, 719342119, 'ADIA/CTR/2026/4/054', 'HOSPITALITY', null, null]] },
      { name: 'IT', rows: [head, [1, 'ALICE TABANI MAROA', 'FEMALE', 1, 727653705, 'ADIA/IT/2025/1/001', 'IT', null, 1], [], []] },
      { name: 'Notes', rows: [['Fees are due on the 5th']] },
    ], { courses, intakes: [], people: [], students: [] }, { startDate: '2026-10-22', courseMap: { it: '' } })!;
    expect(plan.ready.map((r) => [r.sheet, r.name, r.admissionNo, r.programme, r.intake, r.phone])).toEqual([
      ['CATERING', 'Magdaline Ndanu Mutuku', 'ADIA/CTR/2025/1/001', 'Food and Beverage Production', 'Cohort 1', '+254768436056'],
      ['CATERING', 'Vivienne Anyango', 'ADIA/CTR/2026/4/054', 'Food and Beverage Production', 'Cohort 4', '+254719342119'],
      ['IT', 'Alice Tabani Maroa', 'ADIA/IT/2025/1/001', 'IT', 'Cohort 1', '+254727653705'],
    ]);
    expect(plan.programmes.map((p) => [p.name, p.courseId, p.rows])).toEqual([['Catering', 'food', 1], ['Hospitality', 'food', 1], ['IT', null, 1]]);
    expect(plan.sheetsSkipped).toEqual(['Notes']);
    expect(plan.newIntakes).toEqual([{ courseName: 'Food and Beverage Production', name: 'Cohort 1' }, { courseName: 'Food and Beverage Production', name: 'Cohort 4' }, { courseName: 'IT', name: 'Cohort 1' }]);
  });
});
