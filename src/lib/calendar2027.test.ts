import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, auth: {} }));
const { CALENDAR_2027 } = await import('./calendar2027');
const { occurrences, weekdayOf } = await import('../../functions/src/shared/calendar');

describe('Freedom Church 2027 calendar', () => {
  it('is well formed, all in 2027, with no id twice', () => {
    const ids = new Set(CALENDAR_2027.map((r) => r.id));
    expect(ids.size).toBe(CALENDAR_2027.length);
    expect(CALENDAR_2027.length).toBeLessThan(450);
    for (const r of CALENDAR_2027) {
      expect(r.date.startsWith('2027-')).toBe(true);
      expect((r.endDate ?? r.date) >= r.date).toBe(true);
      expect(r.title.length).toBeLessThanOrEqual(120);
    }
  });
  it('repeats Bible study on Wednesdays and Communion on first Sundays', () => {
    const bs = CALENDAR_2027.find((r) => r.id === 'bible-study')!;
    const days = occurrences({ ...bs, endDate: bs.date, repeat: bs.repeat!, repeatUntil: bs.repeatUntil!, skipDates: bs.skipDates! }, '2027-01-01', '2027-12-31');
    expect(days.every((o) => weekdayOf(o.date) === 3)).toBe(true);
    expect(days.map((o) => o.date)).not.toContain('2027-01-13');
    expect(days.at(-1)!.date).toBe('2027-12-08');
    const c = CALENDAR_2027.find((r) => r.id === 'communion')!;
    const sundays = occurrences({ ...c, endDate: c.date, repeat: c.repeat!, repeatUntil: c.repeatUntil!, skipDates: [] }, '2027-01-01', '2027-12-31').map((o) => o.date);
    expect(sundays).toHaveLength(12);
    expect(sundays.every((d) => weekdayOf(d) === 0 && Number(d.slice(8)) <= 7)).toBe(true);
  });
});
