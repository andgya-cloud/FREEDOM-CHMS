import { describe, expect, it } from 'vitest';
import {
  autoCategory, budgetWarning, dailyBook, freeToSpend, potBalances, potFor, potOf, financialReport, finPeriods, matchDaily, readyMonth, typedCategory, learnKey, parseDateText, parseMoneyText, parseStatementRows, pdfItemsToRows, sheetCells,
  type BankStatement, type DailyBankEntry, type PdfTextItem, type StatementCell,
} from './finance';

/** A PDF-like row: each text at an x position, 40 points wide. */
const row = (...cells: [number, string][]): StatementCell[] => cells.map(([x, text]) => ({ text, x0: x, x1: x + 40 }));

describe('reading dates and money', () => {
  it('reads Kenyan day-first dates in the usual shapes', () => {
    expect(parseDateText('05/10/2026')).toBe('2026-10-05');
    expect(parseDateText('5-10-26')).toBe('2026-10-05');
    expect(parseDateText('2026-10-05 14:22:01')).toBe('2026-10-05');
    expect(parseDateText('05 Oct 2026')).toBe('2026-10-05');
    expect(parseDateText('05-OCT-26')).toBe('2026-10-05');
    expect(parseDateText('31/02/2026')).toBeNull();
    expect(parseDateText('Opening balance')).toBeNull();
  });
  it('reads money and refuses reference numbers', () => {
    expect(parseMoneyText('1,234.50')).toBe(123450);
    expect(parseMoneyText('(1,234.50)')).toBe(-123450);
    expect(parseMoneyText('-500.00')).toBe(-50000);
    expect(parseMoneyText('2,000.00 DR')).toBe(-200000);
    expect(parseMoneyText('2,000.00CR')).toBe(200000);
    expect(parseMoneyText('KES 10.00')).toBe(1000);
    expect(parseMoneyText('0123456789')).toBeNull();
    expect(parseMoneyText('12,34.00')).toBeNull();
  });
});

describe('reading a bank statement', () => {
  it('reads a Family Bank style PDF table with debit, credit and balance columns', () => {
    const rows = [
      row([20, 'FAMILY BANK']),
      row([20, 'Date'], [80, 'Description'], [200, 'Reference'], [300, 'Debit'], [360, 'Credit'], [420, 'Balance']),
      row([20, '01/10/2026'], [80, 'Opening Balance'], [420, '50,000.00']),
      row([20, '02/10/2026'], [80, 'MPESA TITHE JOHN'], [200, 'FT123'], [360, '10,000.00'], [420, '60,000.00']),
      row([80, 'KAMAU WANJIRU']),
      row([20, '03/10/2026'], [80, 'KPLC PREPAID TOKEN'], [200, 'FT124'], [300, '2,500.00'], [420, '57,500.00']),
      row([20, '04/10/2026'], [80, 'LEDGER FEE'], [300, '150.00'], [420, '57,350.00']),
      row([20, 'Total'], [300, '2,650.00'], [360, '10,000.00']),
    ];
    const s = parseStatementRows(rows);
    expect(s.openingCents).toBe(5_000_000);
    expect(s.lines).toEqual([
      { d: '2026-10-02', t: 'MPESA TITHE JOHN KAMAU WANJIRU', r: 'FT123', i: 1_000_000, o: 0, b: 6_000_000 },
      { d: '2026-10-03', t: 'KPLC PREPAID TOKEN', r: 'FT124', i: 0, o: 250_000, b: 5_750_000 },
      { d: '2026-10-04', t: 'LEDGER FEE', r: '', i: 0, o: 15_000, b: 5_735_000 },
    ]);
    expect(s.closingCents).toBe(5_735_000);
    expect(s.balanceBreaks).toBe(0);
    expect(s.from).toBe('2026-10-02');
  });

  it('reads an M-Pesa statement printed newest first with minus amounts withdrawn', () => {
    const rows = sheetCells([
      ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance'],
      ['QJK3', '2026-10-03 10:00:00', 'Pay Bill to KPLC', 'Completed', '', '-1,000.00', '8,000.00'],
      ['QJK2', '2026-10-02 09:00:00', 'Funds received from MARY', 'Completed', '5,000.00', '', '9,000.00'],
      ['QJK1', '2026-10-01 08:00:00', 'Funds received from PETER', 'Completed', '4,000.00', '', '4,000.00'],
    ]);
    const s = parseStatementRows(rows);
    expect(s.lines.map((l) => [l.d, l.i, l.o, l.b, l.r])).toEqual([
      ['2026-10-01', 400_000, 0, 400_000, 'QJK1'],
      ['2026-10-02', 500_000, 0, 900_000, 'QJK2'],
      ['2026-10-03', 0, 100_000, 800_000, 'QJK3'],
    ]);
    expect(s.openingCents).toBe(0);
  });

  it('works out money in or out from the balance when there is no header', () => {
    const s = parseStatementRows([
      row([20, '01/10/2026'], [80, 'BALANCE B/F'], [420, '1,000.00']),
      row([20, '02/10/2026'], [80, 'CHEQUE 0012'], [360, '300.00'], [420, '700.00']),
      row([20, '03/10/2026'], [80, 'DEPOSIT'], [360, '500.00'], [420, '1,200.00']),
    ]);
    expect(s.lines.map((l) => [l.i, l.o])).toEqual([[0, 30_000], [50_000, 0]]);
  });

  it('counts a break in the balance', () => {
    const s = parseStatementRows([
      row([20, 'Date'], [80, 'Details'], [300, 'Debit'], [360, 'Credit'], [420, 'Balance']),
      row([20, '02/10/2026'], [80, 'A'], [360, '100.00'], [420, '100.00']),
      row([20, '03/10/2026'], [80, 'B'], [360, '100.00'], [420, '900.00']),
    ]);
    expect(s.balanceBreaks).toBe(1);
  });
});

