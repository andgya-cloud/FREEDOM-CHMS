import { describe, expect, it } from 'vitest';
import { clubDayOnOrBefore, clubSummary, levelLabel, memberRate, scheduleText, STARTER_CLUBS, type ClubDay } from './hopeClubs';

describe('clubs', () => {
  it('has the eight clubs Andy named', () => {
    expect(STARTER_CLUBS.map((c) => c.name)).toEqual(['Football Academy', 'Chess Club', 'Music Academy', 'Fashion and Design Club', 'Baking Club', 'Computer Club', 'Mat Making Club', 'Soap and Detergents Club']);
  });
  it('finds the club day on or before a date', () => {
    expect(clubDayOnOrBefore('Saturday', '2026-11-04')).toBe('2026-10-31');
    expect(clubDayOnOrBefore('Wednesday', '2026-11-04')).toBe('2026-11-04');
    expect(clubDayOnOrBefore('Thursday', '2026-11-04')).toBe('2026-10-29');
    expect(clubDayOnOrBefore('Sunday', '2026-11-04')).toBe('2026-11-01');
  });
  it('gives each member a rate and flags those under half', () => {
    const days: ClubDay[] = ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'].map((date, i) => ({
      clubId: 'c', date, marks: { a: { s: 'present' }, b: { s: i === 0 ? 'present' : 'absent' }, x: { s: 'excused' } },
    }));
    expect(memberRate('a', days).pct).toBe(100);
    expect(memberRate('b', days).pct).toBe(25);
    const s = clubSummary({ memberIds: ['a', 'b', 'x'] }, days);
    expect(s.sessions).toBe(4);
    expect(s.atRisk).toEqual(['b']);
    expect(s.pct).toBe(63);
  });
  it('labels levels and schedules', () => {
    expect(levelLabel({ name: 'Chess Club' })).toBe('Level reached');
    expect(scheduleText({ day: 'Saturday', time: '10:00', endTime: '12:00', place: 'Hall' })).toBe('Saturday · 10:00 to 12:00 · Hall');
  });
});
