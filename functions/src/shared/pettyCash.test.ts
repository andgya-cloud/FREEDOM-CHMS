import { describe, expect, it } from 'vitest';
import { budgetSummary, itemsTotalCents, nextStepFor, parseAmountCents, pettyCashNumber } from './pettyCash';

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

  it('measures the month against its budget, leaving out rejected requests', () => {
    const reqs = [
      { month: '2026-10', status: 'approved' as const, totalCents: 4000000 },
      { month: '2026-10', status: 'submitted' as const, totalCents: 3000000 },
      { month: '2026-10', status: 'rejected' as const, totalCents: 9000000 },
      { month: '2026-09', status: 'approved' as const, totalCents: 9000000 },
    ];
    expect(budgetSummary(10000000, '2026-10', reqs)).toMatchObject({ approvedCents: 4000000, pendingCents: 3000000, balanceCents: 3000000, state: 'healthy' });
    expect(budgetSummary(10000000, '2026-10', reqs, 2500000).state).toBe('warning');
    expect(budgetSummary(10000000, '2026-10', reqs, 4000000)).toMatchObject({ balanceCents: -1000000, state: 'over' });
    expect(budgetSummary(null, '2026-10', reqs).state).toBe('none');
  });
});
