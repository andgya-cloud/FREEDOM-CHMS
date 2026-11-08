import { describe, expect, it } from 'vitest';
import {
  autoCategory, financialReport, finPeriods, learnKey, parseDateText, parseMoneyText, parseStatementRows, sheetCells,
  type BankStatement, type StatementCell,
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
    expect(r.expenses.map((e) => e.label)).toEqual(['Electricity and water', 'Petty cash spending', 'Hospitality']);
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
    expect(r.checks.filter((c) => !c.ok).map((c) => c.text)).toEqual(['1 line still needs a category confirmed.']);
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
