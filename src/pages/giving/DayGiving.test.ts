import { describe, expect, it } from 'vitest';
import { otherGivingName } from './DayGiving';

describe('otherGivingName', () => {
  it('reads FCC# codes and plain names alike', () => {
    expect(otherGivingName('FCC#BUILDING')).toBe('Building');
    expect(otherGivingName('fcc #building fund')).toBe('Building Fund');
    expect(otherGivingName('Missions')).toBe('Missions');
    expect(otherGivingName('FCC Thanksgiving')).toBe('Thanksgiving');
  });
});
