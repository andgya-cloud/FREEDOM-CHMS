import { describe, expect, it } from 'vitest';
import { fundStatusAfter, fundSummary, itemsTotalCents, nextStepFor, parseAmountCents, pettyCashNumber } from './pettyCash';

describe('petty cash', () => {
  it('numbers requisitions like the old system', () => {
    expect(pettyCashNumber('ADIA', 15)).toBe('ADIA-00015');
    expect(pettyCashNumber('', 1)).toBe('PC-00001');
  });

  it('adds up the items', () => {
    expect(itemsTotalCents([{ amountCents: 1500000 }, { amountCents: 2000000 }])).toBe(3500000);
  });

  it('reads typed shillings', () => {
    expect(parseAmountCents('1,250.50')).toBe(125050);
    expect(parseAmountCents('20000')).toBe(2000000);
    expect(parseAmountCents('12.345')).toBeNull();
    expect(parseAmountCents('-5')).toBeNull();
    expect(parseAmountCents('')).toBeNull();
  });

  it('lets the accountant check, then someone else give final approval, never on their own request', () => {
    const base = { requesterId: 'doreen', checked: null as null | { uid: string; name: string; role: string } };
    const eliz = { uid: 'eliz', canCheck: true, canApprove: false };
    const elias = { uid: 'elias', canCheck: false, canApprove: true };
    expect(nextStepFor({ ...base, status: 'submitted' }, eliz)).toBe('check');
    expect(nextStepFor({ ...base, status: 'submitted' }, elias)).toBeNull();
    expect(nextStepFor({ ...base, requesterId: 'eliz', status: 'submitted' }, eliz)).toBeNull();
    const checked = { ...base, status: 'checked' as const, checked: { uid: 'eliz', name: 'E', role: 'Accountant' } };
    expect(nextStepFor(checked, elias)).toBe('approve');
    expect(nextStepFor(checked, { uid: 'eliz', canCheck: true, canApprove: true })).toBeNull();
    expect(nextStepFor({ ...checked, status: 'approved' }, elias)).toBeNull();
  });

  it('counts signed top-ups and approved spending since the last reset', () => {
    const t = (ms: number) => ({ ms });
    const millis = (x: unknown) => (x && typeof x === 'object' && 'ms' in x ? (x as { ms: number }).ms : null);
    const funds = [
      { kind: 'topup' as const, amountCents: 5000000, status: 'done' as const, doneAt: t(100) },
      { kind: 'reset' as const, amountCents: 0, status: 'done' as const, doneAt: t(200) },
      { kind: 'topup' as const, amountCents: 10000000, status: 'done' as const, doneAt: t(300) },
      { kind: 'topup' as const, amountCents: 9900000, status: 'collecting' as const, doneAt: null },
    ];
    const reqs = [
      { status: 'approved' as const, totalCents: 1000000, approved: { uid: 'a', name: 'A', role: 'Board member', at: t(150) } },
      { status: 'approved' as const, totalCents: 2500000, approved: { uid: 'a', name: 'A', role: 'Board member', at: t(350) } },
      { status: 'checked' as const, totalCents: 700000, approved: null },
      { status: 'rejected' as const, totalCents: 900000, approved: null },
    ];
    expect(fundSummary(funds, reqs, millis, 1000)).toEqual({ budgetCents: 10000000, spentCents: 2500000, remainingCents: 7500000, pendingCents: 700000 });
    expect(fundSummary([], [], millis).budgetCents).toBe(0);
  });

  it('completes a top-up at the third signature', () => {
    expect(fundStatusAfter(2)).toBe('collecting');
    expect(fundStatusAfter(3)).toBe('done');
  });
});