describe('sorting lines', () => {
  it('uses a remembered choice first, then a clear rule, then a guess to confirm', () => {
    const line = { t: 'MPESA C2B 0722000111 JANE DOE', r: '', i: 50_000, o: 0 };
    expect(autoCategory(line, {}, 'church')).toEqual({ c: 'giving', s: false });
    expect(autoCategory(line, {}, 'school')).toEqual({ c: 'fees', s: false });
    expect(autoCategory(line, { [learnKey(line.t, 'in')]: 'tithes' }, 'church')).toEqual({ c: 'tithes', s: true });
    expect(autoCategory({ t: 'KPLC PREPAID', r: '', i: 0, o: 100 }, {}, 'church')).toEqual({ c: 'utilities', s: true });
    expect(autoCategory({ t: 'EXCISE DUTY', r: '', i: 0, o: 100 }, {}, 'hope')).toEqual({ c: 'bankCharges', s: true });
    expect(autoCategory({ t: 'TRANSFER TO PETTY CASH', r: '', i: 0, o: 100 }, {}, 'hope')).toEqual({ c: 'toPetty', s: true });
    expect(autoCategory({ t: 'NOVEMBER SALARIES', r: '', i: 0, o: 100 }, {}, 'school').c).toBe('salaries');
    expect(autoCategory({ t: 'SOMETHING', r: '', i: 0, o: 100 }, {}, 'school')).toEqual({ c: 'otherExpense', s: false });
  });
  it('remembers by the words that stay the same', () => {
    expect(learnKey('SALARY OCT 2026 REF 9988', 'out')).toBe(learnKey('SALARY NOV 2026 REF 1234', 'out').replace('NOV', 'OCT'));
    expect(learnKey('KPLC TOKEN 12345', 'out')).toBe(learnKey('KPLC TOKEN 99999', 'out'));
  });
});

