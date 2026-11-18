import { describe, expect, it } from 'vitest';
import { amountLabel, bankLines, cleanPledge, cleanSettings, DEFAULT_SETTINGS, heldChildren, holdUntil, listed, namesList, pledgeRef, thankYouText } from './hopeSponsorPage';

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
    expect(() => cleanPledge({ general: true, name: 'G' })).toThrow(/your name/);
    expect(() => cleanPledge({ childIds: ['a', 'b', 'c', 'd', 'e', 'f'], name: 'Grace' })).toThrow(/up to 5/);
    expect(() => cleanPledge({ general: true, name: 'Grace', email: 'nope' })).toThrow(/email/);
    expect(cleanPledge({ childIds: ['a', 'a', 'x/y'], name: '  Grace  Wanjiru ', email: 'G@Mail.com', country: 'Kenya' }))
      .toEqual({ childIds: ['a'], general: false, name: 'Grace Wanjiru', email: 'g@mail.com', phone: '', country: 'Kenya' });
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
