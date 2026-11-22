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

import { classProgress, teacherLabel } from './hopeClasses';
describe('class teachers (2026-11-22)', () => {
  it('names the class with the role', () => {
    expect(teacherLabel(['topaz'])).toBe('Class teacher · Topaz');
    expect(teacherLabel(['rubies', 'jasper'])).toBe('Class teacher · Jasper and Rubies');
    expect(teacherLabel([])).toBe('Class teacher');
  });
  it('counts each class and who marked it', () => {
    const kids = [{ id: 'a', dateOfBirth: '2021-01-01' }, { id: 'b', dateOfBirth: '2021-06-01' }, { id: 'c', dateOfBirth: '2012-01-01' }, { id: 'd', dateOfBirth: null }];
    const p = classProgress(kids, { a: { s: 'present', b: 'Grace' }, c: { s: 'absent', b: 'Diana' } }, '2026-11-21');
    expect(p).toEqual([
      { id: 'jasper', name: 'Jasper', total: 2, marked: 1, by: ['Grace'] },
      { id: 'topaz', name: 'Topaz', total: 1, marked: 1, by: ['Diana'] },
    ]);
  });
});
