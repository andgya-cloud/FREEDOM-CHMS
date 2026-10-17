import { describe, expect, it } from 'vitest';
import { passwordProblems } from './password';

describe('passwordProblems', () => {
  it('accepts a strong password', () => {
    expect(passwordProblems('Cedar-River-4821', 'grace@example.org')).toEqual([]);
  });
  it('rejects short, single-case and digit-free passwords', () => {
    expect(passwordProblems('Ab1')).toContain('Use at least 10 characters.');
    expect(passwordProblems('alllowercase1')).toContain('Add a capital letter.');
    expect(passwordProblems('ALLUPPERCASE1')).toContain('Add a lowercase letter.');
    expect(passwordProblems('NoDigitsHere')).toContain('Add a number.');
  });
  it('rejects passwords containing the email name', () => {
    expect(passwordProblems('Wanjiru2026x', 'wanjiru@example.org')).toContain('Do not use your email name in the password.');
  });
});
