import { describe, expect, it } from 'vitest';
import {
  fundNamed,
  otherFundIdFor,
  otherGivingFromReference,
  parseMpesaMessage,
  tidyFundName,
  formatMoney,
  formatReceiptNumber,
  fundFromReference,
  ledgerChanges,
  matchPayment,
  nameSimilarity,
  normalizeMpesaCode,
  parseAmount,
  parseCsv,
  parseReceiptNumber,
  parseStatement,
  parseStatementDate,
  phoneMatcher,
  STANDARD_FUNDS,
  suggestedMatch,
  type GiftForLedger,
} from './giving';

describe('money', () => {
  it('reads amounts the way staff type them', () => {
    expect(parseAmount('1,500')).toBe(150000);
    expect(parseAmount('KES 1500.50')).toBe(150050);
    expect(parseAmount(' 200 ')).toBe(20000);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-50')).toBeNull();
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(250.5)).toBe(25050);
  });

  it('shows shillings with cents only when there are some', () => {
    expect(formatMoney(150000)).toBe('KES 1,500');
    expect(formatMoney(150050)).toBe('KES 1,500.50');
    expect(formatMoney(-2000)).toBe('-KES 20');
  });
});

describe('funds from account references', () => {
  const funds = [...STANDARD_FUNDS, { id: 'building', name: 'Building Fund', aliases: ['Building'] }];

  it('takes the fund from the text after the #', () => {
    expect(fundFromReference('FCC#Tithes', funds)?.id).toBe('tithes');
    expect(fundFromReference('fcc#offerings', funds)?.id).toBe('offerings');
    expect(fundFromReference('FCC# Tithe', funds)?.id).toBe('tithes');
    expect(fundFromReference('FCC#BUILDING', funds)?.id).toBe('building');
    expect(fundFromReference('FCC#building fund', funds)?.id).toBe('building');
  });

  it('leaves unknown or missing funds for staff to choose', () => {
    expect(fundFromReference('FCC#Missions', funds)).toBeNull();
    expect(fundFromReference('Tithes', funds)).toBeNull();
    expect(fundFromReference('', funds)).toBeNull();
    expect(fundFromReference('FCC#Tithes', [{ id: 'tithes', name: 'Tithes', active: false }])).toBeNull();
  });
});

describe('M-Pesa codes and receipt numbers', () => {
  it('accepts real transaction codes only', () => {
    expect(normalizeMpesaCode(' qjk3abcd12 ')).toBe('QJK3ABCD12');
    expect(normalizeMpesaCode('1234567890')).toBeNull();
    expect(normalizeMpesaCode('ABC')).toBeNull();
  });

  it('numbers receipts per organization and year with six digits', () => {
    expect(formatReceiptNumber('FCN', 2026, 123)).toBe('FCN-2026-000123');
    expect(formatReceiptNumber('ADIA', 2027, 1)).toBe('ADIA-2027-000001');
    expect(parseReceiptNumber('FCN-2026-000123')).toEqual({ prefix: 'FCN', year: 2026, sequence: 123 });
    expect(parseReceiptNumber('FCN-2026-1')).toBeNull();
  });
});

describe('fund ledger', () => {
  const gift: GiftForLedger = { date: '2026-10-11', amountCents: 100000, fundId: 'tithes', method: 'mpesa', status: 'confirmed' };

  it('adds a confirmed gift once and takes a voided one back out', () => {
    expect(ledgerChanges(null, gift)).toEqual([{ month: '2026-10', fund: 'tithes', method: 'mpesa', cents: 100000, count: 1 }]);
    expect(ledgerChanges(gift, { ...gift, status: 'void' })).toEqual([{ month: '2026-10', fund: 'tithes', method: 'mpesa', cents: -100000, count: -1 }]);
  });

  it('ignores unassigned payments and unrelated edits', () => {
    expect(ledgerChanges(null, { ...gift, status: 'unassigned' })).toEqual([]);
    expect(ledgerChanges(gift, { ...gift })).toEqual([]);
  });

  it('keeps the Unassigned queue apart, and empties it on assignment', () => {
    const queued = { ...gift, status: 'unassigned' as const, fundId: null };
    expect(ledgerChanges(null, queued, 'unassigned')).toEqual([{ month: '2026-10', fund: 'none', method: 'mpesa', cents: 100000, count: 1 }]);
    expect(ledgerChanges(queued, gift, 'unassigned')).toEqual([{ month: '2026-10', fund: 'none', method: 'mpesa', cents: -100000, count: -1 }]);
    expect(ledgerChanges(null, gift, 'unassigned')).toEqual([]);
  });

  it('moves a gift when its fund changes on assignment', () => {
    const changes = ledgerChanges({ ...gift, status: 'unassigned', fundId: null }, gift);
    expect(changes).toEqual([{ month: '2026-10', fund: 'tithes', method: 'mpesa', cents: 100000, count: 1 }]);
  });
});

