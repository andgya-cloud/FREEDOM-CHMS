import { describe, expect, it } from 'vitest';
import { familyGroups, familyName, familySuggestions, groupedList, pairKey, roleOf, sortFamily, surnameOf, type FamilyMember } from './families';

const p = (id: string, fullName: string, extra: Partial<FamilyMember> = {}): FamilyMember => ({ id, fullName, status: 'regular', ...extra });

describe('families', () => {
  const andrew = p('a', 'Andrew Guya', { householdId: 'h', gender: 'male', phone: '+254728354575' });
  const doreen = p('d', 'Doreen Guya', { householdId: 'h', gender: 'female' });
  const don = p('n', 'Don Guya', { householdId: 'h', status: 'child', birthYear: 2012 });
  const levi = p('l', 'Levi Guya', { householdId: 'h', status: 'child', birthYear: 2015 });
  const ron = p('r', 'Ron Guya', { householdId: 'h', familyRole: 'child', birthYear: 2009, birthday: '04-02' });
  const jane = p('j', 'Jane Wanjiku');

  it('reads roles and surnames', () => {
    expect(roleOf(don)).toBe('child');
    expect(roleOf(andrew)).toBe('parent');
    expect(roleOf(p('x', 'X', { guardianId: 'a' }))).toBe('child');
    expect(surnameOf('Andrew Guya')).toBe('Guya');
    expect(surnameOf('Madonna')).toBe('');
  });

  it('puts parents first, father first, then children oldest to youngest', () => {
    expect(sortFamily([levi, doreen, don, ron, andrew]).map((x) => x.id)).toEqual(['a', 'd', 'r', 'n', 'l']);
  });

  it('children with no birth year go last', () => {
    const baby = p('b', 'Baby Guya', { status: 'child' });
    expect(sortFamily([baby, levi]).map((x) => x.id)).toEqual(['l', 'b']);
  });

  it('names a family from the first parent, or the stored name', () => {
    expect(familyName([don, andrew])).toBe('Guya family');
    expect(familyName([don, andrew], 'Andrew and Doreen Guya')).toBe('Andrew and Doreen Guya');
    expect(familyName([p('m', 'Madonna', { householdId: 'q' })])).toBe('Family');
  });

  it('groups families of two or more and mixes them with singles A to Z', () => {
    const lone = p('z', 'Zed Otieno', { householdId: 'solo' });
    expect(familyGroups([andrew, doreen, lone]).size).toBe(1);
    const list = groupedList([jane, levi, andrew, doreen, lone]);
    expect(list.map((i) => (i.kind === 'family' ? `F:${i.members.length}` : i.person.id))).toEqual(['F:3', 'j', 'z']);
  });

  it('suggests a child linked to a parent, and the same surname and phone', () => {
    const mary = p('m', 'Mary Atieno', { phone: '+254722000111' });
    const baraka = p('b', 'Baraka Atieno', { status: 'child', guardianId: 'm' });
    const tom = p('t', 'Tom Atieno', { whatsapp: '+254722000111' });
    const other = p('o', 'Otis Kamau', { phone: '+254722000111' });
    const s = familySuggestions([mary, baraka, tom, other], new Set());
    expect(s.map((x) => [x.anchor.id, x.member.id, x.role])).toEqual([['m', 'b', 'child'], ['m', 't', 'parent']]);
    expect(familySuggestions([mary, baraka], new Set([pairKey('b', 'm')]))).toEqual([]);
    expect(familySuggestions([{ ...mary, householdId: 'h1' }, { ...baraka, householdId: 'h1' }], new Set())).toEqual([]);
  });
});