describe('the financial report', () => {
  const bank: BankStatement = {
    id: 's1', account: 'Family Bank', accountKind: 'bank', fileName: 'oct.pdf', from: '2026-09-01', to: '2026-10-31', openingCents: 100_000,
    lines: [
      { d: '2026-09-05', t: 'TITHE', r: '', i: 200_000, o: 0, b: 300_000, c: 'tithes', s: true },
      { d: '2026-10-02', t: 'TITHE', r: '', i: 300_000, o: 0, b: 600_000, c: 'tithes', s: true },
      { d: '2026-10-03', t: 'KPLC', r: '', i: 0, o: 50_000, b: 550_000, c: 'utilities', s: true },
      { d: '2026-10-04', t: 'TO PETTY', r: '', i: 0, o: 100_000, b: 450_000, c: 'toPetty', s: true },
      { d: '2026-10-05', t: 'CHAIRS', r: '', i: 0, o: 40_000, b: 410_000, c: 'equipment', s: true },
      { d: '2026-10-06', t: 'MPESA', r: '', i: 10_000, o: 0, b: 420_000, c: 'giving', s: false },
    ],
    closingCents: 420_000,
  };
  const petty = { openingCents: 0, inCents: 100_000, outCents: 60_000, closingCents: 40_000, categories: [{ category: 'Hospitality', cents: 60_000 }] };
  const none = { openingCents: 0, inCents: 0, outCents: 0, closingCents: 0, categories: [] };

  it('builds income and expenditure, cash flow, balance sheet and checks that tie together', () => {
    const r = financialReport('2026-10', {
      statements: [bank],
      owned: [{ id: 'o1', side: 'own', kind: 'Vehicles', name: 'Van', cents: 1_000_000, asOf: '2026-01-01' }, { id: 'o2', side: 'owe', kind: 'Loans', name: 'Sacco', cents: 200_000, asOf: '2026-01-01' }],
      budget: { utilities: 40_000 },
      petty: { now: petty, before: none, lastYear: none },
      givingRecordedCents: 310_000,
      today: '2026-11-08',
    });
    expect(r.totalIncome).toEqual({ cents: 310_000, beforeCents: 200_000, lastYearCents: 0 });
    expect(r.totalExpenses.cents).toBe(50_000 + 60_000);
    expect(r.surplus.cents).toBe(200_000);
    expect(r.expenses.map((e) => [e.label, e.cents])).toEqual([['Electricity and water', 50_000], ['Food and refreshments', 60_000]]);
    expect(r.pettyOutCents).toBe(60_000);
    expect(r.capital[0]!.cents).toBe(40_000);
    expect(r.accounts[0]).toMatchObject({ openingCents: 300_000, inCents: 310_000, outCents: 190_000, statementCents: 420_000, breaks: 0, missingMonths: [] });
    // Cash: bank 300,000 + petty 0 at the start; bank 420,000 + petty 40,000 at the end.
    expect(r.cash).toEqual({ openingCents: 300_000, closingCents: 460_000 });
    expect(r.cashFlow.find((c) => c.label === 'Cash at the end')!.cents).toBe(460_000);
    expect(r.cashFlow.some((c) => c.label.startsWith('Moves between'))).toBe(false);
    expect(r.balanceSheet.totalAssets).toBe(460_000 + 1_000_000);
    expect(r.balanceSheet.netAssets).toBe(1_460_000 - 200_000);
    expect(r.budget[0]).toMatchObject({ id: 'utilities', budgetCents: 40_000, actualCents: 50_000, diffCents: -10_000 });
    expect(r.needsYou).toBe(1);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.text)).toEqual(['1 line still needs a category confirmed.', 'Over budget: Electricity and water used 125% (500.00 of 400.00).']);
    expect(r.summary[0]).toContain('up 55% on last month');
  });

  it('flags a month with no statement and a year runs month by month', () => {
    const aug: BankStatement = { ...bank, id: 's0', from: '2026-08-01', to: '2026-08-31', openingCents: 300_000, closingCents: 300_000, lines: [] };
    const oct: BankStatement = { ...bank, from: '2026-10-01', to: '2026-10-31', lines: bank.lines.filter((l) => l.d.startsWith('2026-10')) };
    const r = financialReport('2026', { statements: [aug, oct], owned: [], budget: {}, today: '2026-11-08' });
    expect(r.checks.some((c) => c.text.includes('September 2026'))).toBe(true);
    expect(r.trend.length).toBe(10);
    expect(r.trend[9]).toMatchObject({ inCents: 310_000, outCents: 50_000 });
  });

  it('lists months then years, newest first', () => {
    expect(finPeriods([bank])).toEqual(['2026-10', '2026-09', '2026']);
  });
});

