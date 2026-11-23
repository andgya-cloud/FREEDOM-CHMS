import { describe, expect, it } from 'vitest';
import {
  cleanDay, cleanLink, dayPlanned, groupReminderText, nextYearDate, openingYear, reminderText, seriesDates, ssFileType, sundayFrom, sundaysBetween, timetableYears, yearRows,
} from './ssTimetable.js';

describe('Sunday school timetable (Andy, 2026-11-24)', () => {
  it('lists the Sundays from December 2026 and the special days in between', () => {
    expect(sundayFrom('2026-11-24')).toBe('2026-11-29');
    expect(sundayFrom('2026-11-29')).toBe('2026-11-29');
    expect(sundaysBetween('2026-12-01', '2026-12-31')).toEqual(['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']);
    const vbs = { ...cleanDay({ date: '2026-12-16', title: 'Vacation Bible School' }, []), files: [] };
    expect(vbs.kind).toBe('special');
    expect(yearRows(2026, [vbs]).map((r) => r.date)).toEqual(['2026-12-06', '2026-12-13', '2026-12-16', '2026-12-20', '2026-12-27']);
    expect(yearRows(2027, []).length).toBe(52);
    expect(openingYear('2026-11-24')).toBe(2026);
    expect(openingYear('2027-12-28')).toBe(2028);
    expect(timetableYears('2026-11-24')).toEqual([2026, 2027]);
  });

  it('keeps only what was typed, for classes on the list', () => {
    const d = cleanDay({ date: '2026-12-06', theme: '  Joseph   forgives ', lessons: { 'age-3-5': { title: 'Joseph', link: 'javascript:alert(1)' }, ghost: { title: 'x' }, teens: {} } }, ['age-3-5', 'teens']);
    expect(d.theme).toBe('Joseph forgives');
    expect(Object.keys(d.lessons)).toEqual(['age-3-5']);
    expect(d.lessons['age-3-5']!.link).toBe('');
    expect(cleanLink('https://drive.google.com/file/d/abc/view')).toContain('drive.google.com');
    expect(dayPlanned({ ...cleanDay({ date: '2026-12-06' }, []), files: [] })).toBe(false);
  });

  it('fills a series, skipping Sundays with no Sunday school, and copies a year on', () => {
    expect(seriesDates('2026-12-01', 3, new Set(['2026-12-13']))).toEqual(['2026-12-06', '2026-12-20', '2026-12-27']);
    expect(nextYearDate('2026-12-06')).toBe('2027-12-05');
  });

  it('writes the WhatsApp reminders', () => {
    const day = { ...cleanDay({ date: '2026-12-06', theme: 'Joseph forgives', lessons: { a: { title: 'Forgiving', passage: 'Gen 45', verse: 'Eph 4:32' } } }, ['a']), files: [] };
    const t = reminderText({ first: 'Christine', day, date: '2026-12-06', className: '3-5 years', classId: 'a', leader: 'Christine', app: 'https://x', drive: 'https://d' });
    expect(t).toContain('Hello Christine');
    expect(t).toContain('Theme: Joseph forgives');
    expect(t).toContain('Memory verse: Eph 4:32');
    const g = groupReminderText({ day, date: '2026-12-06', classes: [{ id: 'a', name: '3-5 years', leader: 'Christine' }, { id: 'b', name: 'Teens', leader: 'David' }], app: 'https://x', drive: 'https://d' });
    expect(g).toContain('Teens · David');
    expect(g).toContain('Lesson to come');
    const off = { ...day, noClass: true, title: 'Christmas' };
    expect(reminderText({ first: 'Lucy', day: off, date: '2026-12-27', className: 'x', classId: 'a', leader: '', app: 'a', drive: 'd' })).toContain('No Sunday school this Sunday (Christmas)');
  });

  it('checks files really are what they say', () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    expect(ssFileType('song.mp4', mp4)?.contentType).toBe('video/mp4');
    expect(ssFileType('song.mp4', new Uint8Array([77, 90, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(ssFileType('plan.pdf', new TextEncoder().encode('%PDF-1.7'))?.ext).toBe('pdf');
  });
});
