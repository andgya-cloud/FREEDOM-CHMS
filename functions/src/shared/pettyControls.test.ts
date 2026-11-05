import { describe, expect, it } from 'vitest';
import { cleanMpesaCode, MPESA_CODE, nextStepFor, overDirectorLimit, possibleDuplicates, waitingForDirector } from './pettyCash';

const sig = (name: string, director = false) => ({ name, role: 'Stakeholder', ...(director ? { director: true } : {}) });

describe('petty cash controls (Andy, 2026-10-24)', () => {
  it('keeps the second signature on a request over KES 10,000 for the Director', () => {
    const big = { status: 'submitted' as const, totalCents: 1_500_000, signatures: { a: sig('Elias') }, requesterId: 'r', checked: null };
    expect(overDirectorLimit(big)).toBe(true);
    expect(waitingForDirector(big)).toBe(true);
    expect(nextStepFor(big, { uid: 'b', canCheck: false, canApprove: false, canSign: true })).toBeNull();
    expect(nextStepFor(big, { uid: 'andy', canCheck: false, canApprove: false, canSign: true, isDirector: true })).toBe('sign');
    expect(waitingForDirector({ ...big, signatures: { a: sig('Andrew Guya', true) } })).toBe(false);
    expect(waitingForDirector({ ...big, totalCents: 1_000_000 })).toBe(false);
    expect(waitingForDirector({ ...big, byDirector: true })).toBe(false);
    expect(waitingForDirector({ ...big, signatures: {} })).toBe(false);
  });
  it('spots the same person asking for the same amount and category within 7 days', () => {
    const day = 86_400_000;
    const others = [
      { id: '1', requesterId: 'eliz', requesterName: 'Elizabeth', totalCents: 500, category: 'Transport', status: 'approved', at: 0 },
      { id: '2', requesterId: 'eliz', requesterName: 'Elizabeth', totalCents: 500, category: 'Transport', status: 'rejected', at: 0 },
      { id: '3', requesterId: 'eliz', requesterName: 'Elizabeth', totalCents: 500, category: 'Transport', status: 'approved', at: -9 * day },
      { id: '4', requesterId: 'dan', requesterName: 'Daniel', totalCents: 500, category: 'Transport', status: 'approved', at: 0 },
    ] as const;
    const found = possibleDuplicates({ requesterId: 'eliz', requesterName: 'Elizabeth', totalCents: 500, category: 'Transport' }, [...others] as never[], 2 * day, (o: { at: number }) => o.at);
    expect(found.map((f: { id: string }) => f.id)).toEqual(['1']);
  });
  it('tidies and checks M-Pesa codes', () => {
    expect(cleanMpesaCode(' sjk4 h2xq-7p ')).toBe('SJK4H2XQ7P');
    expect(MPESA_CODE.test('SJK4H2XQ7P')).toBe(true);
    expect(MPESA_CODE.test('SJK4H2')).toBe(false);
  });
});
