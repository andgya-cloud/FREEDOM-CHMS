import { describe, expect, it } from 'vitest';
import { fillMessage, HOPE_SIGN_OFF, recipients, waLink } from './hopeMessages';

describe('Hope messages', () => {
  it('sends one message per parent phone', () => {
    const r = recipients([
      { id: 'a', name: 'Amani Otieno', parentName: 'Grace Otieno', parentPhone: '0712 345 678' },
      { id: 'b', name: 'Baraka Otieno', parentName: '', parentPhone: '+254712345678' },
      { id: 'c', name: 'Neema W.', parentName: 'Ruth', parentPhone: '' },
    ]);
    expect(r.to).toHaveLength(1);
    expect(r.to[0]!.children.map((c) => c.id)).toEqual(['a', 'b']);
    expect(r.noPhone.map((c) => c.id)).toEqual(['c']);
    expect(fillMessage('Hello {parent}, {child} is welcome.', r.to[0]!)).toBe(`Hello Grace, Amani and Baraka is welcome.\n\n${HOPE_SIGN_OFF}`);
  });
  it('makes a wa.me link', () => {
    expect(waLink('0712 345 678', 'Hi')).toBe('https://wa.me/254712345678?text=Hi');
  });
});
