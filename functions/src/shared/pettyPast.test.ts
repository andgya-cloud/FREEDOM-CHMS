import { describe, expect, it } from 'vitest';
import { dayOf, readPastSheets, renumberShift } from './pettyPast';
import { CHURCH_PETTY_CASH_CATEGORIES } from './pettyCash';

const head = ['Voucher no.', 'Date', 'Requester', 'Category', 'Category note', 'Item', 'Qty', 'Unit price (KES)', 'Amount (KES)', 'Paid to', 'M-Pesa code', 'Family Bank ref. no.', 'Approver 1', 'Approver 2'];
const row = (n: string, date: string, item: string, price: number, cat = 'Staff Payments', a1 = 'Andrew Guya', a2 = 'Doreen Mayaka', note = '') =>
  [n, date, "Daniel Ojwang'", cat, note, item, 1, price, price, '', '', '', a1, a2];

describe('past petty cash sheet', () => {
  it('groups rows by voucher number and reads money in', () => {
    const r = readPastSheets([['Freedom Church'], head,
      row('FCN-00002', '2026-01-31', 'Solomon Njogu, caretaker', 15000),
      row('FCN-00002', '2026-01-31', 'Purity Kaare, caretaker', 4000),
      row('FCN-00001', '2026-01-04', 'Band appreciation', 21700),
      row('FCN-00003', '2026-01-31', 'Security', 10000, 'Other', 'Doreen Mayaka', 'Elias Omondi', 'Security')],
    [['Date', 'Amount (KES)', 'Note'], ['2026-01-01', 50700, 'January']], CHURCH_PETTY_CASH_CATEGORIES, 'FCN');
    expect(r.problems).toEqual([]);
    expect(r.requisitions.map((q) => q.number)).toEqual(['FCN-00001', 'FCN-00002', 'FCN-00003']);
    expect(r.requisitions[1]!.items).toHaveLength(2);
    expect(r.requisitions[2]!.categoryNote).toBe('Security');
    expect(r.moneyIn).toEqual([{ date: '2026-01-01', amountCents: 5_070_000, note: 'January' }]);
  });

  it('keeps the controls: Andy above KES 10,000, two approvers, not the requester', () => {
    const r = readPastSheets([head,
      row('FCN-00001', '2026-01-04', 'Band', 21700, 'Staff Payments', 'Doreen Mayaka', 'Elias Omondi'),
      row('FCN-00002', '2026-01-04', 'Tea', 2000, 'Hospitality', "Daniel Ojwang'", 'Elias Omondi'),
      row('FCN-00003', 'soon', 'Tea', 2000, 'Hospitality')], [], CHURCH_PETTY_CASH_CATEGORIES, 'FCN');
    expect(r.problems.join(' ')).toMatch(/FCN-00001: over KES 10,000/);
    expect(r.problems.join(' ')).toMatch(/cannot approve their own/);
    expect(r.problems.join(' ')).toMatch(/date is missing/);
  });

  it('reads Excel day numbers and Kenyan dates', () => {
    expect(dayOf(46026)).toBe('2026-01-04');
    expect(dayOf('4/1/2026')).toBe('2026-01-04');
  });

  it('moves app numbers up only when they clash', () => {
    expect(renumberShift(['FCN-00001', 'FCN-00073'], ['FCN-00001'])).toBe(73);
    expect(renumberShift(['FCN-00073'], ['FCN-00074', 'FCN-00075'])).toBe(0);
    expect(renumberShift(['FCN-00073'], [])).toBe(0);
  });
});
