import { describe, expect, it } from 'vitest';
import { matchPayments, readDay, readPayments } from './bankMatch';

describe('readDay', () => {
  it('reads the usual date forms', () => {
    expect(readDay('15 Jun 2026')).toBe('2026-06-15');
    expect(readDay('05-JUL-2026')).toBe('2026-07-05');
    expect(readDay('05/07/2026')).toBe('2026-07-05');
    expect(readDay('2026-07-05')).toBe('2026-07-05');
    expect(readDay(new Date('2026-07-05T00:00:00Z'))).toBe('2026-07-05');
    expect(readDay('Total')).toBeNull();
  });
});

describe('readPayments', () => {
  it('reads the Excel list by its headings', () => {
    const rows = [['Payments to Payee'], [], [], ['Date', 'Value date', 'Bank reference', 'Amount (KES)', 'Charges (KES)'],
      ['15 Jun 2026', '15 Jun 2026', '1234567890', 19700, 33], ['22 Jun 2026', '22 Jun 2026', '1234567891', '21,700.00', 33], ['Total', '', '', 41400, 66]];
    expect(readPayments(rows)).toEqual({ payments: [{ day: '2026-06-15', ref: '1234567890', cents: 1_970_000 }, { day: '2026-06-22', ref: '1234567891', cents: 2_170_000 }], skipped: 0 });
  });
  it('reads PDF text lines', () => {
    const rows = [['Date Value date Bank reference Amount'], ['15 Jun 2026', '15 Jun 2026', '1234567890', '19,700.00', '33.00', '120,000.00'], ['Page 1 of 2']];
    expect(readPayments(rows).payments).toEqual([{ day: '2026-06-15', ref: '1234567890', cents: 1_970_000 }]);
  });
});

describe('matchPayments', () => {
  const req = (id: string, day: string, cents = 2_170_000) => ({ id, day, cents });
  it('pairs each weekly payment with the nearest requisition and leaves extras out', () => {
    const reqs = [req('a', '2026-03-01'), req('b', '2026-03-08'), req('c', '2026-03-15')];
    const pays = [{ day: '2026-03-02', ref: 'R1', cents: 1_970_000 }, { day: '2026-03-09', ref: 'R2', cents: 1_970_000 }, { day: '2026-03-28', ref: 'R3', cents: 1_970_000 }];
    const m = matchPayments(pays, reqs);
    expect(m.map((x) => [x.reqId, x.ref, x.cents])).toEqual([['a', 'R1', 1_970_000], ['b', 'R2', 1_970_000]]);
  });
  it('never uses a payment or a requisition twice, and prefers the same amount at the same distance', () => {
    const reqs = [req('a', '2026-03-05', 1_000_000), req('b', '2026-03-05', 2_000_000)];
    const m = matchPayments([{ day: '2026-03-05', ref: 'R1', cents: 2_000_000 }], reqs);
    expect(m).toHaveLength(1);
    expect(m[0]!.reqId).toBe('b');
  });
  it('does not match payments more than a week away', () => {
    expect(matchPayments([{ day: '2026-03-20', ref: 'R', cents: 1 }], [req('a', '2026-03-01')])).toEqual([]);
  });
  it('leaves a small extra payment out and takes the main one', () => {
    const m = matchPayments([{ day: '2026-04-07', ref: 'SMALL', cents: 250_000 }, { day: '2026-04-07', ref: 'MAIN', cents: 1_970_000 }], [req('a', '2026-04-05')]);
    expect(m.map((x) => x.ref)).toEqual(['MAIN']);
  });
});
