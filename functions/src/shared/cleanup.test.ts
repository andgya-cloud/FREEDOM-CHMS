import { describe, expect, it } from 'vitest';
import { daysLeft, describeEntry, isOfficial, kindLabel, kindsFor, linkedSummary, looksLikeTest, matchesText } from './cleanup';

describe('clean-up', () => {
  it('spots test-looking names', () => {
    expect(looksLikeTest('Test Visitor')).toBe(true);
    expect(looksLikeTest('Jane Demo')).toBe(true);
    expect(looksLikeTest('Sample student 3')).toBe(true);
    expect(looksLikeTest('testing123')).toBe(true);
    expect(looksLikeTest('Contest winners')).toBe(false);
    expect(looksLikeTest('Testimony Night')).toBe(false);
    expect(looksLikeTest('Mary Wanjiru')).toBe(false);
  });

  it('matches every word typed', () => {
    expect(matchesText('Sunday Service', '12 Oct 2026', 'sunday oct')).toBe(true);
    expect(matchesText('Sunday Service', '', 'friday')).toBe(false);
    expect(matchesText('Anything', '', '  ')).toBe(true);
  });

  it('shows only the types each organization has', () => {
    expect(kindsFor('college')).toContain('examSheet');
    expect(kindsFor('college')).not.toContain('team');
    expect(kindsFor('church_campus')).toContain('team');
    expect(kindsFor('church_campus')).not.toContain('payrollRun');
    expect(kindLabel('person', 'college')).toBe('Students');
    expect(kindLabel('person', 'church_campus')).toBe('People');
  });

  it('treats money and official records as official', () => {
    expect(isOfficial('gift', {})).toBe(true);
    expect(isOfficial('payrollRun', {})).toBe(true);
    expect(isOfficial('examSheet', { status: 'draft' })).toBe(false);
    expect(isOfficial('examSheet', { status: 'approved' })).toBe(true);
    expect(isOfficial('person', {})).toBe(false);
  });

  it('describes entries in plain words', () => {
    expect(describeEntry('gift', 'g1', { giverName: 'John', amountCents: 150000, date: '2026-10-12', method: 'mpesa' }).label).toBe('John · KES 1,500');
    expect(describeEntry('payrollRun', '2026-09', { month: '2026-09', status: 'approved' })).toEqual({ label: 'Payroll 2026-09', detail: 'Approved' });
    expect(linkedSummary({ 'attendance marks': 3, notes: 0, 'student record': 1 })).toBe('3 attendance marks, 1 student record')
    expect(linkedSummary({ 'attendance marks': 1, 'gifts and payments': 1 })).toBe('1 attendance mark, 1 gift or payment');
  });

  it('counts the days left in the Recycle Bin', () => {
    const day = 86_400_000;
    expect(daysLeft(0, 0)).toBe(30);
    expect(daysLeft(0, 29.5 * day)).toBe(1);
    expect(daysLeft(0, 31 * day)).toBe(0);
  });
});
