/**
 * The events calendar (Andy, 2026-11-14: 1A 2A 3A 4A 5A 6A 7A 8A 9B 10A). Each place (Church, ADIA, Hope) keeps
 * its own events in organizations/{orgId}/calendar; Andy sees them all together. Events can repeat, and each one
 * carries its reminders (minutes before the start), which the server sends as a phone or computer pop-up and an
 * email. Shared by the app (to draw the calendar) and the server (to send the reminders), so both agree on dates.
 */
import { zonedMidnight, zonedParts } from './datetime.js';

export const EVENT_TYPES = ['service', 'meeting', 'outreach', 'training', 'exam', 'deadline', 'celebration', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_INFO: Record<EventType, { label: string; colour: string; icon: string }> = {
  service: { label: 'Service', colour: '#2e8b57', icon: '⛪' },
  meeting: { label: 'Meeting', colour: '#2f6fd0', icon: '👥' },
  outreach: { label: 'Outreach', colour: '#e07b24', icon: '🤝' },
  training: { label: 'Training', colour: '#7b52c9', icon: '🎓' },
  exam: { label: 'Exam', colour: '#c8433a', icon: '📝' },
  deadline: { label: 'Deadline', colour: '#a87b05', icon: '⏳' },
  celebration: { label: 'Celebration', colour: '#d1478f', icon: '🎉' },
  other: { label: 'Other', colour: '#64748b', icon: '📌' },
};

export const REPEATS = ['none', 'daily', 'weekly', 'fortnightly', 'monthly', 'monthlyWeekday', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

/** Reminder choices, in minutes before the start. An all-day event "starts" at 08:00. */
export const REMINDER_CHOICES = [0, 10, 30, 60, 120, 1440, 2880, 10080] as const;
export const DEFAULT_REMINDERS = [1440, 60];
export const DEFAULT_ALL_DAY_REMINDERS = [1440, 0];
export const ALL_DAY_START = '08:00';
export const MAX_REMINDERS = 5;
export const FOREVER = '9999-12-31';

export type Rsvp = 'yes' | 'no';

export interface CalendarEvent {
  id: string;
  orgId: string;
  title: string;
  type: EventType;
  allDay: boolean;
  /** First (or only) day, YYYY-MM-DD in the organization's time zone. */
  date: string;
  /** Last day of the first occurrence (the same as date for a one-day event). */
  endDate: string;
  /** HH:mm, or null for an all-day event. */
  start: string | null;
  end: string | null;
  place: string;
  inCharge: string;
  notes: string;
  repeat: Repeat;
  repeatUntil: string | null;
  /** Days taken out of a repeating event ("skip this one", or changed into its own event). */
  skipDates: string[];
  /** An occurrence changed on its own: the series it came from, and its day in that series. */
  seriesId: string | null;
  seriesDate: string | null;
  reminders: number[];
  /** Remind everyone at this place, not only the person who added it and the people invited. */
  remindAll: boolean;
  invited: string[];
  invitedNames: Record<string, string>;
  responses: Record<string, Rsvp>;
  /** The last day any occurrence ends, so the server only reads events still to come. */
  endsOn: string;
  createdBy: string;
  createdByName: string;
  deletedAt?: unknown;
}

export interface Occurrence { date: string; endDate: string }

// ---- Plain date arithmetic on YYYY-MM-DD ----------------------------------------------------

const DAY_MS = 86_400_000;
const toUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => fromUtc(toUtc(key) + n * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
/** 0 = Sunday. */
export const weekdayOf = (key: string) => new Date(toUtc(key)).getUTCDay();
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Which week of the month a day falls in (1 to 4), or 5 for the last one. */
export function nthWeekday(key: string): number {
  const d = Number(key.slice(8, 10));
  const n = Math.ceil(d / 7);
  return n >= 5 ? 5 : n;
}
function nthWeekdayIn(y: number, m: number, weekday: number, n: number): string | null {
  if (n === 5) {
    const last = daysInMonth(y, m);
    const lastKey = dateKey(y, m, last);
    return addDays(lastKey, -((weekdayOf(lastKey) - weekday + 7) % 7));
  }
  const firstKey = dateKey(y, m, 1);
  const day = 1 + ((weekday - weekdayOf(firstKey) + 7) % 7) + (n - 1) * 7;
  return day <= daysInMonth(y, m) ? dateKey(y, m, day) : null;
}

// ---- Occurrences -----------------------------------------------------------------------------

/** How many extra days an event runs after its first day. */
export const spanOf = (e: Pick<CalendarEvent, 'date' | 'endDate'>) => Math.max(0, daysBetween(e.date, e.endDate || e.date));

/** The last day any occurrence ends. */
export function endsOnFor(e: Pick<CalendarEvent, 'date' | 'endDate' | 'repeat' | 'repeatUntil'>): string {
  if (e.repeat === 'none') return e.endDate || e.date;
  return e.repeatUntil ? addDays(e.repeatUntil, spanOf(e)) : FOREVER;
}

/** Every occurrence that touches the days from..to (inclusive). */
export function occurrences(e: Pick<CalendarEvent, 'date' | 'endDate' | 'repeat' | 'repeatUntil' | 'skipDates'>, from: string, to: string): Occurrence[] {
  const span = spanOf(e);
  const out: Occurrence[] = [];
  const skip = new Set(e.skipDates ?? []);
  const until = e.repeatUntil && e.repeatUntil < to ? e.repeatUntil : to;
  const add = (d: string) => {
    const end = addDays(d, span);
    if (end >= from && d <= to && !skip.has(d)) out.push({ date: d, endDate: end });
  };
  const earliest = addDays(from, -span);
  if (e.repeat === 'none') { add(e.date); return out; }
  if (e.date > until) return out;

  if (e.repeat === 'daily' || e.repeat === 'weekly' || e.repeat === 'fortnightly') {
    const step = e.repeat === 'daily' ? 1 : e.repeat === 'weekly' ? 7 : 14;
    let d = e.date;
    if (d < earliest) d = addDays(d, Math.floor(daysBetween(d, earliest) / step) * step);
    for (let i = 0; d <= until && i < 4000; i++, d = addDays(d, step)) if (d >= e.date) add(d);
    return out;
  }
  const y0 = Number(e.date.slice(0, 4));
  const m0 = Number(e.date.slice(5, 7));
  const d0 = Number(e.date.slice(8, 10));
  if (e.repeat === 'yearly') {
    const lastYear = Number(until.slice(0, 4));
    for (let y = Math.max(y0, Number(earliest.slice(0, 4)) - 1); y <= lastYear; y++) {
      if (d0 > daysInMonth(y, m0)) continue; // 29 February, only in leap years
      const d = dateKey(y, m0, d0);
      if (d >= e.date && d <= until) add(d);
    }
    return out;
  }
  // Monthly, on the same date or on the same weekday of the month ("2nd Sunday", "last Friday").
  const weekday = weekdayOf(e.date);
  const n = nthWeekday(e.date);
  let y = Number(earliest.slice(0, 4));
  let m = Number(earliest.slice(5, 7)) - 1;
  if (m < 1) { m = 12; y -= 1; }
  if (y < y0 || (y === y0 && m < m0)) { y = y0; m = m0; }
  for (let i = 0; i < 1200; i++) {
    const first = dateKey(y, m, 1);
    if (first > until) break;
    const d = e.repeat === 'monthly' ? (d0 <= daysInMonth(y, m) ? dateKey(y, m, d0) : null) : nthWeekdayIn(y, m, weekday, n);
    if (d && d >= e.date && d <= until) add(d);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---- Times and reminders ---------------------------------------------------------------------

/** The moment an occurrence starts (08:00 for an all-day event). */
export function startInstant(e: Pick<CalendarEvent, 'allDay' | 'start'>, day: string, timeZone: string): Date {
  const t = e.allDay || !e.start ? ALL_DAY_START : e.start;
  const midnight = zonedMidnight(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), timeZone);
  return new Date(midnight.getTime() + minutesOf(t) * 60_000);
}

export interface DueReminder { date: string; offset: number; at: Date }

/** Reminders whose time fell in (now - windowMs, now]. */
export function dueReminders(e: CalendarEvent, now: Date, windowMs: number, timeZone: string): DueReminder[] {
  const offsets = (e.reminders ?? []).filter((o) => Number.isFinite(o) && o >= 0);
  if (!offsets.length) return [];
  const maxOffset = Math.max(...offsets);
  const localNow = zonedParts(now, timeZone);
  const today = dateKey(localNow.year, localNow.month, localNow.day);
  const from = addDays(today, -2);
  const to = addDays(today, Math.ceil(maxOffset / 1440) + 2);
  const out: DueReminder[] = [];
  for (const occ of occurrences(e, from, to)) {
    const start = startInstant(e, occ.date, timeZone).getTime();
    for (const offset of offsets) {
      const at = start - offset * 60_000;
      if (at <= now.getTime() && at > now.getTime() - windowMs) out.push({ date: occ.date, offset, at: new Date(at) });
    }
  }
  return out;
}

export function reminderLabel(minutes: number, allDay: boolean): string {
  if (allDay) {
    if (minutes === 0) return 'On the day at 8:00';
    if (minutes === 1440) return 'The day before at 8:00';
    if (minutes === 2880) return '2 days before at 8:00';
    if (minutes === 10080) return 'A week before at 8:00';
  }
  if (minutes === 0) return 'When it starts';
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes === 60) return '1 hour before';
  if (minutes < 1440) return `${minutes / 60} hours before`;
  if (minutes === 1440) return '1 day before';
  if (minutes === 10080) return '1 week before';
  return `${minutes / 1440} days before`;
}

// ---- Words -----------------------------------------------------------------------------------

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', 'last'];

/** "Sun 16 Nov 2026". */
export function dayLabel(key: string, withYear = true): string {
  const d = Number(key.slice(8, 10));
  return `${WEEKDAY_NAMES[weekdayOf(key)]!.slice(0, 3)} ${d} ${MONTHS[Number(key.slice(5, 7)) - 1]}${withYear ? ` ${key.slice(0, 4)}` : ''}`;
}

export function repeatLabel(e: Pick<CalendarEvent, 'date' | 'repeat' | 'repeatUntil'>, repeat: Repeat = e.repeat): string {
  const wd = WEEKDAY_NAMES[weekdayOf(e.date)]!;
  const d = Number(e.date.slice(8, 10));
  const base = {
    none: 'Does not repeat',
    daily: 'Every day',
    weekly: `Every week on ${wd}`,
    fortnightly: `Every 2 weeks on ${wd}`,
    monthly: `Every month on the ${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`,
    monthlyWeekday: `Every month on the ${ORDINALS[nthWeekday(e.date)]} ${wd}`,
    yearly: `Every year on ${d} ${MONTHS[Number(e.date.slice(5, 7)) - 1]}`,
  }[repeat];
  return repeat !== 'none' && e.repeatUntil ? `${base}, until ${dayLabel(e.repeatUntil)}` : base;
}

/** "Sun 16 Nov 2026, 10:00 to 12:00" or "Fri 20 to Sun 22 Nov 2026". */
export function whenLabel(e: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, occ: Occurrence): string {
  const multi = occ.endDate !== occ.date;
  if (e.allDay) return multi ? `${dayLabel(occ.date, false)} to ${dayLabel(occ.endDate)}` : `${dayLabel(occ.date)}, all day`;
  const times = e.start ? `${e.start}${e.end ? ` to ${e.end}` : ''}` : '';
  if (multi) return `${dayLabel(occ.date, false)} ${e.start ?? ''} to ${dayLabel(occ.endDate)} ${e.end ?? ''}`.replace(/\s+/g, ' ').trim();
  return `${dayLabel(occ.date)}${times ? `, ${times}` : ''}`;
}

/** The reminder's words: "Tomorrow at 10:00", "In 1 hour (10:00)", "Starting now". */
export function reminderLead(e: Pick<CalendarEvent, 'allDay' | 'start'>, occDate: string, now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  const today = dateKey(p.year, p.month, p.day);
  const days = daysBetween(today, occDate);
  const at = e.allDay || !e.start ? '' : ` at ${e.start}`;
  if (days === 0) {
    if (e.allDay || !e.start) return 'Today';
    const mins = Math.round((startInstant(e, occDate, timeZone).getTime() - now.getTime()) / 60_000);
    if (mins <= 2) return `Starting now (${e.start})`;
    if (mins < 60) return `In ${mins} minutes (${e.start})`;
    const h = Math.round(mins / 60);
    return `In ${h} hour${h === 1 ? '' : 's'} (${e.start})`;
  }
  if (days === 1) return `Tomorrow${at}`;
  return `${dayLabel(occDate, false)}${at} (in ${days} days)`;
}

/** The people a reminder goes to: who added it, and everyone invited who has not said No. */
export function reminderUids(e: Pick<CalendarEvent, 'createdBy' | 'invited' | 'responses'>): string[] {
  const set = new Set<string>();
  if (e.createdBy) set.add(e.createdBy);
  for (const uid of e.invited ?? []) if (e.responses?.[uid] !== 'no') set.add(uid);
  return [...set];
}

/** Cleans reminder minutes: known choices only, no repeats, at most five, largest first. */
export function cleanReminders(raw: readonly number[]): number[] {
  const ok = new Set<number>(REMINDER_CHOICES);
  return [...new Set(raw.filter((m) => ok.has(m)))].sort((a, b) => b - a).slice(0, MAX_REMINDERS);
}

/** The days Sunday services fall on, from an organization's service times such as "Sunday 10:00". */
export function serviceSlots(serviceTimes: readonly string[] | null | undefined): { weekday: number; time: string; name: string }[] {
  const out: { weekday: number; time: string; name: string }[] = [];
  for (const s of serviceTimes ?? []) {
    const m = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?/i.exec(s.trim());
    if (!m) continue;
    const weekday = WEEKDAY_NAMES.findIndex((w) => w.toLowerCase() === m[1]!.toLowerCase());
    let h = Number(m[2]);
    const half = m[4]?.toLowerCase();
    if (half === 'pm' && h < 12) h += 12;
    if (half === 'am' && h === 12) h = 0;
    out.push({ weekday, time: `${String(h).padStart(2, '0')}:${m[3]}`, name: s.trim() });
  }
  return out;
}
