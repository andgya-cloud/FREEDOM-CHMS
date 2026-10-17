/**
 * Dates and weeks in the organization's time zone (Africa/Nairobi by default).
 * Weeks run Monday to Sunday. Dates display as DD/MM/YYYY.
 */
export const DEFAULT_TIME_ZONE = 'Africa/Nairobi';

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1 = Monday ... 7 = Sunday
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone = DEFAULT_TIME_ZONE): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** The instant of local midnight at the start of the given local calendar day. */
export function zonedMidnight(year: number, month: number, day: number, timeZone = DEFAULT_TIME_ZONE): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Offset = local wall time minus UTC at that instant; correct twice for DST-safe zones.
  let result = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(result), timeZone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    result = guess - (wall - result);
  }
  return new Date(result);
}

export interface Period {
  start: Date; // inclusive
  end: Date; // exclusive
}

/** The Monday-to-Sunday week containing `date`. */
export function weekContaining(date: Date, timeZone = DEFAULT_TIME_ZONE): Period {
  const p = zonedParts(date, timeZone);
  const mondayUtc = Date.UTC(p.year, p.month - 1, p.day - (p.weekday - 1));
  const monday = new Date(mondayUtc);
  const start = zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone);
  const next = new Date(mondayUtc + 7 * 86_400_000);
  const end = zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  return { start, end };
}

/** The calendar month containing `date`. */
export function monthContaining(date: Date, timeZone = DEFAULT_TIME_ZONE): Period {
  const p = zonedParts(date, timeZone);
  const start = zonedMidnight(p.year, p.month, 1, timeZone);
  const end = p.month === 12 ? zonedMidnight(p.year + 1, 1, 1, timeZone) : zonedMidnight(p.year, p.month + 1, 1, timeZone);
  return { start, end };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DD/MM/YYYY */
export function formatDate(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** DD/MM/YYYY HH:MM (24-hour) */
export function formatDateTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const p = zonedParts(date, timeZone);
  return `${formatDate(date, timeZone)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses DD/MM/YYYY as local midnight; returns null for anything invalid. */
export function parseDate(text: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedMidnight(year, month, day, timeZone);
}
