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

import { parseMap } from './aiWrite.js';
describe('parseMap', () => {
  it('keeps only keys we sent and values that pass', () => {
    expect(parseMap('Here: {"1":"rent","2":"made-up","9":"rent"}', ['1', '2'], (_k, v) => v === 'rent')).toEqual({ '1': 'rent' });
  });
  it('survives rubbish', () => expect(parseMap('no json', ['1'], () => true)).toEqual({}));
});

import { numberFacts } from './aiWrite.js';
describe('numberFacts', () => {
  it('keeps numbers and named groups, skips people', () => {
    const f = numberFacts({ enrolled: 10, rate: null, byCourse: [{ name: 'Tailoring', enrolled: 4 }], alerts: [{ studentId: 's1', name: 'Jane Doe', percent: 40 }], kids: [{ code: 'HC-1', name: 'Ann', n: 1 }] });
    expect(f).toEqual(['enrolled: 10', 'byCourse Tailoring enrolled: 4']);
    expect(f.join(' ')).not.toContain('Jane');
    expect(f.join(' ')).not.toContain('Ann');
  });
});

import { parseFill } from './aiWrite.js';
describe('parseFill', () => {
  it('keeps our categories and sane numbers', () => {
    const f = parseFill('{"category":"Transport","payee":"Total","items":[{"description":"Fuel","quantity":2,"unitPrice":1500},{"description":"","quantity":1,"unitPrice":5}]}', ['Transport', 'Other']);
    expect(f).toEqual({ category: 'Transport', payee: 'Total', items: [{ description: 'Fuel', quantity: 2, unitPrice: 1500 }] });
  });
  it('drops a made-up category and bad numbers', () => {
    const f = parseFill('{"category":"Snacks","items":[{"description":"Tea","quantity":-3,"unitPrice":"abc"}]}', ['Other']);
    expect(f.category).toBe('');
    expect(f.items[0]).toEqual({ description: 'Tea', quantity: 1, unitPrice: 0 });
  });
});
