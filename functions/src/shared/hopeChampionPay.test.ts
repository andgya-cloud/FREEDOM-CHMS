import { describe, expect, it } from 'vitest';
import { arrivalMark, monthPay, newChampionCodes, normalizeChampionCode, payMonthReady, planPayUpload } from './hopeChampionPay';
import type { Champion, ChampionDay } from './hopeRegister';

const ch = (id: string, name: string, weeklyPay: number, code?: string): Champion => ({ id, name, phone: '', email: '', duty: '', status: 'active', joinedOn: null, weeklyPay, code });

describe('Champion pay', () => {
  it('pays each week they came, plus extras', () => {
    const days: ChampionDay[] = [
      { date: '2026-11-07', marks: { a: { s: 'present' as const }, b: { s: 'absent' as const } } },
      { date: '2026-11-14', marks: { a: { s: 'late' as const }, b: { s: 'present' as const } } },
      { date: '2026-11-11', marks: { a: { s: 'present' as const } } }, // a weekday in the same week: still one week
      { date: '2026-10-31', marks: { a: { s: 'present' as const } } }, // last month
    ];
    const r = monthPay([ch('a', 'Ann', 500), ch('b', 'Ben', 700)], days, [{ id: 'x', championId: 'b', month: '2026-11', amount: 300, reason: 'Trip' }], '2026-11');
    expect(r.lines.map((l) => [l.name, l.weeks, l.late, l.basic, l.extras, l.total])).toEqual([['Ann', 2, 1, 1000, 0, 1000], ['Ben', 1, 0, 700, 300, 1000]]);
    expect(r.total).toBe(2000);
  });
  it('is late after 8:30', () => {
    expect(arrivalMark('08:30')).toBe('present');
    expect(arrivalMark('08:31')).toBe('late');
    expect(arrivalMark(null)).toBe('present');
  });
  it('is ready on the 28th and the 1st', () => {
    expect(payMonthReady('2026-11-28')).toEqual({ month: '2026-11', final: false });
    expect(payMonthReady('2026-12-01')).toEqual({ month: '2026-11', final: true });
    expect(payMonthReady('2027-01-01')).toEqual({ month: '2026-12', final: true });
    expect(payMonthReady('2026-11-15')).toBeNull();
  });
  it('gives card codes', () => {
    expect(newChampionCodes([ch('a', 'Zed', 0, 'CC-0002'), ch('b', 'Bob', 0), ch('c', 'Amy', 0)])).toEqual({ c: 'CC-0003', b: 'CC-0004' });
    expect(normalizeChampionCode('cc 7')).toBe('CC-0007');
  });
  it('reads the weekly amounts sheet', () => {
    const r = planPayUpload([['Name', 'Weekly amount'], ['Ann Wanjiru', 'KES 1,500'], ['Nobody', 200], ['Ben', '']], [ch('a', 'Ann Wanjiru', 0), ch('b', 'Ben', 0)]);
    expect(r).toEqual({ found: [{ id: 'a', name: 'Ann Wanjiru', amount: 1500, monthly: false }], notFound: ['Nobody', 'Ben (no amount)'] });
  });
  it('reads "9000 - fixed" as a fixed monthly amount, paid whatever the weeks', () => {
    const r = planPayUpload([['NAMES', 'Appreciation per week'], ['Dorothy Mohat', '9000 - fixed']], [ch('d', 'Dorothy Mohat', 0)]);
    expect(r!.found).toEqual([{ id: 'd', name: 'Dorothy Mohat', amount: 9000, monthly: true }]);
    expect(monthPay([{ ...ch('d', 'Dorothy Mohat', 0), monthlyPay: 9000 }], [], [], '2026-11').total).toBe(9000);
  });
});