describe('reading a Paybill statement', () => {
  const csv = [
    'Organisation Name,FREEDOM CHURCH',
    'Short Code,222118',
    '',
    'Receipt No.,Completion Time,Initiation Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Balance Confirmed,Reason Type,Other Party Info,Linked Transaction ID,A/C No.',
    'QJK1AAAA01,11-10-2026 09:15:02,11-10-2026 09:15:02,Pay Bill from 254712345678 - JANE WANJIKU Acc. FCC#Tithes,Completed,"1,000.00",,5000.00,true,Pay Bill Online,254712345678 - JANE WANJIKU,,FCC#Tithes',
    'QJK1AAAA02,11-10-2026 09:20:44,11-10-2026 09:20:44,Pay Bill from 2547******78 - PETER OTIENO Acc. FCC#Offerings,Completed,500.00,,5500.00,true,Pay Bill Online,2547******78 - PETER OTIENO,,FCC#Offerings',
    'QJK1AAAA03,11-10-2026 10:01:00,11-10-2026 10:01:00,Merchant charge,Completed,,30.00,5470.00,true,Charge,,,',
    'QJK1AAAA04,11-10-2026 10:05:00,11-10-2026 10:05:00,Pay Bill from 254722000111 - MARY ATIENO Acc. FCC#Missions,Failed,200.00,,5470.00,true,Pay Bill Online,254722000111 - MARY ATIENO,,FCC#Missions',
    'QJK1AAAA02,11-10-2026 09:20:44,11-10-2026 09:20:44,duplicate line,Completed,500.00,,5970.00,true,Pay Bill Online,,,FCC#Offerings',
    'QJK1AAAA05,12/10/2026 18:00,,Pay Bill from 254733444555 - JOHN KAMAU Acc. fcc#building,Completed,2500,,8470.00,true,Pay Bill Online,,,',
  ].join('\n');

  it('keeps completed payments in and totals them', () => {
    const s = parseStatement(parseCsv(csv));
    expect(s.payments.map((p) => p.code)).toEqual(['QJK1AAAA01', 'QJK1AAAA02', 'QJK1AAAA05']);
    expect(s.totalCents).toBe(100000 + 50000 + 250000);
    expect(s.firstDate).toBe('2026-10-11');
    expect(s.lastDate).toBe('2026-10-12');
  });

  it('reads payer, phone and account reference', () => {
    const [jane, peter, john] = parseStatement(parseCsv(csv)).payments;
    expect(jane).toMatchObject({ phone: '254712345678', name: 'JANE WANJIKU', accountRef: 'FCC#Tithes', date: '2026-10-11', time: '09:15' });
    expect(peter).toMatchObject({ phone: '2547******78', name: 'PETER OTIENO' });
    // No Other Party or A/C column: taken from Details
    expect(john).toMatchObject({ phone: '254733444555', name: 'JOHN KAMAU', accountRef: 'fcc#building', amountCents: 250000 });
  });

  it('explains every payment it leaves out', () => {
    const s = parseStatement(parseCsv(csv));
    expect(s.skipped).toEqual([
      { line: 8, reason: 'Not completed (Failed).' },
      { line: 9, reason: 'QJK1AAAA02 appears twice in this file.' },
    ]);
  });

  it('says so when the file is not a statement', () => {
    const s = parseStatement(parseCsv('Name,Phone\nJane,0712'));
    expect(s.payments).toEqual([]);
    expect(s.skipped[0]!.reason).toMatch(/does not look like a Paybill statement/);
  });

  it('reads dates day-first, ISO, and Excel numbers', () => {
    expect(parseStatementDate('05/11/2026 08:30:00')).toEqual({ date: '2026-11-05', time: '08:30' });
    expect(parseStatementDate('2026-11-05 8:30')).toEqual({ date: '2026-11-05', time: '08:30' });
    expect(parseStatementDate(46331)).toEqual({ date: '2026-11-05', time: '00:00' });
    expect(parseStatementDate('13/13/2026')).toBeNull();
  });
});

