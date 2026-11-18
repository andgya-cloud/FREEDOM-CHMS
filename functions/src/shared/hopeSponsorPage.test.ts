import { describe, expect, it } from 'vitest';
import { amountLabel, bankLines, cleanGift, cleanNeeds, cleanPledge, DEFAULT_NEEDS, giftEstimate, giftLines, receivedText, cleanSettings, DEFAULT_SETTINGS, heldChildren, holdUntil, listed, namesList, pledgeRef, thankYouText } from './hopeSponsorPage';

describe('Hope sponsorship page', () => {
  it('starts with the Family Bank account and the Paybill', () => {
    const s = cleanSettings(undefined);
    expect(s.banks[0]).toMatchObject({ bank: 'Family Bank', branch: 'Utawala', accountName: 'Freedom in Christ Church', accountNumber: '034000022705' });
    expect(s.paybill).toBe('222118');
    expect(s.amount).toBeNull();
  });

  it('keeps up to four banks and drops empty ones', () => {
    const s = cleanSettings({ amount: '3,000', per: 'term', paybill: '', banks: [{ bank: 'KCB', accountNumber: '1', swift: 'kcbl' }, { bank: '' }, ...Array(5).fill({ bank: 'X', accountNumber: '2' })] });
    expect(s.amount).toBe(3000);
    expect(s.per).toBe('term');
    expect(s.paybill).toBe('');
    expect(s.banks).toHaveLength(4);
    expect(s.banks[0]!.swift).toBe('KCBL');
    expect(amountLabel(s.amount, s.per)).toBe('KES 3,000 a term');
  });

  it('lists only current children without a sponsor who are not hidden', () => {
    expect(listed({ status: 'active' }, false)).toBe(true);
    expect(listed({ status: 'departing', sponsorName: ' ' }, false)).toBe(true);
    expect(listed({ status: 'active', sponsorName: 'Grace' }, false)).toBe(false);
    expect(listed({ status: 'exited' }, false)).toBe(false);
    expect(listed({ status: 'active' }, true)).toBe(false);
    expect(listed({ status: 'active', deletedAt: 1 }, false)).toBe(false);
  });

  it('holds pledged children for 60 days while the money is awaited', () => {
    expect(holdUntil('2026-11-18')).toBe('2027-01-17');
    const pledges = [
      { state: 'waiting' as const, childIds: ['a'], holdUntil: '2027-01-17' },
      { state: 'waiting' as const, childIds: ['b'], holdUntil: '2026-11-17' },
      { state: 'received' as const, childIds: ['c'], holdUntil: '2027-01-17' },
    ];
    expect([...heldChildren(pledges, '2026-11-18')]).toEqual(['a']);
  });

  it('checks the form', () => {
    expect(() => cleanPledge({ name: 'Grace' })).toThrow(/choose a child/);
    expect(() => cleanPledge({ childIds: ['a'], name: 'Grace', dataConsent: true })).toThrow(/promise/);
    expect(() => cleanPledge({ general: true, name: 'Grace' })).toThrow(/keep your details/);
    expect(() => cleanPledge({ general: true, name: 'Grace', dataConsent: true })).toThrow(/tick what you would like/);
    expect(cleanPledge({ general: true, name: 'Grace', dataConsent: true, gift: { other: 'A bicycle' } }).general).toBe(true);
    expect(() => cleanPledge({ general: true, name: 'G', dataConsent: true })).toThrow(/your name/);
    expect(() => cleanPledge({ childIds: ['a', 'b', 'c', 'd', 'e', 'f'], name: 'Grace', promise: true, dataConsent: true })).toThrow(/up to 5/);
    expect(() => cleanPledge({ general: true, name: 'Grace', email: 'nope', dataConsent: true })).toThrow(/email/);
    expect(cleanPledge({ childIds: ['a', 'a', 'x/y'], name: '  Grace  Wanjiru ', email: 'G@Mail.com', country: 'Kenya', promise: true, dataConsent: true }))
      .toEqual({ childIds: ['a'], general: false, name: 'Grace Wanjiru', email: 'g@mail.com', phone: '', country: 'Kenya', gift: null });
  });

  it('writes the thank-you with the reference and bank details', () => {
    expect(pledgeRef(12)).toBe('SP-0012');
    expect(namesList(['Amani', 'Brian', 'the Hope Centre'])).toBe('Amani, Brian and the Hope Centre');
    const t = thankYouText('Grace', ['Amani'], 'SP-0012', DEFAULT_SETTINGS);
    expect(t).toContain('Dear Grace');
    expect(t).toContain('Account number: 034000022705');
    expect(t).toContain('M-Pesa Paybill: 222118, Account: SP-0012');
    expect(bankLines({ ...DEFAULT_SETTINGS, paybill: '' }, 'SP-1').join('\n')).not.toContain('Paybill');
  });
});

