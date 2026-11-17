import { describe, expect, it } from 'vitest';
import {
  canChange, cleanFileName, dayColours, dayLabel, fridayEmail, isAllowedDay, lessonDaysOf, lessonFileType, missingLessons, teachingCourses, uploadFileId, weekBox, weekRange, zipPath,
} from './lessonPlans.js';

const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('teachingCourses', () => {
  const sheets = [
    { id: 'a', courseName: 'Leadership', cohort: 'Cohort 4', ownerUid: 'andy', courseId: null },
    { id: 'b', courseName: 'Leadership', cohort: 'Cohort 4', ownerUid: 'andy', courseId: null }, // Semester 2 sheet
    { id: 'c', courseName: 'Leadership', cohort: 'Cohort 3', ownerUid: 'andy', courseId: null },
    { id: 'd', courseName: 'Wiring', cohort: 'Cohort 4', ownerUid: 'jane', courseId: 'elec' },
    { id: 'e', courseName: 'Old', cohort: 'Cohort 1', ownerUid: 'andy' },
    { id: 'f', courseName: 'Gone', cohort: 'Cohort 4', ownerUid: 'andy', deletedAt: 1 },
  ];
  it('lists one entry per course and cohort with its register, skipping closed cohorts and other teachers', () => {
    expect(teachingCourses('andy', sheets, new Set(['Cohort-1']))).toEqual([
      { key: 'c-leadership-cohort-3', label: 'Leadership · Cohort 3', registerName: 'Leadership · Cohort 3' },
      { key: 'c-leadership-cohort-4', label: 'Leadership · Cohort 4', registerName: 'Leadership · Cohort 4' },
    ]);
    expect(teachingCourses('jane', sheets, new Set(), [], { elec: 'Electrical' })[0]!.registerName).toBe('Electrical');
  });
  it('adds the principal\'s own courses', () => {
    const manual = [{ id: 'm1', name: 'Entrepreneurship', department: 'common', cohort: 'Cohort 4', tutorUid: 'sam', tutorName: 'Sam' }];
    expect(teachingCourses('sam', sheets, new Set(), ['Plumbing'], {}, manual)).toEqual([{ key: 'm-m1', label: 'Entrepreneurship · Cohort 4', registerName: 'Entrepreneurship · Cohort 4' }]);
  });
  it('falls back to class registers when the teacher has no courses', () => {
    expect(teachingCourses('sam', sheets, new Set(), ['Electrical', 'Electrical'])).toEqual([{ key: 'r-electrical', label: 'Electrical', registerName: 'Electrical' }]);
  });
});

describe('lesson days', () => {
  const courses = [{ key: 'w', label: 'Wiring', registerName: 'Electrical' }, { key: 's', label: 'Safety', registerName: 'Electrical' }, { key: 'l', label: 'Leadership', registerName: 'Leadership · Cohort 4' }];
  const events = [
    { name: 'Electrical', date: '2026-11-16', type: 'class', createdBy: 'jane' }, { name: 'Electrical', date: '2026-11-16', type: 'class', createdBy: 'jane' },
    { name: 'Electrical', date: '2026-11-17', type: 'class', createdBy: 'jane' }, { name: 'Leadership · Cohort 4', date: '2026-11-17', type: 'class', updatedBy: 'jane' },
    { name: 'Plumbing', date: '2026-11-17', type: 'class', createdBy: 'jane' }, { name: 'Electrical', date: '2026-11-20', type: 'class', createdBy: 'jane' },
    // Marked by someone else: never a day for Jane (Andy, round 3).
    { name: 'Electrical', date: '2026-11-12', type: 'class', createdBy: 'flavier' },
  ];
  const lessons = lessonDaysOf('jane', courses, events, '2026-11-17');
  const plans = [{ status: 'sent' as const, docType: 'lesson', courseKey: 's', day: '2026-11-16', files: [1] }, { status: 'sent' as const, docType: 'lesson', courseKey: 'w', day: '2026-11-19', files: [1] }];
  it('finds the registers marked, once each, not in the future', () => expect(lessons).toHaveLength(3));
  it('counts a plan for any course taught in that register', () => {
    expect(missingLessons(lessons, courses, plans).map((l) => `${l.date} ${l.registerName}`)).toEqual(['2026-11-17 Electrical', '2026-11-17 Leadership · Cohort 4']);
  });
  it('colours the calendar', () => {
    expect(dayColours(courses[0]!, courses, lessons, plans)).toEqual({ '2026-11-16': 'done', '2026-11-17': 'missing', '2026-11-19': 'done' });
  });
  it('fills the principal\'s box', () => expect(weekBox('2026-11-16', lessons, courses, plans)).toEqual({ sent: 2, missing: 2 }));
  it('names days and weeks', () => {
    expect(dayLabel('2026-11-17')).toBe('Tue 17 Nov');
    expect(weekRange('2026-11-16')).toBe('16 to 22 Nov');
    expect(weekRange('2026-12-28')).toBe('28 Dec to 3 Jan');
  });
  it('checks dates and ids', () => {
    expect(isAllowedDay('2026-11-10', '2026-11-17')).toBe(true);
    expect(isAllowedDay('2024-01-01', '2026-11-17')).toBe(true);
    expect(isAllowedDay('2026-12-02', '2026-11-17')).toBe(false);
    expect(uploadFileId('w', 'lesson', '2026-11-17', 'u')).toBe('lp_w_2026-11-17_u');
    expect(uploadFileId('w', 'scheme', '', 'u')).toBe('cf_w_scheme_u');
  });
  it('writes the Friday email', () => {
    const e = fridayEmail('Jane', missingLessons(lessons, courses, plans), 'https://x');
    expect(e.subject).toBe('Lesson plans missing for 2 lessons');
    expect(e.text).toContain('• Tue 17 Nov: Electrical');
  });
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

describe('locking and zip', () => {
  it('locks only once approved, unless reopened', () => {
    expect(canChange(null, '2026-11-17')).toBe(true);
    expect(canChange({ status: 'sent' }, '2026-11-17')).toBe(true);
    expect(canChange({ status: 'returned' }, '2026-11-17')).toBe(true);
    expect(canChange({ status: 'approved' }, '2026-11-17')).toBe(false);
    expect(canChange({ status: 'approved', reopenUntil: '2026-11-18' }, '2026-11-17')).toBe(true);
  });
  it('names zip entries', () => {
    const taken = new Set<string>();
    expect(zipPath('Jane', 'Wiring · Cohort 4', 'a.pdf', taken)).toBe('Jane/Wiring · Cohort 4/a.pdf');
    expect(zipPath('Jane', 'Wiring · Cohort 4', 'a.pdf', taken)).toBe('Jane/Wiring · Cohort 4/a (2).pdf');
  });
});