describe('matching payments to people', () => {
  const people = [
    { id: 'jane', fullName: 'Jane Wanjiku', phone: '+254712345678' },
    { id: 'peter', fullName: 'Peter Otieno', phone: '+254711000078' },
    { id: 'peter2', fullName: 'Peter Mwangi', phone: '+254799000078' },
    { id: 'john', fullName: 'John Kamau', phone: null },
    { id: 'john2', fullName: 'John Kamau Njoroge', phone: null },
  ];

  it('is certain about a full phone number', () => {
    const c = matchPayment({ phone: '254712345678', name: 'JANE W' }, people);
    expect(c[0]).toEqual({ personId: 'jane', score: 100, reason: 'Same phone number' });
    expect(suggestedMatch(c)?.personId).toBe('jane');
    expect(matchPayment({ phone: '0712345678', name: '' }, people)[0]?.personId).toBe('jane');
  });

  it('uses masked digits together with the name', () => {
    const c = matchPayment({ phone: '2547******78', name: 'PETER OTIENO' }, people);
    expect(c[0]).toMatchObject({ personId: 'peter', score: 90 });
    expect(c[1]).toMatchObject({ personId: 'peter2', score: 60 });
    expect(suggestedMatch(c)?.personId).toBe('peter');
  });

  it('does not guess between two people with the same name', () => {
    const c = matchPayment({ phone: '', name: 'JOHN KAMAU' }, people);
    expect(c.map((x) => x.personId)).toEqual(['john', 'john2']);
    expect(suggestedMatch(c)).toBeNull();
  });

  it('suggests nobody from masked digits alone', () => {
    expect(suggestedMatch(matchPayment({ phone: '2547******78', name: 'UNKNOWN PAYER' }, people))).toBeNull();
  });

  it('compares names word by word', () => {
    expect(nameSimilarity('JANE WANJIKU', 'Jane Wanjiku')).toBe(1);
    expect(nameSimilarity('WANJIKU JANE', 'Jane Wanjiku Mwangi')).toBe(1);
    expect(nameSimilarity('JANE ACHIENG', 'Jane Wanjiku')).toBe(0.5);
    expect(phoneMatcher('25')).toBeNull();
  });
});

describe('parseMpesaMessage', () => {
  it('reads the Paybill notification', () => {
    const m = parseMpesaMessage('QJK3ABCD12 Confirmed. Ksh1,500.00 received from JOHN KAMAU 254712345678 on 31/10/26 at 10:15 AM. Account Number FCC#Tithes. New Utility balance is Ksh20,000.00');
    expect(m).toEqual({ code: 'QJK3ABCD12', amountCents: 150000, date: '2026-10-31', name: 'JOHN KAMAU', phone: '254712345678', accountRef: 'FCC#Tithes' });
  });
  it("reads the giver's own message", () => {
    const m = parseMpesaMessage('QJK3ABCD13 Confirmed. Ksh500.00 sent to FREEDOM CHURCH NAIROBI for account BUILDING on 1/11/26 at 9:02 AM New M-PESA balance is Ksh1,000.00.');
    expect(m.code).toBe('QJK3ABCD13');
    expect(m.amountCents).toBe(50000);
    expect(m.date).toBe('2026-11-01');
    expect(m.accountRef).toBe('BUILDING');
    expect(m.name).toBe('');
  });
  it('leaves what it cannot read empty', () => {
    expect(parseMpesaMessage('hello')).toEqual({ code: null, amountCents: null, date: null, name: '', phone: '', accountRef: '' });
  });
});

describe('other giving', () => {
  it('names and finds kinds of other giving', () => {
    expect(tidyFundName('  building   fund ')).toBe('Building Fund');
    expect(otherFundIdFor('Building Fund')).toBe('other_building_fund');
    expect(fundNamed('missions', [{ id: 'other_mission', name: 'Mission' }])?.id).toBe('other_mission');
    expect(otherGivingFromReference('FCC#BUILDING')).toBe('Building');
    expect(otherGivingFromReference('0712345678')).toBeNull();
  });
});