describe('daily accounts', () => {
  const st: BankStatement = {
    id: 's', account: 'Family Bank', accountKind: 'bank', fileName: 'x', from: '2026-10-01', to: '2026-10-31', openingCents: 0, closingCents: 0,
    lines: [
      { d: '2026-10-05', t: 'DEPOSIT', r: '', i: 50_000, o: 0, b: 50_000, c: 'giving', s: false },
      { d: '2026-10-06', t: 'TRF', r: '', i: 0, o: 20_000, b: 30_000, c: 'toPetty', s: true },
      { d: '2026-10-07', t: 'CHG', r: '', i: 0, o: 100, b: 29_900, c: 'bankCharges', s: true },
    ],
  };
  const entries: DailyBankEntry[] = [
    { id: 'e1', date: '2026-10-04', dir: 'in', cents: 50_000, account: 'Family Bank', text: 'Sunday offering banked', category: 'offerings' },
    { id: 'e2', date: '2026-10-20', dir: 'out', cents: 9_999, account: 'Family Bank', text: 'Cheque to plumber', category: 'repairs' },
  ];

  it('keeps a daily cash book with the cash count difference', () => {
    const rows = dailyBook([
      { day: '2026-10-06', creditCents: 20_000, debitCents: 0, balanceCents: 20_000, kind: 'topup' },
      { day: '2026-10-08', creditCents: 0, debitCents: 5_000, balanceCents: 15_000, kind: 'request' },
    ], entries, [{ date: '2026-10-08', countedCents: 14_500, name: 'Daniel' }], '2026-10-09');
    expect(rows.map((r) => r.date)).toEqual(['2026-10-09', '2026-10-08', '2026-10-06', '2026-10-04']);
    expect(rows[1]).toMatchObject({ openingCents: 20_000, outCents: 5_000, closingCents: 15_000, vouchers: 1, countedCents: 14_500, diffCents: -500 });
    expect(rows[0]).toMatchObject({ openingCents: 15_000, closingCents: 15_000 });
    expect(rows[3]).toMatchObject({ bankInCents: 50_000, bankEntries: 1 });
  });

  it('matches typed bank money and top-ups against the statement', () => {
    const m = matchDaily('2026-10', [st], entries, [{ date: '2026-10-06', cents: 20_000 }, { date: '2026-10-15', cents: 7_000 }]);
    expect(m.matched.map((x) => x.entry.id)).toEqual(['e1']);
    expect(m.typedMissing.map((x) => x.id)).toEqual(['e2']);
    expect(m.topupsMatched).toBe(1);
    expect(m.topupsMissing).toEqual([{ date: '2026-10-15', cents: 7_000 }]);
    expect(m.untyped).toEqual({ count: 1, inCents: 0, outCents: 100 });
    const r = financialReport('2026-10', { statements: [st], owned: [], budget: {}, daily: { entries, topups: [{ date: '2026-10-06', cents: 20_000 }] } });
    expect(r.checks.some((c) => !c.ok && c.text.startsWith('1 of 2 bank amounts'))).toBe(true);
    expect(r.checks.some((c) => c.ok && c.text.includes('top-ups are found'))).toBe(true);
  });

  it('gives a statement line the category typed on the day', () => {
    const taken = new Set<string>();
    expect(typedCategory(st.lines[0]!, 'Family Bank', entries, taken)).toBe('offerings');
    expect(typedCategory(st.lines[0]!, 'Family Bank', entries, taken)).toBeNull();
  });

  it('offers the latest ended month as ready', () => {
    expect(readyMonth([st], '2026-11-09')).toBe('2026-10');
    expect(readyMonth([st], '2026-10-20')).toBeNull();
  });
});

