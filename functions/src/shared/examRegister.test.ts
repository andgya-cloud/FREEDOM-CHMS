import { describe, expect, it } from 'vitest';
import {
  nitaLineFor, orderSittings, readTranscriptSerial, registerCounts, registerId, sittingName, suggestSitting, transcriptFingerprint, transcriptSerial, typedPointsProblem,
} from './examRegister';
import type { CourseLine } from './examResults';

const course = (courseName: string, total: number | null): CourseLine => ({ sheetId: courseName, courseName, teacherName: '', total, partial: total, complete: total != null, approved: true, resitUsed: false });

describe('exam register', () => {
  it('names sittings and orders them newest first', () => {
    expect(sittingName(12, 2026)).toBe('NITA & college exams · Dec 2026');
    expect(orderSittings(['NITA & college exams · Jul 2026', 'Extra', 'NITA & college exams · Dec 2026', 'NITA & college exams · Apr 2027']))
      .toEqual(['NITA & college exams · Apr 2027', 'NITA & college exams · Dec 2026', 'NITA & college exams · Jul 2026', 'Extra']);
    expect(registerId('Cohort 4', 'NITA & college exams · Dec 2026')).toBe('Cohort-4__NITA-college-exams-Dec-2026');
  });

  it('suggests NITA only for a student who passed every course with enough attendance', () => {
    const base = { passMark: 39, minAttendance: 75 };
    expect(suggestSitting({ ...base, attendance: 94, semesters: [{ points: null, courses: [course('Tailoring', 80), course('Leadership', 70)] }] }))
      .toEqual({ nita: true, why: 'Passed 2 of 2 · attendance 94%' });
    expect(suggestSitting({ ...base, attendance: 94, semesters: [{ points: null, courses: [course('Tailoring', 80), course('Basic Mathematics', 31)] }] }))
      .toEqual({ nita: false, why: 'Failed Basic Mathematics (31)' });
    expect(suggestSitting({ ...base, attendance: 58, semesters: [{ points: null, courses: [course('Tailoring', 80)] }] }))
      .toEqual({ nita: false, why: 'Attendance 58% (minimum 75%)' });
    expect(suggestSitting({ ...base, attendance: null, semesters: [{ points: null, courses: [course('Tailoring', null)] }] }).nita).toBe(false);
    // Past results with points only.
    expect(suggestSitting({ ...base, minAttendance: null, attendance: null, semesters: [{ points: 66, courses: [] }, { points: null, courses: [] }] }))
      .toEqual({ nita: true, why: 'Passed every semester so far' });
    expect(suggestSitting({ ...base, attendance: 90, semesters: [{ points: 30, courses: [] }] }).nita).toBe(false);
  });

  it('counts each kind and the students not picked yet', () => {
    expect(registerCounts(['a', 'b', 'c', 'd'], { a: { sits: 'nita' }, b: { sits: 'internal' }, c: { sits: null } })).toEqual({ nita: 1, internal: 1, none: 0, notPicked: 2 });
  });

  it('checks typed marks', () => {
    expect(typedPointsProblem('')).toBeNull();
    expect(typedPointsProblem('64.5')).toBeNull();
    expect(typedPointsProblem('101')).not.toBeNull();
    expect(typedPointsProblem('abc')).not.toBeNull();
  });

  it('puts the latest NITA sitting on the transcript', () => {
    const regs = [
      { sitting: 'NITA & college exams · Jul 2026', entries: { s1: { sits: 'nita' as const, trade: 'Dressmaking', grade: 'Grade III', nitaResult: 'fail' as const } } },
      { sitting: 'NITA & college exams · Dec 2026', entries: { s1: { sits: 'nita' as const, trade: 'Dressmaking', grade: 'Grade III', nitaResult: 'pass' as const } } },
    ];
    expect(nitaLineFor('s1', regs)).toBe('Dressmaking Grade III: Pass (Dec 2026)');
    expect(nitaLineFor('s2', regs)).toBe('');
  });
});

describe('transcript serial numbers', () => {
  it('formats and reads serials', () => {
    expect(transcriptSerial(2026, 7)).toBe('ADIA/TR/2026/0007');
    expect(readTranscriptSerial(' adia/tr/2026/7 ')).toBe('ADIA/TR/2026/0007');
    expect(readTranscriptSerial('ADIA TR 2026 0012')).toBe('ADIA/TR/2026/0012');
    expect(readTranscriptSerial('2026/12')).toBeNull();
  });
  it('gives the same fingerprint for the same result', () => {
    const t = { semesters: [{ points: 60, partial: 60, courses: [{ courseName: 'A', total: 60 }] }], finalPoints: null, finalGrade: 'Incomplete', provisional: true, nita: '', attendance: 90 };
    expect(transcriptFingerprint(t)).toBe(transcriptFingerprint({ ...t }));
    expect(transcriptFingerprint(t)).not.toBe(transcriptFingerprint({ ...t, provisional: false }));
  });
});
