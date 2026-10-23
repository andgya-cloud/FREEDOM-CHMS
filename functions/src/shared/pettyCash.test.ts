import { describe, expect, it } from 'vitest';
import { checkPin, categoryBudgets, categoryLabel, lineAmountCents, pettyLedger, fundStatusAfter, fundSummary, itemsTotalCents, nextStepFor, parseAmountCents, waitingForAccountant, pettyCashNumber } from './pettyCash';

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
    expect(parseAmountCents('KES 500,000')).toBe(50000000);
    expect(parseAmountCents('Ksh 500 000/=')).toBe(50000000);
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

  it('lets any two approve, nobody twice and never the requester', () => {
    const sig = (role: string) => ({ name: role, role });
    const r = { requesterId: 'doreen', checked: null, status: 'submitted' as const, signatures: { elias: sig('Chairman') } };
    const ronald = { uid: 'ronald', canCheck: false, canApprove: true, canSign: true };
    expect(waitingForAccountant(r)).toBe(false);
    expect(nextStepFor(r, ronald)).toBe('sign');
    expect(nextStepFor(r, { ...ronald, uid: 'elias' })).toBeNull();
    expect(nextStepFor(r, { ...ronald, uid: 'doreen' })).toBeNull();
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

  it('completes a top-up at the second signature', () => {
    expect(fundStatusAfter(1)).toBe('collecting');
    expect(fundStatusAfter(2)).toBe('done');
  });

  it('works out a line from quantity and unit price', () => {
    expect(lineAmountCents(3, 25050)).toBe(75150);
    expect(lineAmountCents(1.5, 1000)).toBe(1500);
    expect(categoryLabel({ category: 'Other', categoryNote: 'Generator fuel' })).toBe('Other: Generator fuel');
    expect(categoryLabel({ category: 'Staff Payments', categoryNote: null })).toBe('Staff Payments');
  });

  it('keeps a running balance that a reset starts again from zero', () => {
    const t = (ms: number) => ({ ms });
    const millis = (x: unknown) => (x && typeof x === 'object' && 'ms' in x ? (x as { ms: number }).ms : null);
    const req = (id: string, cents: number, ms: number, status: 'approved' | 'submitted' = 'approved') => ({
      id, number: id, status, totalCents: cents, requesterName: 'Doreen', category: 'Other' as const, categoryNote: null,
      approved: status === 'approved' ? { uid: 'e', name: 'E', role: 'Board member', at: t(ms) } : null,
    });
    const lines = pettyLedger(
      [{ id: 'f1', kind: 'topup', amountCents: 10000, status: 'done', doneAt: t(1) }, { id: 'f2', kind: 'reset', amountCents: 0, status: 'done', doneAt: t(5) },
        { id: 'f3', kind: 'topup', amountCents: 5000, status: 'done', doneAt: t(6) }, { id: 'f4', kind: 'topup', amountCents: 999, status: 'collecting', doneAt: null }],
      [req('A', 3000, 2), req('B', 1000, 7), req('C', 500, 8, 'submitted')], millis,
    );
    expect(lines.map((l) => [l.id, l.balanceCents])).toEqual([['f1', 10000], ['A', 7000], ['f2', 0], ['f3', 5000], ['B', 4000]]);
    const cats = categoryBudgets(['Other', 'Staff Payments'], { Other: 6000 }, [req('B', 1000, 7), req('C', 500, 8, 'submitted'), req('A', 3000, 2)], 5, millis);
    expect(cats).toEqual([
      { category: 'Other', allocatedCents: 6000, spentCents: 1000, pendingCents: 500 },
      { category: 'Staff Payments', allocatedCents: 0, spentCents: 0, pendingCents: 0 },
    ]);
  });

  it('lets any stakeholder sign once, never their own request', () => {
    const r = { requesterId: 'doreen', checked: null, status: 'submitted' as const, signatures: { eliz: { name: 'E', role: 'Accountant' } } };
    expect(nextStepFor(r, { uid: 'elias', canCheck: false, canApprove: false, canSign: true })).toBe('sign');
    expect(nextStepFor(r, { uid: 'eliz', canCheck: true, canApprove: false, canSign: true })).toBeNull();
    expect(nextStepFor({ ...r, requesterId: 'elias' }, { uid: 'elias', canCheck: false, canApprove: false, canSign: true })).toBeNull();
    expect(nextStepFor(r, { uid: 'ronald', canCheck: false, canApprove: false, canSign: false })).toBeNull();
    expect(nextStepFor({ ...r, status: 'approved' }, { uid: 'elias', canCheck: false, canApprove: false, canSign: true })).toBeNull();
  });

  it('accepts a signing PIN of 4 to 6 digits, not all the same', () => {
    expect(checkPin('2580')).toBe('2580');
    expect(checkPin(' 135790 ')).toBe('135790');
    expect(checkPin('123')).toBeNull();
    expect(checkPin('1234567')).toBeNull();
    expect(checkPin('0000')).toBeNull();
    expect(checkPin('12a4')).toBeNull();
    expect(checkPin(1234)).toBeNull();
  });
});
