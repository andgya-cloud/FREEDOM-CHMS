import { describe, expect, it } from 'vitest';
import { AI_DAILY_PER_USER, AI_MONTHLY_CAP, checkLimits, monthKey, userPrompt } from './aiWrite.js';

describe('aiWrite limits', () => {
  it('allows use under both limits', () => expect(checkLimits(0, 0)).toEqual({ ok: true }));
  it('stops at the monthly cap', () => expect(checkLimits(AI_MONTHLY_CAP, 0).ok).toBe(false));
  it('stops at the daily limit for one person', () => expect(checkLimits(10, AI_DAILY_PER_USER).ok).toBe(false));
  it('keys the month', () => expect(monthKey('2026-11-10')).toBe('2026-11'));
  it('puts the draft and note in the prompt', () => {
    const p = userPrompt('followup', 'missed church', 'Hi Jo', 'she was sick');
    expect(p).toContain('missed church'); expect(p).toContain('Hi Jo'); expect(p).toContain('she was sick');
  });
});

import { parsePayer, shortlist } from './aiWrite.js';
describe('payer matching helpers', () => {
  const people = [{ id: 'a', fullName: 'Mary Wanjiku Kamau' }, { id: 'b', fullName: 'John Otieno' }, { id: 'c', fullName: 'Wanjiru Mary' }];
  it('shortlists by shared word starts', () => expect(shortlist('MARY WANJIKU', people).map((p) => p.id)).toEqual(['a', 'c']));
  it('returns nothing for a number-only name', () => expect(shortlist('254712', people)).toEqual([]));
  it('accepts an offered person', () => expect(parsePayer('{"personId":"a","confidence":90,"reason":"same"}', people).personId).toBe('a'));
  it('rejects a person we did not offer', () => expect(parsePayer('{"personId":"zzz","confidence":99,"reason":"x"}', people).personId).toBeNull());
  it('survives rubbish', () => expect(parsePayer('sorry', people).personId).toBeNull());
});
