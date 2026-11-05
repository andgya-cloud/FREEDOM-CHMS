import { describe, expect, it } from 'vitest';
import { addMonths, compact, monthsEnding, niceMax, pctChange, shares, toCsv } from './analytics';

describe('analytics helpers', () => {
  it('moves across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(monthsEnding('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('compares with care for zero', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(null, 10)).toBeNull();
  });
  it('rounds axis tops and labels', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(73)).toBe(100);
    expect(niceMax(180_000)).toBe(200_000);
    expect(niceMax(2100)).toBe(2500);
    expect(compact(1_250_000)).toBe('1.3M');
    expect(compact(4500)).toBe('4.5k');
  });
  it('gives shares that add to 100', () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(shares([3, 1]).reduce((a, b) => a + b)).toBe(100);
  });
});

describe('toCsv', () => {
  it('quotes awkward cells and leaves blanks for missing values', () => {
    expect(toCsv(['Fund', 'Amount'], [['Tithes, main', 10], ['Say "hi"', null]])).toBe('Fund,Amount\r\n"Tithes, main",10\r\n"Say ""hi""",');
  });
});
