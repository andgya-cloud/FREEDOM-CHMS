import { describe, expect, it } from 'vitest';
import { cityOf, clockText, lookFor } from './look';

describe('lookFor', () => {
  it('gives the church campus the cockpit look and every other organization the standard look', () => {
    expect(lookFor({ type: 'church_campus' })).toBe('cockpit');
    expect(lookFor({ type: 'college' })).toBe('standard');
    expect(lookFor({ type: 'ministry' })).toBe('standard');
    expect(lookFor(null)).toBe('standard');
  });
});

describe('header clock', () => {
  it('names the city from the time zone', () => {
    expect(cityOf('Africa/Nairobi')).toBe('Nairobi');
    expect(cityOf('America/New_York')).toBe('New York');
  });
  it('shows the time in the organization time zone', () => {
    expect(clockText(new Date('2026-10-19T09:31:00Z'), 'Africa/Nairobi')).toMatch(/^12:31\sPM$/);
  });
});
