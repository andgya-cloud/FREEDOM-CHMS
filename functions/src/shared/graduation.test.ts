import { describe, expect, it } from 'vitest';
import { parseGraduationList } from './graduation';

describe('graduation list', () => {
  it('reads each department table, tidies admission numbers and keeps fails off the graduates', () => {
    const rows = [
      ['FINAL GRADUATION LIST FOR SEPTEMBER INTAKE'],
      ['FASHION AND DESIGN DEPARTMENT'],
      ['STUDENT NAME', 'ADM NO.', 'POINTS', 'GRADE'],
      ['EMMILY ACHIENG OMONDI', 'ADIA/TLF/2025/1/010', 72.69, 'CREDIT'],
      ['ANN NJIGI NGARI', 'ADIA/TLF/2025/1/008', '38.85', 'FAIL'],
      [],
      ['HOSPITALITY DEPARTMENT'],
      ['NAME', 'ADM NO.', 'POINTS', 'GRADE'],
      ['ANTONY MWAURA KIHARIE', 'ADIA/ CTR/2025/1/003', 60.61, 'CREDIT'],
      ['SUMMARY'],
      ['DEPARTMENT', 'DISTINCTION', 'CREDIT'],
      ['HOSPITALITY', '-', 9],
    ];
    const { rows: out, problems } = parseGraduationList([{ name: 'List', rows }]);
    expect(problems).toEqual([]);
    expect(out.map((r) => [r.department, r.name, r.admissionNo, r.points, r.grade, r.passed])).toEqual([
      ['FASHION AND DESIGN', 'EMMILY ACHIENG OMONDI', 'ADIA/TLF/2025/1/010', 72.69, 'Credit', true],
      ['FASHION AND DESIGN', 'ANN NJIGI NGARI', 'ADIA/TLF/2025/1/008', 38.85, 'Fail', false],
      ['HOSPITALITY', 'ANTONY MWAURA KIHARIE', 'ADIA/CTR/2025/1/003', 60.61, 'Credit', true],
    ]);
  });
  it('works out pass or fail from the points when there is no grade column', () => {
    const { rows } = parseGraduationList([{ name: '', rows: [['Name', 'Adm No', 'Points'], ['A', 'X/1', 40], ['B', 'X/2', 20]] }]);
    expect(rows.map((r) => r.passed)).toEqual([true, false]);
    expect(parseGraduationList([{ name: '', rows: [['nothing']] }]).problems[0]).toMatch(/No students/);
  });
});
