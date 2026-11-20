import { describe, expect, it } from 'vitest';
import { applyUploadRow, blankNitaResult, matchNitaRows, nitaCounts, nitaTranscriptLine, normaliseGrade, overallFrom, paperResult, parseNitaSheet, passRate, releaseLabel, tradeRates } from './nita';

describe('NITA results (Andy, 2026-11-20)', () => {
  it('works out the overall result from the two papers', () => {
    expect(overallFrom('pass', 'pass')).toBe('pass');
    expect(overallFrom('pass', 'fail')).toBe('fail');
    expect(overallFrom('absent', 'pass')).toBe('absent');
    expect(overallFrom('pending', 'pass')).toBe('pending');
    expect(overallFrom('pending', 'fail')).toBe('fail');
  });
  it('reads the words NITA uses', () => {
    expect(['Pass', 'P', 'Competent', 'PASSED'].map(paperResult)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(['Fail', 'NYC', 'Not yet competent', 'f'].map(paperResult)).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(['Abs', 'ABSENT', 'Pending', '', 'maybe'].map(paperResult)).toEqual(['absent', 'absent', 'pending', null, null]);
    expect(['III', 'Grade 2', 'G1', 'x'].map(normaliseGrade)).toEqual(['Grade III', 'Grade II', 'Grade I', '']);
  });
  it('counts, pass rates and the transcript line', () => {
    const c = nitaCounts(['pass', 'pass', 'fail', 'absent', 'pending']);
    expect(c).toEqual({ sat: 4, passed: 2, failed: 1, absent: 1, pending: 1 });
    expect(passRate(c)).toBe(67);
    expect(tradeRates([{ trade: 'ICT', overall: 'pass' }, { trade: 'ICT', overall: 'fail' }, { trade: 'Catering', overall: 'pending' }])).toEqual([{ trade: 'ICT', passed: 1, decided: 2, rate: 50 }]);
    expect(nitaTranscriptLine({ trade: 'ICT', grade: 'Grade III', overall: 'pass' }, 'Dec 2025')).toBe('ICT Grade III: Pass (Dec 2025)');
    expect(nitaTranscriptLine({ trade: 'ICT', grade: 'Grade III', overall: 'pending' }, 'Dec 2025')).toBe('');
    expect(releaseLabel({ releasedOn: null, sitting: 'Nov 2026' })).toBe('Not released yet · Nov 2026 sitting');
  });
  it('reads a NITA list and matches it to students', () => {
    const sheet = [['NATIONAL INDUSTRIAL TRAINING AUTHORITY'], [], ['S/No', 'Index No', 'Candidate Name', 'Trade', 'Grade', 'Theory', 'Practical', 'Result', 'Certificate No'],
      [1, 'NITA/2025/4165', 'Jane Achieng', 'Fashion Design', 'III', 'P', 'P', 'PASS', 'GTT 123'],
      [2, 'NITA/2025/9999', 'Otieno Brian', 'ICT', 'III', 'P', 'F', 'FAIL', ''],
      [3, 'NITA/2025/0001', 'Nobody Here', 'ICT', 'III', 'ABS', 'ABS', '', '']];
    const p = parseNitaSheet(sheet);
    expect(p.problem).toBeNull();
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ indexNo: 'NITA/2025/4165', grade: 'Grade III', theory: 'pass', practical: 'pass', overall: 'pass', certificateNo: 'GTT 123' });
    const m = matchNitaRows(p.rows, [{ id: 'a', name: 'Jane Achieng', admissionNo: 'X1' }, { id: 'b', name: 'Brian Otieno', admissionNo: 'X2' }], { a: 'nita/2025/4165' });
    expect(m.map((x) => [x.studentId, x.how])).toEqual([['a', 'index'], ['b', 'name'], [null, null]]);
    const after = applyUploadRow(blankNitaResult('o', 'b', 'Cohort 3', 'r'), p.rows[1]!);
    expect(after).toMatchObject({ theory: 'pass', practical: 'fail', overall: 'fail', overallSet: false, indexNo: 'NITA/2025/9999' });
    expect(parseNitaSheet([['a', 'b']]).problem).toMatch(/heading/);
  });
});
