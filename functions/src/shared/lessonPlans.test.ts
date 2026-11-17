import { describe, expect, it } from 'vitest';
import {
  canChangeWeek, cellState, cleanFileName, isAllowedWeek, lessonFileType, missingCourses, reminderEmail, teachingCourses, weekChoices, weekFileId, weekRange, zipPath,
} from './lessonPlans.js';

const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('teachingCourses', () => {
  const sheets = [
    { id: 'a', courseName: 'Leadership', cohort: 'Cohort 4', ownerUid: 'andy' },
    { id: 'b', courseName: 'Leadership', cohort: 'Cohort 4', ownerUid: 'andy' }, // Semester 2 sheet
    { id: 'c', courseName: 'Leadership', cohort: 'Cohort 3', ownerUid: 'andy' },
    { id: 'd', courseName: 'Wiring', cohort: 'Cohort 4', ownerUid: 'jane' },
    { id: 'e', courseName: 'Old', cohort: 'Cohort 1', ownerUid: 'andy' },
    { id: 'f', courseName: 'Gone', cohort: 'Cohort 4', ownerUid: 'andy', deletedAt: 1 },
  ];
  it('lists one entry per course and cohort, skipping closed cohorts and other teachers', () => {
    expect(teachingCourses('andy', sheets, new Set(['Cohort-1']))).toEqual([
      { key: 'c-leadership-cohort-3', label: 'Leadership · Cohort 3' },
      { key: 'c-leadership-cohort-4', label: 'Leadership · Cohort 4' },
    ]);
  });
  it('falls back to class registers when the teacher has no sheets', () => {
    expect(teachingCourses('sam', sheets, new Set(), ['Electrical', 'Electrical'])).toEqual([{ key: 'r-electrical', label: 'Electrical' }]);
  });
});

describe('weeks', () => {
  it('offers next week, this week and earlier, only Mondays', () => {
    const w = weekChoices('2026-11-17');
    expect(w.find((x) => x.label.startsWith('Next week'))?.monday).toBe('2026-11-23');
    expect(w.find((x) => x.label.startsWith('This week'))?.monday).toBe('2026-11-16');
    expect(isAllowedWeek('2026-11-23', '2026-11-17')).toBe(true);
    expect(isAllowedWeek('2026-11-24', '2026-11-17')).toBe(false);
    expect(isAllowedWeek('2027-06-07', '2026-11-17')).toBe(false);
  });
  it('names a week plainly', () => {
    expect(weekRange('2026-11-16')).toBe('16 to 22 Nov');
    expect(weekRange('2026-12-28')).toBe('28 Dec to 3 Jan');
  });
  it('builds ids', () => expect(weekFileId('c-x', '2026-11-16', 'u1')).toBe('week_c-x_2026-11-16_u1'));
});

describe('lessonFileType', () => {
  it('accepts real files by their first bytes', () => {
    expect(lessonFileType('plan.pdf', bytes('%PDF-1.7'))?.contentType).toBe('application/pdf');
    expect(lessonFileType('plan.PPTX', bytes(0x50, 0x4b, 0x03, 0x04, 0))?.ext).toBe('pptx');
    expect(lessonFileType('plan.xls', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))?.ext).toBe('xls');
    expect(lessonFileType('page.jpg', bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType).toBe('image/jpeg');
    expect(lessonFileType('IMG_1.HEIC', bytes(0, 0, 0, 0x18, 'ftypheic'))?.ext).toBe('heic');
    expect(lessonFileType('notes.txt', bytes('Week 1: intro'))?.ext).toBe('txt');
  });
  it('refuses renamed or unknown files', () => {
    expect(lessonFileType('plan.pdf', bytes(0x4d, 0x5a))).toBeNull();
    expect(lessonFileType('virus.exe', bytes(0x4d, 0x5a))).toBeNull();
    expect(lessonFileType('notes.txt', bytes('a', 0, 'b'))).toBeNull();
  });
  it('cleans names', () => expect(cleanFileName('Week 3: plan/final.docx')).toBe('Week 3- plan-final.docx'));
});

describe('locking and the grid', () => {
  it('locks only once approved, unless reopened', () => {
    expect(canChangeWeek(null, '2026-11-17')).toBe(true);
    expect(canChangeWeek({ status: 'sent' }, '2026-11-17')).toBe(true);
    expect(canChangeWeek({ status: 'returned' }, '2026-11-17')).toBe(true);
    expect(canChangeWeek({ status: 'approved' }, '2026-11-17')).toBe(false);
    expect(canChangeWeek({ status: 'approved', reopenUntil: '2026-11-18' }, '2026-11-17')).toBe(true);
  });
  it('counts courses with a plan', () => {
    const plans = [{ courseKey: 'a', status: 'sent' as const, files: [1] }, { courseKey: 'b', status: 'sent' as const, files: [] }];
    expect(cellState(['a', 'b'], plans)).toEqual({ done: 1, of: 2, state: 'some' });
    expect(cellState(['a'], plans).state).toBe('all');
    expect(cellState(['b'], plans).state).toBe('none');
    expect(missingCourses([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], plans)).toEqual([{ key: 'b', label: 'B' }]);
  });
  it('writes the Friday email and zip paths', () => {
    const e = reminderEmail('Jane', '2026-11-23', [{ key: 'a', label: 'Wiring · Cohort 4' }], 'https://x/lp');
    expect(e.subject).toContain('23 to 29 Nov');
    expect(e.text).toContain('• Wiring · Cohort 4');
    const taken = new Set<string>();
    expect(zipPath('Jane', 'Wiring · Cohort 4', 'a.pdf', taken)).toBe('Jane/Wiring · Cohort 4/a.pdf');
    expect(zipPath('Jane', 'Wiring · Cohort 4', 'a.pdf', taken)).toBe('Jane/Wiring · Cohort 4/a (2).pdf');
  });
});
