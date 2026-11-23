import { describe, expect, it } from 'vitest';
import { matchList, nameScore, nameWords } from './classList.js';

// The Freedom 252 register and Andy's list for Tuesday 17 November 2026.
const REGISTER = ['Doreen Guya', 'Teckla Murage', 'Lionel Zepher', 'Faith Nene', 'Omwange Sarah Kemunto', 'Felix Kimanthi', 'Mercy Wanjiru Muthoni',
  'Monica Marende', 'Naomi Wanjiku Njuguna', 'Clinton Raila', 'Peter Gitau', 'Sharone Moraa Ondimu', 'Millicent Nyabiage Nyabuto', 'Nancy Mueni Kavisa',
  'Risper Nyambura Wanjiku', 'Immaculate Susan Wanjiru Gitau', 'Muriithi Brian Muigai', 'Christine Ochola Juma', 'Jidraph Ikua Kinuthia', 'Beatrice Omondi',
  'Muthoni Purity Wangeci', 'Simo Matheka', 'Vivienne Anyango Oduor', 'Faith Katuku Mutemi', 'Isaka Sandra Riziki', 'Juliet Kavogoi Lwamba', 'Sospeter',
  'George Gitonga', 'Sarah Mwangi', 'Justina Kagendo'].map((name, i) => ({ id: `p${i}`, name }));
const LIST = ['Sharon Ondimu', 'Sarah Kemunto', 'Amos Muya', 'Adhiambo Beatrice', 'Ann Nungari', 'Cynthia Osewe', 'Elizabeth K.', 'Emmy Muthoni', 'Faith Mutemi',
  'Faith Nene', 'George Gitonga', 'Immaculate Susan Wanjiru Gitau', 'Jidraph Ikua Kinuthia', 'Judith Akello', 'Millicent Nyabuto', 'Monica Marende',
  'Naomi Wanjiku Njuguna', 'Pal Getuno', 'Phelgona Oloo', 'Muremi Samuel Kangangi', 'Sandra Kemunto', 'Sarah Mwangi', 'Sharone Moraa Ondimu', 'Teckla Murage',
  'Sandra Isaka', 'Brian Musau', 'Carol Gitahi', 'Millicent Nyabuto', 'Rehema Waronga'];
const nameOf = (id: string | null) => REGISTER.find((r) => r.id === id)?.name ?? null;

describe('marking a class from a list (2026-11-23)', () => {
  it('reads the words of a name without initials', () => {
    expect(nameWords('Elizabeth K.')).toEqual(['elizabeth']);
    expect(nameScore('Sharon Ondimu', 'Sharone Moraa Ondimu')).toBe(2);
  });
  it('matches Andy\'s list: sure names on their own, guesses to check, the rest new', () => {
    const m = matchList(LIST, REGISTER);
    const found = m.filter((x) => x.status === 'found').map((x) => `${x.name} = ${nameOf(x.personId)}`);
    expect(found).toEqual([
      'Sharon Ondimu = Sharone Moraa Ondimu', 'Sarah Kemunto = Omwange Sarah Kemunto', 'Faith Mutemi = Faith Katuku Mutemi', 'Faith Nene = Faith Nene',
      'George Gitonga = George Gitonga', 'Immaculate Susan Wanjiru Gitau = Immaculate Susan Wanjiru Gitau', 'Jidraph Ikua Kinuthia = Jidraph Ikua Kinuthia',
      'Millicent Nyabuto = Millicent Nyabiage Nyabuto', 'Monica Marende = Monica Marende', 'Naomi Wanjiku Njuguna = Naomi Wanjiku Njuguna',
      'Sarah Mwangi = Sarah Mwangi', 'Sharone Moraa Ondimu = Sharone Moraa Ondimu', 'Teckla Murage = Teckla Murage', 'Sandra Isaka = Isaka Sandra Riziki',
      'Millicent Nyabuto = Millicent Nyabiage Nyabuto',
    ]);
    const check = m.filter((x) => x.status === 'check').map((x) => x.name);
    expect(check).toEqual(['Adhiambo Beatrice', 'Emmy Muthoni', 'Sandra Kemunto', 'Brian Musau']);
    expect(nameOf(m.find((x) => x.name === 'Emmy Muthoni')!.maybe[0]!)).toMatch(/Muthoni/);
    expect(m.filter((x) => x.status === 'new').map((x) => x.name)).toEqual([
      'Amos Muya', 'Ann Nungari', 'Cynthia Osewe', 'Elizabeth K.', 'Judith Akello', 'Pal Getuno', 'Phelgona Oloo', 'Muremi Samuel Kangangi', 'Carol Gitahi', 'Rehema Waronga',
    ]);
    expect(m.filter((x) => x.repeat).map((x) => x.name)).toEqual(['Millicent Nyabuto']);
  });
});
