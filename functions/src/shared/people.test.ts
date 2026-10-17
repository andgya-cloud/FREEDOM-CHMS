import { describe, expect, it } from 'vitest';
import { findDuplicatesByPhone, firstName, matchesSearch, stageIdFromName, tidyName } from './people';

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
