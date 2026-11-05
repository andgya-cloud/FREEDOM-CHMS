import { describe, expect, it } from 'vitest';
import { canKeepFees, canReadNotes, feeFromLine, mealMonth, mealWeeks, mondayOf, recentTerms, termBalance, termLabel, termOf } from './hopeRecords';

const org = 'hope';
const p = (x: Record<string, unknown>) => ({ active: true, orgIds: [org], permissions: [], roleId: 'staff', ...x }) as never;

describe('hope records', () => {
  it('works out school terms', () => {
    expect(termOf('2026-02-10')).toBe('2026-T1');
    expect(termOf('2026-06-01')).toBe('2026-T2');
    expect(termOf('2026-11-05')).toBe('2026-T3');
    expect(termLabel('2026-T3')).toBe('Term 3 2026');
    expect(recentTerms('2026-11-05')).toEqual(['2027-T1', '2026-T3', '2026-T2', '2026-T1']);
  });
  it('adds up the balance for a term', () => {
    const pays = [{ term: '2026-T3', amount: 1300 }, { term: '2026-T3', amount: 500 }, { term: '2026-T2', amount: 2000 }];
    expect(termBalance(pays, '2026-T3', 2000)).toEqual({ paid: 1800, fee: 2000, left: 200, over: 0 });
    expect(termBalance(pays, '2026-T3', 0).left).toBe(0);
    expect(feeFromLine('KES 1,300 to teacher + KES 700 KCB')).toBe(2000);
    expect(feeFromLine('')).toBe(0);
  });
  it('counts meals by week and month', () => {
    expect(mondayOf('2026-11-05')).toBe('2026-11-02');
    const days = [{ date: '2026-11-01', breakfast: 10, lunch: 12, fruit: 9 }, { date: '2026-11-05', breakfast: 20, lunch: 21, fruit: 22 }];
    const w = mealWeeks(days, '2026-11-05', 2);
    expect(w.map((x) => x.start)).toEqual(['2026-10-26', '2026-11-02']);
    expect(w[1]).toMatchObject({ breakfast: 20, lunch: 21, fruit: 22 });
    expect(mealMonth(days, '2026-11-05')).toMatchObject({ total: 94, days: 2 });
  });
  it('lets only the right people read notes and fees', () => {
    expect(canReadNotes(p({ roleId: 'head' }), org)).toBe(true);
    expect(canReadNotes(p({}), org)).toBe(false);
    expect(canKeepFees(p({ displayName: "Daniel Ojwang'" }), org)).toBe(true);
    expect(canKeepFees(p({ displayName: 'Someone Else' }), org)).toBe(false);
  });
});
