import { describe, expect, it } from 'vitest';
import {
  cellDate, cellMark, childUpdate, planPastRegister, missedSaturdays, needsCall, whatFile, championSummary, dayTrend, kidRate, minutesBetween, monthGrid, planChampionImport, planChildImport, rateFrom, saturdayOnOrBefore, shiftMonth,
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
  it('keeps a code from the sheet; a code already here means that child, to update', () => {
    const plan = planChildImport([['Code', 'Name'], ['hc-7', 'A One'], ['HC-0002', 'B Two'], ['HC-0007', 'C Three'], ['nonsense', 'D Four']], [], '2026-11-04', ['HC-0002'])!;
    expect(plan.map((r) => r.code)).toEqual(['HC-0007', null, null, null]);
    expect(plan[1]).toMatchObject({ givenCode: 'HC-0002', skip: 'already on the register', warn: null });
    expect(plan[2]!.warn).toContain('already used');
    expect(plan[3]!.warn).toContain('not read');
  });
  it('reads the school fees and class, and "Birth date missing" as no date', () => {
    const plan = planChildImport([
      ['Code', 'Name', 'Date of birth', 'School', 'Class', 'Pay by', 'Pay number', 'Account', 'Pay to', 'Amount', 'Payment note'],
      ['HC-0001', 'A One', 'Birth date missing', 'Petunia School', '', 'Paybill', '247247', '804212#A', 'Petunia School', '', ''],
      ['HC-0002', 'B Two', '', 'Ruai Primary', 'Grade 3', 'Send money', '0723 432 743', '', 'Anna', 'KES 1,300 to the teacher', 'Also KES 700 to KCB'],
      ['HC-0003', 'C Three', '', '', '', 'bitcoin', '', '', '', '', ''],
      ['HC-0004', 'D Four'],
    ], [], '2026-11-04')!;
    expect(plan[0]).toMatchObject({ dateOfBirth: null, warn: null, payment: { by: 'paybill', number: '247247', account: '804212#A', payTo: 'Petunia School', amount: '', note: '' } });
    expect(plan[1]).toMatchObject({ schoolClass: 'Grade 3', payment: { by: 'send_money', number: '0723 432 743', amount: 'KES 1,300 to the teacher' } });
    expect(plan[2]!.warn).toContain('pay by');
    expect(plan[3]!.payment).toBeNull();
  });
  it('reads the champions template', () => {
    const plan = planChampionImport([['Name', 'Phone', 'Email', 'Role'], ['Peter Otieno', '0722', 'p@x.org', 'Coach'], ['X']], [], '2026-11-04')!;
    expect(plan[0]).toMatchObject({ name: 'Peter Otieno', duty: 'Coach', skip: null });
    expect(plan[1]!.skip).toBe('no name');
  });
  it('reads Andy\'s champions list and updates champions already here', () => {
    const rows = [['NAMES', 'CONTACT', 'Appreciation per week'], ['Faith Kimanthi', 724981960, 3000], ['Dorothy Mohat', 721995182, '9000 - fixed'], ['Kevin Kiihu', 796687443, 1500]];
    const plan = planChampionImport(rows, [{ id: 'k', name: 'Kevin Kiihu', phone: '0796687443', email: '', duty: '', weeklyPay: 1500 }], '2026-11-05')!;
    expect(plan.map((r) => [r.name, r.phone, r.weeklyPay, r.monthlyPay, r.updateId, r.skip])).toEqual([
      ['Faith Kimanthi', '0724 981 960', 3000, null, null, null],
      ['Dorothy Mohat', '0721 995 182', null, 9000, null, null],
      ['Kevin Kiihu', '0796 687 443', 1500, null, 'k', 'already up to date'],
    ]);
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

describe('missedSaturdays (v173)', () => {
  // 2026-10-17, 10-24, 10-31 are Saturdays; 10-28 is a Wednesday and does not count.
  const day = (date: string, marks: Record<string, { s: 'present' | 'absent' | 'excused' }>) => ({ date, marks });
  const days = [
    day('2026-10-17', { a: { s: 'absent' }, b: { s: 'present' }, c: { s: 'absent' } }),
    day('2026-10-24', { b: { s: 'absent' }, c: { s: 'excused' } }),
    day('2026-10-28', { a: { s: 'present' } }),
    day('2026-10-31', { a: { s: 'absent' }, b: { s: 'absent' } }),
  ];
  it('flags a child who missed the last three Saturdays', () => { expect(missedSaturdays('a', null, days)).toBe(true); });
  it('not if they came on one of them', () => { expect(missedSaturdays('b', null, days)).toBe(false); });
  it('not if one was excused', () => { expect(missedSaturdays('c', null, days)).toBe(false); });
  it('not if they joined after the first of them', () => { expect(missedSaturdays('a', '2026-10-20', days)).toBe(false); });
  it('not before three Saturdays were marked', () => { expect(missedSaturdays('a', null, days.slice(0, 2))).toBe(false); });
});

describe('v182', () => {
  const day = (date: string, s: string) => ({ id: date, orgId: 'o', date, marks: { k1: { s }, k2: { s: 'present' } } }) as never;
  const days = [day('2026-10-17', 'absent'), day('2026-10-24', 'absent'), day('2026-10-31', 'absent')];
  it('lists a child to call until the parent is called after the latest Saturday', () => {
    expect(needsCall({ id: 'k1', enrolledOn: '2026-01-01' }, days)).toBe(true);
    expect(needsCall({ id: 'k1', enrolledOn: '2026-01-01', calledOn: '2026-11-02' }, days)).toBe(false);
    expect(needsCall({ id: 'k1', enrolledOn: '2026-01-01', calledOn: '2026-10-25' }, days)).toBe(true);
    expect(needsCall({ id: 'k2', enrolledOn: '2026-01-01' }, days)).toBe(false);
  });
  it('tells what a spreadsheet is from its headings', () => {
    expect(whatFile([['Child Registration List'], ['Child ID', 'Name', 'Sponsor']])).toBe('sponsors');
    expect(whatFile([['NAMES', 'CONTACT', 'Appreciation per week']])).toBe('champions');
    expect(whatFile([['Name', 'Phone', 'Email', 'Duty']])).toBe('champions');
    expect(whatFile([['Name', 'Gender', 'Date of birth', 'School']])).toBe('children');
    expect(whatFile([['Item', 'Price']])).toBe(null);
  });
});

describe('past registers (Andy, 2026-11-06)', () => {
  const kids = [
    { id: 'a', code: 'HC-0001', name: 'Abdi R. Kibugi' },
    { id: 'b', code: 'HC-0002', name: 'Faith Wanjiru Irungu' },
    { id: 'c', code: null, name: 'Lovejoy Adagala' },
  ];
  const sheet = [
    ['Summary title'], ['HC code', 'Name (app)', 'Gender'], ['HC-0001', 'Abdi R. Kibugi', 'Male'],
    ['One row per child per Saturday'],
    ['Date', 'Month', 'HC code', 'Name (app)', 'Name on sheet', 'Class', 'Gender', 'Status'],
    [new Date(Date.UTC(2026, 5, 6)), 'June', 'HC-0001', 'Abdi R. Kibugi', 'Abdi R. Kibugi', 'Jasper', 'Male', 'Present'],
    ['2026-06-06', 'June', 'hc-0002', 'Someone else', 'Faith W Irungu', '', '', 'Absent'],
    ['6 Jun 2026', 'June', '', 'Lovejoy Adagala', 'Adagala L. Joy', '', '', '✓'],
    ['13/06/2026', 'June', '', '(not in app list)', 'Tura M. Wairimu', '', '', 'Present'],
    ['', 'June', 'HC-0001', '', '', '', '', 'Present'],
    ['Please check'],
  ];
  it('is told apart from other lists', () => {
    expect(whatFile(sheet)).toBe('register');
    expect(whatFile([['Name', 'Date of birth', 'School']])).toBe('children');
  });
  it('matches by code, then by name, and lists the rest', () => {
    const p = planPastRegister(sheet, kids)!;
    expect(p.days).toEqual({ '2026-06-06': { a: 'present', b: 'absent', c: 'present' } });
    expect(p.unmatched).toEqual([{ name: 'Tura M. Wairimu', rows: 1 }]);
    expect(p.rows).toBe(4);
    expect(p.skipped).toBe(1);
  });
  it('reads marks', () => {
    expect(cellMark('✗')).toBe('absent'); expect(cellMark('P')).toBe('present'); expect(cellMark('Late')).toBe('late'); expect(cellMark('?')).toBeNull();
  });
});

describe('updating children already here (Andy, 2026-11-06)', () => {
  it('takes every filled cell that differs, and leaves empty ones', () => {
    const [row] = planChildImport([['Code', 'Child Name', 'Gender', 'Date of birth', 'School', 'Registration Date'], ['HC-0063', 'Elsie W. Wangari', 'Female', 44227, '', '2025-05-29']], [], '2026-11-06', ['HC-0063'])!;
    expect(row).toMatchObject({ givenCode: 'HC-0063', skip: 'already on the register', dateOfBirth: '2021-01-31', enrolledOn: '2025-05-29' });
    const u = childUpdate(row!, { gender: '', dateOfBirth: null, school: 'Maua ECDE', schoolClass: '', sponsorName: '', sponsorPhone: '', sponsorEmail: '', parentName: '', parentPhone: '', enrolledOn: '2025-05-29', photoConsent: true, guardianConsent: null, payment: null });
    expect(u.gender).toBe('Female');
    expect(u.child).toEqual({ dateOfBirth: '2021-01-31' });
    expect(u.said).toEqual(['gender: none → Female', 'birth date: none → 2021-01-31']);
  });
});