describe('purpose pots and free to spend', () => {
  it('reads a pot from "#code" and keeps ordinary giving out of pots', () => {
    expect(potOf('MPESA C2B FCC#PAINTING JOHN')).toBe('PAINTING');
    expect(potOf('Paybill 222118 #building-fund')).toBe('BUILDING FUND');
    expect(potOf('FCC#TITHE')).toBe('');
    expect(potOf('KPLC TOKEN')).toBe('');
    expect(potFor({ t: 'FCC#PAINTING', r: '', f: '' })).toBe('');
  });

  it('tracks a pot and splits net assets into held for a purpose and general', () => {
    const st: BankStatement = {
      id: 's', account: 'Family Bank', accountKind: 'bank', fileName: 'x', from: '2026-09-01', to: '2026-10-31', openingCents: 0, closingCents: 0,
      lines: [
        { d: '2026-09-10', t: 'FCC#PAINTING A', r: '', i: 100_000, o: 0, b: 100_000, c: 'fundraising', s: true },
        { d: '2026-10-10', t: 'FCC#PAINTING B', r: '', i: 50_000, o: 0, b: 150_000, c: 'fundraising', s: true },
        { d: '2026-10-12', t: 'PAINT SHOP', r: '', i: 0, o: 30_000, b: 120_000, c: 'repairs', s: true, f: 'PAINTING' },
        { d: '2026-10-13', t: 'TITHE', r: '', i: 80_000, o: 0, b: 200_000, c: 'tithes', s: true },
      ],
    };
    const r = financialReport('2026-10', { statements: [st], owned: [], budget: {} });
    expect(r.pots).toEqual([{ name: 'PAINTING', openingCents: 100_000, inCents: 50_000, outCents: 30_000, closingCents: 120_000 }]);
    expect(r.balanceSheet).toMatchObject({ netAssets: 200_000, restrictedCents: 120_000, generalCents: 80_000 });
    expect(potBalances([st])).toEqual([{ name: 'PAINTING', cents: 120_000 }]);
    const money = (c: number) => (c / 100).toFixed(0);
    expect(budgetWarning('repairs', 1000, 700, 50, money)).toBe(null);
    expect(budgetWarning('repairs', 1000, 700, 100, money)?.level).toBe('near');
    expect(budgetWarning('repairs', 1000, 700, 400, money)?.level).toBe('over');
  });

  it('works out what is free to spend, counting the weekly giving still to come', () => {
    const st: BankStatement = {
      id: 's', account: 'Family Bank', accountKind: 'bank', fileName: 'x', from: '2026-10-01', to: '2026-11-08', openingCents: 0, closingCents: 0,
      lines: [
        ...Array.from({ length: 8 }, (_, n) => ({ d: `2026-${n < 4 ? '10' : '11'}-${String(n < 4 ? 4 + n * 7 : 1 + (n - 4) * 2).padStart(2, '0')}`, t: 'OFFERING', r: '', i: 70_000, o: 0, b: 70_000 * (n + 1), c: 'offerings', s: true })),
      ],
    };
    const f = freeToSpend({
      statements: [st], entries: [{ id: 'e', date: '2026-11-09', dir: 'out', cents: 10_000, account: 'Family Bank', text: '', category: 'rent' }],
      pettyNowCents: 5_000, waitingCents: 2_000, heldCents: 100_000, budget: { rent: 30_000 }, spentThisMonth: { rent: 10_000 }, today: '2026-11-09',
    });
    expect(f.bankCents).toBe(560_000 - 10_000);
    expect(f.cashCents).toBe(555_000);
    expect(f.freeCents).toBe(555_000 - 100_000 - 2_000);
    expect(f.weeklyGivingCents).toBe(70_000);
    expect(f.budgetLeftCents).toBe(20_000);
    expect(f.expectedCents).toBe(Math.round(70_000 * (21 / 7)));
    expect(f.afterMonthCents).toBe(f.freeCents + f.expectedCents - 20_000);
  });
});

