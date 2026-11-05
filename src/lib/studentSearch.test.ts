import { describe, expect, it } from 'vitest';
import { initialOf, matchesStudent } from './studentSearch';

describe('matchesStudent', () => {
  it('finds a name by any of its words, in any order', () => {
    expect(matchesStudent('mbatha', 'AGNES MBATHA')).toBe(true);
    expect(matchesStudent('mbatha ag', 'AGNES MBATHA')).toBe(true);
    expect(matchesStudent('wanjiru', 'AGNES MBATHA')).toBe(false);
    expect(matchesStudent('  ', 'AGNES MBATHA')).toBe(true);
  });
  it('finds an admission number however it is typed', () => {
    expect(matchesStudent('IT/2025/1/002', 'AGNES MBATHA', 'ADIA/IT/2025/1/002')).toBe(true);
    expect(matchesStudent('ctr 2025 1 003', 'X', 'ADIA/ CTR/2025/1/003')).toBe(true);
    expect(matchesStudent('002', 'X', 'ADIA/IT/2025/1/002')).toBe(true);
    expect(matchesStudent('009', 'X', 'ADIA/IT/2025/1/002')).toBe(false);
  });
  it('files a name under its first letter', () => {
    expect(initialOf(' agnes')).toBe('A');
    expect(initialOf('1st')).toBe('#');
  });
});
