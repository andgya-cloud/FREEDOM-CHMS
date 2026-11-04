import { describe, expect, it } from 'vitest';
import {
  cellDate, championSummary, dayTrend, kidRate, minutesBetween, monthGrid, planChampionImport, planChildImport, rateFrom, saturdayOnOrBefore, shiftMonth,
  type ChampionDay, type HopeDay,
} from './hopeRegister';

describe('register percentages', () => {
  it('counts present and departing as there, and leaves excused out', () => {
    expect(rateFrom([{ s: 'present' }, { s: 'absent' }, { s: 'excused' }, { s: 'departing' }])).toEqual({ present: 2, absent: 1, excused: 1, marked: 4, pct: 67 });
    expect(rateFrom([{ s: 'excused' }]).pct).toBeNull();
  });
  it('gives each child their rate and the centre a trend', () => {
    const days: HopeDay[] = [
      { date: '2026-10-25', marks: { a: { s: 'present' }, b: { s: 'absent' } } },
      { date: '2026-11-01', marks: { a: { s: 'present' }, b: { s: 'present' } } },
      { date: '2026-10-18', marks: {} },
    ];
    expect(kidRate('a', days).pct).toBe(100);
    expect(kidRate('b', days).pct).toBe(50);
    expect(dayTrend(days)).toEqual([{ date: '2026-10-25', pct: 50, came: 1 }, { date: '2026-11-01', pct: 100, came: 2 }]);
  });
});

describe('calendar', () => {
  it('picks the Saturday on or before a day', () => {
    expect(saturdayOnOrBefore('2026-11-04')).toBe('2026-10-31'); // a Wednesday
    expect(saturdayOnOrBefore('2026-10-31')).toBe('2026-10-31');
    expect(saturdayOnOrBefore('2026-11-01')).toBe('2026-10-31');
  });
  it('lays a month out Monday first', () => {
    const g = monthGrid('2026-11'); // 1 November 2026 is a Sunday
    expect(g[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('champions', () => {
  it('adds up hours served and late days', () => {
    expect(minutesBetween('08:30', '12:00')).toBe(210);
    expect(minutesBetween('12:00', '08:00')).toBeNull();
    const days: ChampionDay[] = [
      { date: '2026-10-25', marks: { p: { s: 'late', in: '09:00', out: '12:00' } } },
      { date: '2026-11-01', marks: { p: { s: 'present', in: '08:00', out: '12:30' } } },
    ];
    const s = championSummary('p', days);
    expect(s.rate.pct).toBe(100);
    expect(s.late).toBe(1);
    expect(s.hours).toBe(7.5);
  });
});

describe('uploads', () => {
  it('reads dates in the usual ways', () => {
    expect(cellDate('2016-05-14')).toBe('2016-05-14');
    expect(cellDate('14/05/2016')).toBe('2016-05-14');
    expect(cellDate(new Date(Date.UTC(2016, 4, 14)))).toBe('2016-05-14');
    expect(cellDate(42504)).toBe('2016-05-14');
    expect(cellDate('31/02/2016')).toBeNull();
    expect(cellDate('soon')).toBeNull();
  });
  it('reads the children template, skipping those already registered or listed twice', () => {
    const rows = [
      ['Hope Centre children'],
      ['Name', 'Gender', 'DOB', 'School', 'Sponsor', 'Sponsor phone', 'Sponsor email', "Parent's name", "Parent's contact", 'Joined on', 'Photo consent', 'Guardian consent'],
      ['Faith Akinyi', 'F', '14/05/2016', 'Kibera Primary', 'John Smith', '', 'bad-email', 'Mary Atieno', '0712345678', '', 'Yes', 'no'],
      ['Brian Otieno', 'boy', 'later', '', '', '', '', '', '', '2025-01-11', '', ''],
      ['faith akinyi'],
      ['Old Child'],
      [null, null],
    ];
    const plan = planChildImport(rows, ['Old Child'], '2026-11-04')!;
    expect(plan).toHaveLength(4);
    expect(plan[0]).toMatchObject({ line: 3, name: 'Faith Akinyi', gender: 'Female', dateOfBirth: '2016-05-14', sponsorName: 'John Smith', sponsorEmail: '', parentName: 'Mary Atieno', parentPhone: '0712345678', enrolledOn: null, photoConsent: true, guardianConsent: false, skip: null });
    expect(plan[0]!.warn).toContain('sponsor email');
    expect(plan[1]).toMatchObject({ gender: 'Male', dateOfBirth: null, enrolledOn: '2025-01-11', photoConsent: null });
    expect(plan[1]!.warn).toContain('later');
    expect(plan[2]!.skip).toBe('listed twice');
    expect(plan[3]!.skip).toBe('already on the register');
    expect(planChildImport([['a', 'b']], [], '2026-11-04')).toBeNull();
  });
  it('reads the champions template', () => {
    const plan = planChampionImport([['Name', 'Phone', 'Email', 'Role'], ['Peter Otieno', '0722', 'p@x.org', 'Coach'], ['X']], [], '2026-11-04')!;
    expect(plan[0]).toMatchObject({ name: 'Peter Otieno', duty: 'Coach', skip: null });
    expect(plan[1]!.skip).toBe('no name');
  });
});

describe('little delights', async () => {
  const { streak, birthdayThisWeek, daysToBirthday } = await import('./hopeRegister');
  it('counts a streak, skipping excused days', () => {
    const days: HopeDay[] = [
      { date: '2026-10-03', marks: { a: { s: 'absent' }, b: { s: 'present' } } },
      { date: '2026-10-10', marks: { a: { s: 'present' }, b: { s: 'present' } } },
      { date: '2026-10-17', marks: { a: { s: 'excused' }, b: { s: 'present' } } },
      { date: '2026-10-24', marks: { a: { s: 'present' }, b: { s: 'present' } } },
      { date: '2026-10-31', marks: { a: { s: 'departing' } } },
    ];
    expect(streak('a', days)).toBe(3);
    expect(streak('b', days)).toBe(0);
  });
  it('finds birthdays in the week around today', () => {
    expect(daysToBirthday('2016-11-06', '2026-11-04')).toBe(2);
    expect(daysToBirthday('2016-01-02', '2026-12-31')).toBe(2);
    expect(birthdayThisWeek('2016-11-06', '2026-11-04')).toBe(true);
    expect(birthdayThisWeek('2016-11-02', '2026-11-04')).toBe(true);
    expect(birthdayThisWeek('2016-11-10', '2026-11-04')).toBe(false);
    expect(birthdayThisWeek(null, '2026-11-04')).toBe(false);
  });
});
