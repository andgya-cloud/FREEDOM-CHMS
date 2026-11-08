import { describe, expect, it } from 'vitest';
import { changeLabel, pettyReport, previousPeriod } from './pettyReport';

const ms = (d: string) => Date.parse(`${d}T09:00:00Z`);
const t = (d: string) => ({ ms: ms(d) });
const millis = (x: unknown) => (x && typeof x === 'object' && 'ms' in x ? (x as { ms: number }).ms : null);
const fund = (id: string, d: string, c: number) => ({ id, kind: 'topup' as const, amountCents: c, status: 'done' as const, doneAt: t(d), signatures: { a: { name: 'Andrew Guya' } }, note: 'Cash' });
const req = (id: string, d: string, c: number, category = 'Staff Payments', status = 'approved') => ({
  id, number: `FCN-${id}`, status, totalCents: c, approved: status === 'approved' ? { uid: 'x', name: 'x', role: '', at: t(d) } : null,
  requesterName: "Daniel Ojwang'", category, signatures: { a: { name: 'Andrew Guya', role: '' }, b: { name: 'Doreen Mayaka', role: '' } }, createdAt: t(d),
}) as never;

describe('petty cash report', () => {
  const funds = [fund('f1', '2026-09-01', 100_000), fund('f2', '2026-10-01', 50_000)];
  const reqs = [req('1', '2026-09-10', 30_000), req('2', '2026-10-05', 20_000), req('3', '2026-10-20', 5_000, 'Hospitality'), req('4', '2026-10-21', 9_000, 'Hospitality', 'submitted')];
  it('gives opening, in, out and closing for a month', () => {
    const r = pettyReport('2026-10', funds as never, reqs, { '2': 1 }, millis);
    expect([r.openingCents, r.inCents, r.outCents, r.closingCents]).toEqual([70_000, 50_000, 25_000, 95_000]);
    expect(r.categories.map((c) => [c.category, c.cents, c.beforeCents])).toEqual([['Staff Payments', 20_000, 30_000], ['Hospitality', 5_000, 0]]);
    expect(r.vouchers.map((v) => v.number)).toEqual(['FCN-2', 'FCN-3']);
    expect(r.vouchers[0]!.approvedBy).toBe('Andrew Guya & Doreen Mayaka');
    expect(r.missingReceipts).toBe(1);
    expect(r.waiting).toEqual({ count: 1, cents: 9_000 });
  });
  it('lists the months of a year', () => {
    const r = pettyReport('2026', funds as never, reqs, {}, millis);
    expect(r.months.map((m) => [m.period, m.openingCents, m.closingCents])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((m) => [`2026-0${m}`, 0, 0]).concat([['2026-09', 0, 70_000], ['2026-10', 70_000, 95_000]]));
  });
  it('names the period before and the change', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(previousPeriod('2026')).toBe('2025');
    expect(changeLabel(20_000, 30_000)).toBe('-33%');
    expect(changeLabel(5, 0)).toBe('new');
  });
});
