/**
 * The petty cash "Money box" (Andy, 2026-11-08, answers 1B 2B 3A 4A 5A 6A): one running pot with no
 * monthly restart. The budget is the size the pot should be; Andy, Doreen or Elias add money when more is
 * needed, and a "life" line shows money left and when it runs out at the present rate of spending.
 * Shared by the app and the functions, in all three organizations.
 */
import type { LedgerLine } from './pettyCash.js';

/** Low warning below a fixed KES 20,000 (Andy, 2026-11-09, 5A): petty cash no longer has its own budget. */
export const LOW_LINE_CENTS = 2_000_000;
export function lowCashLine(_budgetCents?: number | null): number {
  return LOW_LINE_CENTS;
}

/** Kenya keeps East Africa Time (UTC+3) all year. */
const EAT_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
/** The Nairobi date of a moment, as YYYY-MM-DD. */
export const nairobiDay = (ms: number) => new Date(ms + EAT_MS).toISOString().slice(0, 10);
/** The moment a Nairobi day ends. */
const endOfDay = (day: string) => Date.parse(`${day}T00:00:00Z`) - EAT_MS + DAY_MS;

export type LifeTone = 'good' | 'watch' | 'low';
export interface MoneyLife {
  /** One label per day: the past days, today, then the days ahead. */
  days: string[];
  /** Money left at the end of each past day and today; null for the days ahead. */
  left: (number | null)[];
  /** The dashed line: from today's money down at the present rate; null before today. */
  ahead: (number | null)[];
  leftCents: number;
  /** Average spent a day over the days looked at. */
  perDayCents: number;
  /** Whole days the money lasts at that rate, or null when nothing is being spent. */
  daysLeft: number | null;
  /** The Nairobi date it runs out, or null. */
  runOutDay: string | null;
  tone: LifeTone;
}

/**
 * Money left day by day over the last `pastDays` (fewer when the books are younger), the average spent a
 * day in that time, and a straight line ahead to the day it runs out (at most `aheadDays` shown).
 */
export function moneyLife(ledger: readonly LedgerLine[], now: number, budgetCents = 0, pastDays = 30, aheadDays = 30): MoneyLife {
  const today = nairobiDay(now);
  const first = ledger.length ? nairobiDay(ledger[0]!.at) : today;
  const startMs = Math.max(Date.parse(`${first}T00:00:00Z`), Date.parse(`${today}T00:00:00Z`) - (pastDays - 1) * DAY_MS);
  const past: string[] = [];
  for (let t = startMs; ; t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    past.push(d);
    if (d >= today) break;
  }
  let i = 0;
  let balance = 0;
  const left = past.map((d) => {
    const end = endOfDay(d);
    while (i < ledger.length && ledger[i]!.at < end) balance = ledger[i++]!.balanceCents;
    return balance;
  });
  const leftCents = left[left.length - 1] ?? 0;
  const from = endOfDay(past[0]!) - DAY_MS;
  const spent = ledger.filter((l) => l.at >= from && l.at <= now).reduce((n, l) => n + l.debitCents, 0);
  // A few days of books would give a wild rate, so at least a week is counted.
  const perDayCents = Math.round(spent / Math.max(7, past.length));
  const daysLeft = perDayCents > 0 ? Math.max(0, Math.floor(leftCents / perDayCents)) : null;
  const shown = daysLeft == null ? 0 : Math.min(aheadDays, Math.max(1, Math.ceil(leftCents / perDayCents)));
  const futureDays = Array.from({ length: shown }, (_, k) => new Date(Date.parse(`${today}T00:00:00Z`) + (k + 1) * DAY_MS).toISOString().slice(0, 10));
  const ahead: (number | null)[] = [...past.map((_, k) => (k === past.length - 1 && shown ? leftCents : null)),
    ...futureDays.map((_, k) => Math.max(0, leftCents - perDayCents * (k + 1)))];
  const runOutDay = daysLeft == null || leftCents <= 0 ? (leftCents <= 0 && ledger.length ? today : null)
    : new Date(Date.parse(`${today}T00:00:00Z`) + daysLeft * DAY_MS).toISOString().slice(0, 10);
  const lowLine = lowCashLine(budgetCents);
  // Amber when it runs out within two weeks at this rate.
  const tone: LifeTone = leftCents < lowLine ? 'low' : daysLeft != null && daysLeft <= 14 ? 'watch' : 'good';
  return { days: [...past, ...futureDays], left: [...left, ...futureDays.map(() => null)], ahead, leftCents, perDayCents, daysLeft, runOutDay, tone };
}
