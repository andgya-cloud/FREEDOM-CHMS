import { describe, expect, it } from 'vitest';
import { birthdayLabel, findDuplicatesByPhone, firstName, matchesSearch, stageIdFromName, tidyName, upcomingBirthdays } from './people';

const grace = { fullName: 'Grace Wanjiku Mwangi', phone: '+254712345678' };

describe('search', () => {
  it('matches the start of any name, in any order', () => {
    expect(matchesSearch(grace, 'grace')).toBe(true);
    expect(matchesSearch(grace, 'mwa gra')).toBe(true);
    expect(matchesSearch(grace, 'anjiku')).toBe(false);
  });
  it('matches phone digits typed either way', () => {
    expect(matchesSearch(grace, '0712')).toBe(true);
    expect(matchesSearch(grace, '0712 345')).toBe(true);
    expect(matchesSearch(grace, '+254712')).toBe(true);
    expect(matchesSearch(grace, '345678')).toBe(true);
    expect(matchesSearch(grace, '0799')).toBe(false);
  });
  it('matches everyone on an empty search', () => {
    expect(matchesSearch(grace, '  ')).toBe(true);
  });
});

describe('duplicates', () => {
  const people = [
    { id: 'a', phone: '+254712345678', deletedAt: null },
    { id: 'b', phone: '+254700000000', deletedAt: null },
    { id: 'c', phone: '+254712345678', deletedAt: { seconds: 1 } },
  ];
  it('finds people with the same number however it was typed, ignoring the bin', () => {
    expect(findDuplicatesByPhone('0712 345 678', people).map((p) => p.id)).toEqual(['a']);
    expect(findDuplicatesByPhone('0712345678', people, 'a')).toEqual([]);
    expect(findDuplicatesByPhone('', people)).toEqual([]);
  });
});

describe('names', () => {
  it('tidies names and picks the first name', () => {
    expect(tidyName('  grace   WANJIKU ')).toBe('Grace Wanjiku');
    expect(tidyName('McDonald otieno')).toBe('McDonald Otieno');
    expect(firstName('Grace Wanjiku')).toBe('Grace');
    expect(stageIdFromName('Freedom 252')).toBe('freedom_252');
  });
});

describe('birthdays', () => {
  it('labels day and month', () => {
    expect(birthdayLabel('05-14')).toBe('14 May');
    expect(birthdayLabel('12-01')).toBe('1 December');
  });
  it('finds the next 7 days across the year end, soonest first', () => {
    const people = [{ id: 'a', birthday: '01-02' }, { id: 'b', birthday: '12-30' }, { id: 'c', birthday: '01-10' }, { id: 'd', birthday: null }];
    const found = upcomingBirthdays(people, '2026-12-29');
    expect(found.map((f) => [f.person.id, f.daysAway])).toEqual([['b', 1], ['a', 4]]);
  });
  it('celebrates 29 February on 28 February in other years', () => {
    expect(upcomingBirthdays([{ birthday: '02-29' }], '2027-02-28')).toHaveLength(1);
  });
});
