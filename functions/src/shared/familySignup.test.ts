import { describe, expect, it } from 'vitest';
import { cleanSignup, confirmedStatus, startingStatus } from './familySignup';

describe('family sign-up form (Andy, 2026-11-02)', () => {
  const me = { fullName: 'antony waweru', phone: '0720 725 483', claim: 'member', birthday: '02-14' };
  it('tidies the form and keeps the wedding date only with a spouse', () => {
    const f = cleanSignup({ me, family: [{ fullName: 'Zack Waweru', relation: 'child', claim: 'regular' }], weddingDate: '2010-12-18' });
    expect(f.me.fullName).toBe('Antony Waweru');
    expect(f.me.phone).toBe('+254720725483');
    expect(f.family[0]).toMatchObject({ phone: null, relation: 'child', claim: 'regular' });
    expect(f.weddingDate).toBeNull();
    expect(cleanSignup({ me, family: [{ fullName: 'Margaret Babai', relation: 'spouse', claim: 'regular' }], weddingDate: '2010-12-18' }).weddingDate).toBe('2010-12-18');
  });
  it('asks for what is missing', () => {
    expect(() => cleanSignup({ me: { ...me, phone: '' } })).toThrow(/phone/);
    expect(() => cleanSignup({ me: { ...me, claim: '' } })).toThrow(/Member, Regular or Not a member/);
    expect(() => cleanSignup({ me, family: [{ fullName: 'Zack', phone: '12', claim: 'regular' }] })).toThrow(/phone/);
  });
  it('starts a Member claim as Regular until confirmed', () => {
    expect(startingStatus('member')).toBe('regular');
    expect(startingStatus('none')).toBe('visitor');
    expect(confirmedStatus('member')).toBe('member');
  });
});
