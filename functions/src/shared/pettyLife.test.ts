import { describe, expect, it } from 'vitest';
import { lowCashLine, moneyLife, nairobiDay } from './pettyLife';
import type { LedgerLine } from './pettyCash';

const DAY = 86_400_000;
// 8 Nov 2026, 12:00 in Nairobi.
const now = Date.parse('2026-11-08T09:00:00Z');
const line = (daysAgo: number, credit: number, debit: number, balance: number): LedgerLine => ({
  id: String(daysAgo), at: now - daysAgo * DAY, kind: credit ? 'topup' : 'request', description: '', creditCents: credit, debitCents: debit, balanceCents: balance,
});

describe('money box', () => {
  it('warns at a fifth of the budget, or KES 5,000 with none', () => {
    expect(lowCashLine(5_000_000)).toBe(1_000_000);
    expect(lowCashLine(0)).toBe(500_000);
  });

  it('reads days in Nairobi time', () => {
    expect(nairobiDay(Date.parse('2026-11-07T22:30:00Z'))).toBe('2026-11-08');
  });

  it('shows money left by day and when it runs out', () => {
    const ledger = [line(13, 3_000_000, 0, 3_000_000), line(10, 0, 700_000, 2_300_000), line(3, 0, 700_000, 1_600_000)];
    const life = moneyLife(ledger, now, 5_000_000);
    expect(life.days[0]).toBe('2026-10-26');
    expect(life.left[0]).toBe(3_000_000);
    expect(life.leftCents).toBe(1_600_000);
    // 14 000 over 14 days = 1 000 a day, so 16 days left.
    expect(life.perDayCents).toBe(100_000);
    expect(life.daysLeft).toBe(16);
    expect(life.runOutDay).toBe('2026-11-24');
    expect(life.ahead.filter((v) => v != null).at(-1)).toBe(0);
    expect(life.tone).toBe('watch');
  });

  it('gives no run-out date when nothing is spent', () => {
    const life = moneyLife([line(2, 1_000_000, 0, 1_000_000)], now);
    expect(life.daysLeft).toBeNull();
    expect(life.ahead.every((v) => v == null)).toBe(true);
    expect(life.tone).toBe('good');
  });

  it('turns red below a fifth of the budget', () => {
    expect(moneyLife([line(1, 500_000, 0, 500_000)], now, 5_000_000).tone).toBe('low');
  });
});