describe('Family Bank statement layout (Andy, 2026-11-09)', () => {
  // Positions as Family Bank prints them: header over three lines, dates and amounts wrapping onto the next line,
  // the branch code "034" after the balance. Names are made up.
  const page = (y0: number, rows: { txt: string[]; amt: string; out: boolean; bal: string }[]): PdfTextItem[] => {
    const it: PdfTextItem[] = [
      { text: '37134', x: 7.2, y: 783.6, w: 25 }, { text: 'UTAWALA BRANCH', x: 407.9, y: 771.1, w: 93 }, { text: 'ACCOUNT NAME:', x: 7.2, y: 648.3, w: 77 },
      { text: 'TRANSACTI', x: 7.7, y: 539.1, w: 52 }, { text: 'CLEARING', x: 72.4, y: 539.1, w: 47 }, { text: 'CHQ', x: 277.6, y: 539.4, w: 22 }, { text: 'TOTAL', x: 445.4, y: 539.4, w: 33 }, { text: 'TXN', x: 512, y: 537, w: 20 },
      { text: 'PARTICULARS', x: 162.3, y: 533.4, w: 72 }, { text: 'IN', x: 327.7, y: 533.4, w: 10 }, { text: 'OUT', x: 376.1, y: 533.4, w: 21 },
      { text: 'ON DATE', x: 13.4, y: 528.4, w: 40 }, { text: 'DATE', x: 84.9, y: 528.4, w: 24 }, { text: 'NO', x: 282.6, y: 527.5, w: 15 }, { text: 'BALANCE', x: 439, y: 527.5, w: 49 },
    ];
    let y = y0;
    for (const r of rows) {
      it.push({ text: '02-JAN-', x: 9.7, y, w: 33 }, { text: '2026', x: 7.2, y: y - 15.7, w: 20 }, { text: '31-DEC-', x: 71, y, w: 35 }, { text: '2025', x: 71, y: y - 15.7, w: 20 });
      r.txt.forEach((t, n) => it.push({ text: t, x: 134.1, y: y - n * 17.3, w: 100 }));
      it.push(r.out ? { text: r.amt, x: 371.9, y, w: 25 } : { text: r.amt, x: 318, y: y - 17.3, w: 39 }, { text: r.bal, x: 438.5, y, w: 44.5 }, { text: '034', x: 514.5, y: y + 0.9, w: 15 });
      y -= 17.3 * (r.txt.length + 1);
    }
    return it;
  };
  it('joins the wrapped lines and reads money in and out by column', () => {
    const rows = [
      ...pdfItemsToRows([...page(486.4, [
        { txt: ['Paybill Credit From Paybill:', '222118, Ref :', 'UA10L2J9L7, Sender:', 'JANE DOE , Narration:', 'FCC TITHE', '034000012730 FREEDOM', 'IN CHRIST CHURCH'], amt: '1,000.00', out: false, bal: '38,133.50' },
        { txt: ['Mobile Alert Transaction', 'Alert Charge', '034UC2B253650159', '034000012730 FREEDOM', 'IN CHRIST CHURCH'], amt: '10.00', out: true, bal: '38,123.50' },
        { txt: ['IB Account to Mobile', 'Money Transfer', '034000012730'], amt: '15,000.0', out: true, bal: '23,123.50' },
      ]), { text: '0', x: 371.9, y: 486.4 - 17.3 * 14 - 15.7, w: 6 }, { text: '*OPENING BALANCE*', x: 134.1, y: 503, w: 95 }, { text: '37,133.50', x: 433.7, y: 502.8, w: 44.5 }]), [],
      ...pdfItemsToRows(page(486.4, [{ txt: ['Excise Duty Transaction', 'Alert Charge', '034UC2B253650159'], amt: '2.00', out: true, bal: '23,121.50' }])), [],
    ];
    const r = parseStatementRows(rows);
    expect(r.balanceBreaks).toBe(0);
    expect(r.openingCents).toBe(3_713_350);
    expect(r.lines.map((l) => [l.d, l.t, l.r, l.i, l.o, l.b])).toEqual([
      ['2026-01-02', 'FCC TITHE · JANE DOE · Paybill 222118', 'UA10L2J9L7', 100_000, 0, 3_813_350],
      ['2026-01-02', 'Mobile Alert Transaction Alert Charge 034UC2B253650159', '', 0, 1_000, 3_812_350],
      ['2026-01-02', 'IB Account to Mobile Money Transfer 034000012730', '', 0, 1_500_000, 2_312_350],
      ['2026-01-02', 'Excise Duty Transaction Alert Charge 034UC2B253650159', '', 0, 200, 2_312_150],
    ]);
    expect(learnKey(r.lines[0]!.t, 'in')).toBe('in:FCC TITHE');
  });
});
