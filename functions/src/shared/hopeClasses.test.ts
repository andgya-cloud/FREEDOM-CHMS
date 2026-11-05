import { describe, expect, it } from 'vitest';
import { classForAge, classOf, hasAllergy } from './hopeClasses';

describe('Hope classes', () => {
  it('groups by age', () => {
    expect(classForAge(2)).toBeNull();
    expect(classForAge(3)?.name).toBe('Jasper');
    expect(classForAge(5)?.name).toBe('Jasper');
    expect(classForAge(6)?.name).toBe('Rubies');
    expect(classForAge(9)?.name).toBe('Sapphire');
    expect(classForAge(12)?.name).toBe('Emerald');
    expect(classForAge(13)?.name).toBe('Topaz');
    expect(classForAge(17)?.name).toBe('Topaz');
  });
  it('moves up on the birthday', () => {
    expect(classOf('2017-11-06', '2026-11-05')?.name).toBe('Sapphire');
    expect(classOf('2016-11-05', '2026-11-05')?.name).toBe('Emerald');
    expect(classOf(null, '2026-11-05')).toBeNull();
  });
  it('knows an allergy', () => {
    expect(hasAllergy('Peanuts')).toBe(true);
    expect(hasAllergy('None known')).toBe(false);
    expect(hasAllergy('none')).toBe(false);
    expect(hasAllergy('')).toBe(false);
  });
});
