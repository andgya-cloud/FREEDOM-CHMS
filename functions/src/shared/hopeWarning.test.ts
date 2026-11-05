import { describe, expect, it } from 'vitest';
import { childWarning } from './hopeWarning';

const consent = { given: true, date: '2026-01-01' };
const kid = { id: 'k', status: 'active', enrolledOn: '2026-01-01', schoolStatus: 'in_school', programmes: [], photoConsent: consent, guardianConsent: consent, sponsorName: 'Josh' } as never;
const sat = (date: string, s: string) => ({ id: date, orgId: 'o', date, marks: { k: { s } } }) as never;
const dates = ['2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'];

describe('childWarning (v182)', () => {
  it('is green for a child who comes', () => {
    expect(childWarning(kid, dates.map((d) => sat(d, 'present')))).toEqual({ level: 'green', reasons: [] });
  });
  it('is red after 3 missed Saturdays with no call', () => {
    const w = childWarning(kid, dates.map((d, i) => sat(d, i < 5 ? 'present' : 'absent')));
    expect(w.level).toBe('red');
    expect(w.reasons[0]).toMatch(/not called/);
  });
  it('is amber when the parent was called, or with fees owing', () => {
    expect(childWarning({ ...(kid as object), calledOn: '2026-11-01' } as never, dates.map((d, i) => sat(d, i < 5 ? 'present' : 'absent'))).level).toBe('amber');
    expect(childWarning(kid, dates.map((d) => sat(d, 'present')), { owing: true }).reasons).toEqual(['School fees still to pay this term']);
  });
});
