import { describe, expect, it } from 'vitest';
import { F252_SETUP, F252_PLAN, F252_TOPICS, isWindowOpen, nextPlanned, percentOf, plannedOn, scanWindow, clockLabel } from './classRegister.js';

describe('Freedom 252 calendar', () => {
  it('has 24 topics, each with one class date, starting 10 Nov 2026', () => {
    expect(F252_TOPICS).toHaveLength(24);
    expect(new Set(F252_PLAN.map((p) => p.date)).size).toBe(24);
    expect(plannedOn(F252_PLAN, '2026-11-10')?.topicId).toBe('topic_01');
    expect(nextPlanned(F252_PLAN, '2026-12-02')?.date).toBe('2027-01-05');
    expect(F252_TOPICS[23]!.name).toBe("The Leader's Prayer Life");
  });
  it('opens scanning 30 minutes before 8pm until the class ends at 9pm', () => {
    const cfg = { classStart: F252_SETUP.classStart, classEnd: F252_SETUP.classEnd };
    expect(scanWindow(cfg).label).toBe('7:30pm to 9:00pm');
    expect(isWindowOpen(cfg, 21 * 60 + 1)).toBe(false);
    expect(isWindowOpen(cfg, 19 * 60 + 29)).toBe(false);
    expect(isWindowOpen(cfg, 19 * 60 + 30)).toBe(true);
    expect(isWindowOpen(cfg, 22 * 60 + 1)).toBe(false);
    expect(clockLabel('09:05')).toBe('9:05am');
  });
  it('makes each topic one 24th', () => {
    expect(percentOf(1, 24)).toBe(4);
    expect(percentOf(12, 24)).toBe(50);
    expect(percentOf(24, 24)).toBe(100);
  });
});
