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
  it('warns below a fixed KES 20,000', () => {
    expect(lowCashLine(5_000_000)).toBe(2_000_000);
    expect(lowCashLine(0)).toBe(2_000_000);
  });

  it('reads days in Nairobi time', () => {
    expect(nairobiDay(Date.parse('2026-11-07T22:30:00Z'))).toBe('2026-11-08');
  });

  it('shows money left by day and when it runs out', () => {
    const ledger = [line(13, 30_000_000, 0, 30_000_000), line(10, 0, 7_000_000, 23_000_000), line(3, 0, 7_000_000, 16_000_000)];
    const life = moneyLife(ledger, now, 5_000_000);
    expect(life.days[0]).toBe('2026-10-26');
    expect(life.left[0]).toBe(30_000_000);
    expect(life.leftCents).toBe(16_000_000);
    // 140 000 over 14 days = 10 000 a day, so 16 days left.
    expect(life.perDayCents).toBe(1_000_000);
    expect(life.daysLeft).toBe(16);
    expect(life.runOutDay).toBe('2026-11-24');
    expect(life.ahead.filter((v) => v != null).at(-1)).toBe(0);
    expect(life.tone).toBe('good');
    expect(moneyLife(ledger.slice(0, 2).concat(line(3, 0, 14_000_000, 9_000_000)), now).tone).not.toBe('good');
  });

  it('gives no run-out date when nothing is spent', () => {
    const life = moneyLife([line(2, 10_000_000, 0, 10_000_000)], now);
    expect(life.daysLeft).toBeNull();
    expect(life.ahead.every((v) => v == null)).toBe(true);
    expect(life.tone).toBe('good');
  });

  it('turns red below KES 20,000', () => {
    expect(moneyLife([line(1, 500_000, 0, 500_000)], now, 5_000_000).tone).toBe('low');
  });
});
