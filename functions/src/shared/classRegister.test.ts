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

describe('three code words and when they are said (2026-11-24)', () => {
  it('never gives the same word twice', async () => {
    const { classWords } = await import('./classRegister.js');
    for (let i = 0; i < 200; i++) {
      const h = (n: number) => ((i * 2654435761 + n * 40503) >>> 0).toString(16).padStart(8, '0') + '00000000';
      const w = classWords(h(1), h(1), h(1));
      expect(new Set([w.start, w.check, w.end]).size).toBe(3);
    }
  });
  it('puts the check word between 8:15 and 8:30 and the last word at 8:45 for an 8 to 9 class', async () => {
    const { wordTimes } = await import('./classRegister.js');
    for (const hex of ['0000000000000000', 'ffffffffffffffff', '12345678abcdef01']) {
      const t = wordTimes({ classStart: '20:00', classEnd: '21:00' }, hex);
      expect(t.check.say).toBeGreaterThanOrEqual(20 * 60 + 15);
      expect(t.check.say).toBeLessThanOrEqual(20 * 60 + 30);
      expect(t.check.to - t.check.from).toBe(10);
      expect(t.end).toEqual({ say: 20 * 60 + 45, from: 20 * 60 + 45, to: 21 * 60 + 5 });
    }
  });
});
