import { describe, expect, it } from 'vitest';
import {
  cleanReminders, dueReminders, endsOnFor, occurrences, reminderLead, reminderUids, repeatLabel, serviceSlots, startInstant, whenLabel, type CalendarEvent,
} from './calendar.js';

const TZ = 'Africa/Nairobi';
const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', orgId: 'o', title: 'Leaders meeting', type: 'meeting', allDay: false, date: '2026-11-15', endDate: '2026-11-15',
  start: '10:00', end: '12:00', place: '', inCharge: '', notes: '', repeat: 'none', repeatUntil: null, skipDates: [],
  seriesId: null, seriesDate: null, reminders: [1440, 60], remindAll: false, invited: [], invitedNames: {}, responses: {},
  endsOn: '2026-11-15', createdBy: 'andy', createdByName: 'Andy', ...over,
});
const days = (e: CalendarEvent, from: string, to: string) => occurrences(e, from, to).map((o) => o.date);

describe('calendar occurrences', () => {
  it('shows a one-off event only on its day, and a three-day one on each day it touches', () => {
    expect(days(ev(), '2026-11-01', '2026-11-30')).toEqual(['2026-11-15']);
    expect(days(ev(), '2026-12-01', '2026-12-31')).toEqual([]);
    const camp = ev({ date: '2026-11-20', endDate: '2026-11-22' });
    expect(occurrences(camp, '2026-11-22', '2026-11-28')).toEqual([{ date: '2026-11-20', endDate: '2026-11-22' }]);
  });
  it('repeats every week and every two weeks, skipping days taken out, until the end day', () => {
    const sunday = ev({ repeat: 'weekly', skipDates: ['2026-11-29'], repeatUntil: '2026-12-13' });
    expect(days(sunday, '2026-11-01', '2026-12-31')).toEqual(['2026-11-15', '2026-11-22', '2026-12-06', '2026-12-13']);
    expect(days(ev({ repeat: 'fortnightly' }), '2027-01-01', '2027-01-31')).toEqual(['2027-01-10', '2027-01-24']);
    expect(days(ev({ repeat: 'daily' }), '2027-03-01', '2027-03-03')).toEqual(['2027-03-01', '2027-03-02', '2027-03-03']);
  });
  it('repeats monthly on the date (skipping short months) and on the nth or last weekday', () => {
    expect(days(ev({ date: '2027-01-31', endDate: '2027-01-31', repeat: 'monthly' }), '2027-01-01', '2027-05-31')).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
    // 15 Nov 2026 is the 3rd Sunday.
    expect(days(ev({ repeat: 'monthlyWeekday' }), '2026-12-01', '2027-01-31')).toEqual(['2026-12-20', '2027-01-17']);
    // 29 Nov 2026 is the last Sunday.
    expect(days(ev({ date: '2026-11-29', endDate: '2026-11-29', repeat: 'monthlyWeekday' }), '2027-01-01', '2027-02-28')).toEqual(['2027-01-31', '2027-02-28']);
  });
  it('repeats yearly, with 29 February only in leap years', () => {
    expect(days(ev({ date: '2028-02-29', endDate: '2028-02-29', repeat: 'yearly' }), '2028-01-01', '2033-12-31')).toEqual(['2028-02-29', '2032-02-29']);
  });
  it('knows the last day an event ends', () => {
    expect(endsOnFor(ev())).toBe('2026-11-15');
    expect(endsOnFor(ev({ repeat: 'weekly' }))).toBe('9999-12-31');
    expect(endsOnFor(ev({ repeat: 'weekly', repeatUntil: '2027-01-01', endDate: '2026-11-16' }))).toBe('2027-01-02');
  });
});

describe('calendar reminders', () => {
  it('starts in Nairobi time, and all-day events at 8:00', () => {
    expect(startInstant(ev(), '2026-11-15', TZ).toISOString()).toBe('2026-11-15T07:00:00.000Z');
    expect(startInstant(ev({ allDay: true, start: null }), '2026-11-15', TZ).toISOString()).toBe('2026-11-15T05:00:00.000Z');
  });
  it('finds the reminders due in the last few minutes, including on a repeating event', () => {
    const now = new Date('2026-11-15T06:02:00Z'); // 09:02 in Nairobi, 58 minutes before the start
    expect(dueReminders(ev(), now, 10 * 60_000, TZ).map((r) => [r.date, r.offset])).toEqual([['2026-11-15', 60]]);
    expect(dueReminders(ev(), new Date('2026-11-14T07:01:00Z'), 10 * 60_000, TZ).map((r) => r.offset)).toEqual([1440]);
    expect(dueReminders(ev(), new Date('2026-11-14T08:00:00Z'), 10 * 60_000, TZ)).toEqual([]);
    const weekly = ev({ repeat: 'weekly' });
    expect(dueReminders(weekly, new Date('2026-11-22T06:01:00Z'), 10 * 60_000, TZ).map((r) => r.date)).toEqual(['2026-11-22']);
    expect(dueReminders(ev({ reminders: [] }), now, 10 * 60_000, TZ)).toEqual([]);
  });
  it('words the reminder', () => {
    expect(reminderLead(ev(), '2026-11-15', new Date('2026-11-15T06:00:00Z'), TZ)).toBe('In 1 hour (10:00)');
    expect(reminderLead(ev(), '2026-11-15', new Date('2026-11-15T06:45:00Z'), TZ)).toBe('In 15 minutes (10:00)');
    expect(reminderLead(ev(), '2026-11-15', new Date('2026-11-14T07:00:00Z'), TZ)).toBe('Tomorrow at 10:00');
    expect(reminderLead(ev(), '2026-11-15', new Date('2026-11-08T07:00:00Z'), TZ)).toBe('Sun 15 Nov at 10:00 (in 7 days)');
  });
  it('reminds who added it and those invited who did not say No', () => {
    expect(reminderUids(ev({ invited: ['a', 'b', 'andy'], responses: { b: 'no', a: 'yes' } }))).toEqual(['andy', 'a']);
  });
  it('keeps only known reminder times, five at most', () => {
    expect(cleanReminders([60, 60, 7, 1440, 0])).toEqual([1440, 60, 0]);
  });
});

describe('calendar words', () => {
  it('says when and how often', () => {
    expect(whenLabel(ev(), { date: '2026-11-15', endDate: '2026-11-15' })).toBe('Sun 15 Nov 2026, 10:00 to 12:00');
    expect(whenLabel(ev({ allDay: true }), { date: '2026-11-20', endDate: '2026-11-22' })).toBe('Fri 20 Nov to Sun 22 Nov 2026');
    expect(repeatLabel(ev({ repeat: 'monthlyWeekday' }))).toBe('Every month on the 3rd Sunday');
    expect(repeatLabel(ev({ repeat: 'monthly', date: '2026-11-22' }))).toBe('Every month on the 22nd');
    expect(repeatLabel(ev({ repeat: 'weekly', repeatUntil: '2026-12-31' }))).toBe('Every week on Sunday, until Thu 31 Dec 2026');
  });
  it('reads service times', () => {
    expect(serviceSlots(['Sunday 10:00', 'Youth service', 'Wednesday 6.30pm'])).toEqual([
      { weekday: 0, time: '10:00', name: 'Sunday 10:00' }, { weekday: 3, time: '18:30', name: 'Wednesday 6.30pm' },
    ]);
  });
});
