import { describe, expect, it } from 'vitest';
import { canTypeBankBalance, typesWithoutPin } from './bankTyped';

describe('who types the bank balance', () => {
  it('lets Andrew, Doreen, Elias and Daniel type it; only Andrew and Doreen skip the PIN', () => {
    for (const n of ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya', 'Elias Omondi', "Daniel Ojwang'", 'daniel ojwang']) expect(canTypeBankBalance(n)).toBe(true);
    expect(canTypeBankBalance('Ronald Awili')).toBe(false);
    expect(typesWithoutPin('Andrew Guya')).toBe(true);
    expect(typesWithoutPin('Doreen Guya')).toBe(true);
    expect(typesWithoutPin('Elias Omondi')).toBe(false);
    expect(typesWithoutPin("Daniel Ojwang'")).toBe(false);
  });
});