describe('Hope Centre needs (Andy, 2026-11-18, 1A-10A)', () => {
  it('keeps at most three stars and unique ids', () => {
    const list = cleanNeeds([
      { id: 'a', label: 'Shoes', star: true, count: true, cost: '1,500', per: 'a pair' }, { id: 'a', label: 'Shoes again', star: true },
      { label: 'Blankets', star: true }, { label: 'Pads', star: true }, { label: '' }, { id: 'most-needed', label: 'Sneaky' },
    ]);
    expect(list.map((n) => n.id)).toEqual(['a', 'a-2', 'blankets', 'pads', 'sneaky']);
    expect(list.filter((n) => n.star)).toHaveLength(3);
    expect(list[0]).toMatchObject({ cost: 1500, per: 'a pair', count: true, group: 'centre' });
    expect(cleanNeeds(undefined)).toBe(DEFAULT_NEEDS);
  });
  it('checks the gift against the list and copies the label and cost', () => {
    const g = cleanGift({ needs: [{ id: 'school-shoes', qty: 3 }, { id: 'porridge', qty: 9 }, { id: 'nope' }, { id: 'school-shoes' }], other: '  a  bicycle ', mostNeeded: { amount: 2000, often: 'monthly' } }, DEFAULT_NEEDS);
    expect(g.needs).toEqual([{ id: 'school-shoes', label: 'School shoes', qty: 3, cost: 1500 }, { id: 'porridge', label: 'Breakfast porridge', qty: null, cost: 3000 }]);
    expect(g.other).toBe('a bicycle');
    expect(giftLines(g)).toEqual(['Where most needed: KES 2,000 every month', 'School shoes × 3', 'Breakfast porridge', 'Other: a bicycle']);
    expect(giftEstimate(g)).toBe(4500 + 3000 + 2000);
    // Items in kind never carry a money gift.
    expect(cleanGift({ giveBy: 'items', needs: [{ id: 'blanket', qty: 2 }], mostNeeded: { amount: 500 } }, DEFAULT_NEEDS).mostNeeded).toBeNull();
    expect(() => cleanGift({ giveBy: 'items', mostNeeded: { amount: 500 } }, DEFAULT_NEEDS)).toThrow(/tick what/);
  });
  it('words the thank-you for money or items', () => {
    const items = cleanGift({ giveBy: 'items', needs: [{ id: 'blanket', qty: 2 }] }, DEFAULT_NEEDS);
    const t = thankYouText('Grace', ['the Hope Centre'], 'SP-0003', DEFAULT_SETTINGS, 0, items);
    expect(t).toContain('• Blanket × 2');
    expect(t).toContain('Bringing the items');
    expect(t).not.toContain('034000022705');
    const both = thankYouText('Grace', ['Amani', 'the Hope Centre'], 'SP-0004', DEFAULT_SETTINGS, 1, items);
    expect(both).toContain('034000022705');
    expect(both).toContain('Bringing the items');
    expect(receivedText('Grace', ['the Hope Centre'], 'SP-0003', 0, items, true)).toMatch(/reached the children[\s\S]*Blanket × 2[\s\S]*attached a photo/);
  });
});
