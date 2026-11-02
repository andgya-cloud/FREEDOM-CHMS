import { describe, expect, it } from 'vitest';
import { ageOn, ageRangeFor, aboutLines, approvedStatus, changeRows, cleanSignup, confirmedStatus, updatesFor } from './familySignup';

const TODAY = '2026-11-02';
const about = { bornAgain: true, baptised: false, freedomSince: '1to2y', maritalStatus: 'married' };
const me = { fullName: 'antony waweru', phone: '0720 725 483', gender: 'Male', claim: 'member', birthday: '02-14', birthYear: 1985, about };

describe('family sign-up form (Andy, 2026-11-02)', () => {
  it('tidies the form and works out the age range from the birthday (4A)', () => {
    const f = cleanSignup({ me, family: [{ fullName: 'Zack Waweru', relation: 'child', gender: 'Male', birthday: '06-01', birthYear: 2018 }], weddingDate: '2010-12-18' }, TODAY);
    expect(f.me.fullName).toBe('Antony Waweru');
    expect(f.me.phone).toBe('+254720725483');
    expect(f.me.about).toMatchObject({ ageRange: 'middle', maritalStatus: 'married', bornAgain: true, baptised: false, freedomSince: '1to2y' });
    // 7A: a child 0–12 gives only name, gender and birthday.
    expect(f.family[0]).toMatchObject({ relation: 'child', claim: null, about: { ageRange: 'child', bornAgain: null } });
    // Married, so the wedding date is kept even before a spouse is added.
    expect(f.weddingDate).toBe('2010-12-18');
    expect(cleanSignup({ me: { ...me, about: { ...about, maritalStatus: 'single' } }, weddingDate: '2010-12-18' }, TODAY).weddingDate).toBeNull();
  });
  it('asks for the age range only when the year is skipped', () => {
    expect(() => cleanSignup({ me: { ...me, birthYear: null } }, TODAY)).toThrow(/age range/);
    expect(cleanSignup({ me: { ...me, birthYear: null, about: { ...about, ageRange: 'senior' } } }, TODAY).me.about.ageRange).toBe('senior');
  });
  it('asks for what is missing', () => {
    expect(() => cleanSignup({ me: { ...me, phone: '' } }, TODAY)).toThrow(/phone/);
    expect(() => cleanSignup({ me: { ...me, claim: '' } }, TODAY)).toThrow(/Member, Regular or Not a member/);
    expect(() => cleanSignup({ me: { ...me, gender: '' } }, TODAY)).toThrow(/Male or Female/);
    expect(() => cleanSignup({ me: { ...me, about: { ...about, bornAgain: null } } }, TODAY)).toThrow(/born again/);
    expect(() => cleanSignup({ me: { ...me, about: { ...about, maritalStatus: '' } } }, TODAY)).toThrow(/marital/);
    expect(() => cleanSignup({ me, family: [{ fullName: 'Zack', phone: '12', gender: 'Male', birthYear: 2018 }] }, TODAY)).toThrow(/phone/);
    // A teen answers the faith questions but not marital status.
    const teen = { fullName: 'Ruth Waweru', relation: 'child', gender: 'Female', birthYear: 2011, claim: 'regular', about: { bornAgain: true, baptised: true, freedomSince: 'gt5y' } };
    expect(cleanSignup({ me, family: [teen] }, TODAY).family[0].about).toMatchObject({ ageRange: 'teen', maritalStatus: null });
    expect(() => cleanSignup({ me, family: [{ ...teen, about: {} }] }, TODAY)).toThrow(/born again/);
  });
  it('gives the claimed status on approval; children follow the parent', () => {
    expect(confirmedStatus('member')).toBe('member');
    const f = cleanSignup({ me, family: [{ fullName: 'Zack Waweru', relation: 'child', gender: 'Male', birthYear: 2018 }] }, TODAY);
    expect(approvedStatus(f.family[0], 'member')).toBe('regular');
    expect(approvedStatus(f.family[0], 'none')).toBe('visitor');
  });
  it('works out ages', () => {
    expect(ageOn(2000, '12-25', TODAY)).toBe(25);
    expect(ageOn(2000, '01-01', TODAY)).toBe(26);
    expect(ageRangeFor(12)).toBe('child');
    expect(ageRangeFor(60)).toBe('senior');
  });
  it('updates someone already in People and lists what changes (1A)', () => {
    const f = cleanSignup({ me }, TODAY);
    const existing = { fullName: 'Antony Waweru', phone: '+254720725483', email: 'a@x.org', gender: null, status: 'regular', about: { area: 'Kasarani' } };
    const u = updatesFor(existing, f.me, 'member');
    expect(u).not.toHaveProperty('fullName');
    expect(u).not.toHaveProperty('email');
    expect(u).toMatchObject({ gender: 'Male', status: 'member', birthday: '02-14' });
    expect((u.about as Record<string, unknown>).area).toBe('Kasarani');
    const rows = changeRows(existing, u);
    expect(rows).toContainEqual({ label: 'Status', now: 'Regular', next: 'Member' });
    expect(rows).toContainEqual({ label: 'Born again', now: '—', next: 'Yes' });
    expect(rows.find((r) => r.label === 'Where they stay')).toBeUndefined();
    expect(aboutLines(f.me.about).map((l) => l.label)).toContain('Baptised in water');
  });
});
