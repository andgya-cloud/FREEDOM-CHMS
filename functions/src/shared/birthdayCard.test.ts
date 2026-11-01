import { describe, expect, it } from 'vitest';
import { cardGreeting, cardId, cleanLayout, DEFAULT_LAYOUT, drawGreeting } from './birthdayCard';

describe('birthday card', () => {
  it('greets by first name only', () => {
    expect(cardGreeting('Mary')).toBe('Dear Mary,');
    expect(cardGreeting(' Mary Wanjiku ')).toBe('Dear Mary,');
    expect(cardGreeting('')).toBe('');
    expect(cardId('p1', 2026)).toBe('p1_2026');
  });

  it('falls back to the default layout for odd values', () => {
    expect(cleanLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(cleanLayout({ x: 2, y: 0.5, color: 'red' })).toEqual({ x: DEFAULT_LAYOUT.x, y: 0.5, color: DEFAULT_LAYOUT.color });
  });

  it('shrinks a long name to fit', () => {
    const calls: { font: string; x: number; y: number }[] = [];
    const ctx = { font: '', fillStyle: '', textAlign: '', textBaseline: '', measureText: (t: string) => ({ width: t.length * parseInt(ctx.font, 10) * 0.5 }), fillText: (_t: string, x: number, y: number) => { calls.push({ font: ctx.font, x, y }); } };
    drawGreeting(ctx, 1000, 1500, 'Dear Christabella-Wanjiru,', DEFAULT_LAYOUT);
    expect(parseInt(calls[0]!.font, 10)).toBeLessThan(62);
    expect(calls[0]!.x).toBe(640);
  });
});
