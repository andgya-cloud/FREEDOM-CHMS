import { describe, expect, it } from 'vitest';
import { findColumns, importDate, planStudentImport } from './studentImport';

const have = {
  courses: [{ id: 'ict', name: 'ICT', levels: ['Level 1', 'Level 2'] }],
  intakes: [{ id: 'i1', courseId: 'ict', name: 'September 2026' }],
  people: [{ id: 'p1', fullName: 'Amina Hassan', phone: '+254712345678' }, { id: 'p2', fullName: 'Brian Otieno', phone: null }],
  students: [{ id: 'p2', admissionNo: 'ADIA/2026/0001' }],
};

describe('student import', () => {
  it('finds the header under a title row and understands other column names', () => {
    const f = findColumns([['ADIA class list'], [], ['No.', 'Student Name', 'Reg No', 'Course', 'Cohort', 'Mobile']]);
    expect(f).toEqual({ headerRow: 2, columns: { name: 1, admissionNo: 2, programme: 3, intake: 4, phone: 5 } });
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
});
