import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, monthContaining, parseDate, weekContaining, zonedMidnight } from './datetime';

describe('Nairobi dates', () => {
  it('formats as DD/MM/YYYY in East Africa Time', () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in Nairobi (UTC+3).
    expect(formatDate(new Date('2026-12-31T22:30:00Z'))).toBe('01/01/2027');
    expect(formatDateTime(new Date('2026-10-17T07:05:00Z'))).toBe('17/10/2026 10:05');
  });

  it('finds local midnight', () => {
    expect(zonedMidnight(2026, 10, 19).toISOString()).toBe('2026-10-18T21:00:00.000Z');
  });

  it('runs weeks Monday to Sunday', () => {
    // Saturday 17 Oct 2026
    const w = weekContaining(new Date('2026-10-17T09:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-10-11T21:00:00.000Z'); // Mon 12 Oct 00:00 EAT
    expect(w.end.toISOString()).toBe('2026-10-18T21:00:00.000Z'); // Mon 19 Oct 00:00 EAT
  });

  it('puts Sunday night in the same week, and Monday morning in the next', () => {
    const sundayLate = weekContaining(new Date('2026-10-18T20:59:00Z')); // Sun 23:59 EAT
    const mondayEarly = weekContaining(new Date('2026-10-18T21:01:00Z')); // Mon 00:01 EAT
    expect(sundayLate.start.toISOString()).toBe('2026-10-11T21:00:00.000Z');
    expect(mondayEarly.start.toISOString()).toBe('2026-10-18T21:00:00.000Z');
  });

  it('handles a week that crosses a month and year end', () => {
    const w = weekContaining(new Date('2027-01-01T12:00:00Z')); // Friday
    expect(formatDate(w.start)).toBe('28/12/2026');
  });

  it('finds the calendar month', () => {
    const m = monthContaining(new Date('2026-12-15T12:00:00Z'));
    expect(formatDate(m.start)).toBe('01/12/2026');
    expect(formatDate(m.end)).toBe('01/01/2027');
  });

  it('parses DD/MM/YYYY and rejects impossible dates', () => {
    expect(parseDate('05/11/2026')?.toISOString()).toBe('2026-11-04T21:00:00.000Z');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('2026-11-05')).toBeNull();
  });
});

describe('calendar date keys', () => {
  it('uses the Nairobi date and shows it as DD/MM/YYYY', async () => {
    const { localDateKey, formatDateKey } = await import('./datetime');
    expect(localDateKey(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
    expect(formatDateKey('2026-10-18')).toBe('18/10/2026');
    expect(formatDateKey('bad')).toBe('');
  });
});
