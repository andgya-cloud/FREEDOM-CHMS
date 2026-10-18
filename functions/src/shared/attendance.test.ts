import { describe, expect, it } from 'vitest';
import {
  attendanceIdFor,
  attendanceRate,
  cleanCount,
  doorName,
  eventChoices,
  eventIdFor,
  eventTypeFor,
  headcountTotal,
  phoneHint,
  weeksAttended,
} from './attendance';

describe('gatherings', () => {
  it('gives the same id to the same gathering on the same day, whichever device opens it', () => {
    expect(eventIdFor('2026-10-18', 'Sunday 10:00 service')).toBe('2026-10-18_sunday_10_00_service');
    expect(eventIdFor('2026-10-18', 'Dressmaking & Tailoring')).toBe('2026-10-18_dressmaking_and_tailoring');
    expect(eventIdFor('2026-10-18', 'Sunday 10:00 service')).toBe(eventIdFor('2026-10-18', 'sunday 10:00 SERVICE'));
    expect(eventIdFor('2026-10-18', '***')).toBe('2026-10-18_event');
  });

  it('stores one attendance record per person per gathering', () => {
    expect(attendanceIdFor('2026-10-18_ict', 'p1')).toBe('2026-10-18_ict_p1');
  });

  it('offers service times at a church and programmes elsewhere', () => {
    expect(eventChoices({ type: 'church_campus', serviceTimes: ['Sunday 08:00', 'Sunday 10:00', 'Youth service'] }))
      .toEqual(['Sunday 08:00 service', 'Sunday 10:00 service', 'Youth service']);
    expect(eventChoices({ type: 'church_campus' })).toEqual(['Sunday 10:00 service']);
    expect(eventChoices({ type: 'college' })).toContain('ICT');
    expect(eventChoices({ type: 'ministry' })).toEqual(['Saturday meals', 'Football academy', 'Chess club', 'Music academy']);
    expect(eventChoices({ type: 'ministry', activities: ['Holiday club'] })).toEqual(['Holiday club']);
  });

  it('picks the kind of gathering from the organization and name', () => {
    expect(eventTypeFor('church_campus', 'Sunday 10:00 service')).toBe('service');
    expect(eventTypeFor('college', 'ICT')).toBe('class');
    expect(eventTypeFor('ministry', 'Saturday meals')).toBe('meal');
    expect(eventTypeFor('ministry', 'Football academy')).toBe('session');
  });
});

describe('headcounts', () => {
  it('adds the counts that belong to each kind of gathering', () => {
    expect(headcountTotal({ adults: 180, teens: 25, children: 40 }, 'service')).toBe(245);
    expect(headcountTotal({ new: 12, returning: 88, adults: 5 }, 'meal')).toBe(100);
    expect(headcountTotal(undefined, 'service')).toBe(0);
  });

  it('turns whatever was typed into a whole, non-negative count', () => {
    expect(cleanCount('42')).toBe(42);
    expect(cleanCount('4.7')).toBe(4);
    expect(cleanCount('-3')).toBe(0);
    expect(cleanCount('abc')).toBe(0);
    expect(cleanCount(10_000_000)).toBe(100_000);
  });
});

describe('door tablet privacy', () => {
  it('shows only a first name and initial, and the last three digits of a phone', () => {
    expect(doorName('Grace Wanjiku Mwangi')).toBe('Grace M.');
    expect(doorName('  grace   wanjiku ')).toBe('grace W.');
    expect(doorName('Grace')).toBe('Grace');
    expect(phoneHint('+254712345678')).toBe('…678');
    expect(phoneHint(null)).toBe('');
  });
});

describe('attendance figures', () => {
  it('counts present and late as attended, and ignores records in the bin', () => {
    const r = attendanceRate([
      { date: '2026-10-01', status: 'present' },
      { date: '2026-10-02', status: 'late' },
      { date: '2026-10-03', status: 'absent' },
      { date: '2026-10-04', status: 'excused' },
      { date: '2026-10-05', status: 'present', deletedAt: new Date() },
    ]);
    expect(r).toEqual({ attended: 2, recorded: 4, percent: 50 });
    expect(attendanceRate([]).percent).toBeNull();
  });

  it('counts the Monday-to-Sunday weeks attended in the last 8 weeks', () => {
    // Sunday 18 October 2026, 11:00 in Nairobi.
    const now = new Date('2026-10-18T08:00:00Z');
    const records = [
      { date: '2026-10-18', status: 'present' }, // this week (12–18 Oct)
      { date: '2026-10-12', status: 'present' }, // same week, Monday: counted once
      { date: '2026-10-11', status: 'present' }, // last week (5–11 Oct)
      { date: '2026-08-24', status: 'present' }, // week of 24 Aug: the 8th week back
      { date: '2026-08-23', status: 'present' }, // week of 17 Aug: too old
      { date: '2026-10-04', status: 'absent' }, // not attended
      { date: '2026-09-27', status: 'present', deletedAt: 'x' }, // in the bin
    ];
    expect(weeksAttended(records, now, 8, 'Africa/Nairobi')).toBe(3);
  });
});
