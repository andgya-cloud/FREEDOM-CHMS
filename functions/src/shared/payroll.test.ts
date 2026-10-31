import { describe, expect, it } from 'vitest';
import { loanItemsFor, p9For, payLine, payrollCsv, preparePayroll, returnCsv, taxBeforeRelief, type PayrollStaff, type RunHistory } from './payroll';

const staff = (over: Partial<PayrollStaff> = {}): PayrollStaff => ({
  id: 's1', name: 'Ronald Awili', staffNo: 'ADIA-001', jobTitle: 'Trainer', kraPin: 'A001', nssfNo: 'N1', shifNo: 'S1',
  paymentDetails: 'M-Pesa 0700000000', basicCents: 4000000, allowances: [{ name: 'House', amountCents: 1000000 }], deductions: [], active: true, ...over,
});

describe('payroll', () => {
  it('taxes a month by the PAYE bands', () => {
    expect(taxBeforeRelief(2400000)).toBe(240000);
    expect(taxBeforeRelief(4487500)).toBe(824585);
    expect(taxBeforeRelief(0)).toBe(0);
  });

  it('works out a KES 50,000 salary step by step', () => {
    const l = payLine(staff());
    expect(l).toMatchObject({
      grossCents: 5000000, nssfCents: 300000, shifCents: 137500, housingCents: 75000, taxableCents: 4487500,
      taxBeforeReliefCents: 824585, reliefCents: 240000, payeCents: 584585, netCents: 3902915,
      employerNssfCents: 300000, employerHousingCents: 75000,
    });
  });

  it('applies the SHIF minimum, the NSSF ceiling and never a negative PAYE', () => {
    const low = payLine(staff({ basicCents: 1000000, allowances: [] }));
    expect(low).toMatchObject({ nssfCents: 60000, shifCents: 30000, housingCents: 15000, payeCents: 0, netCents: 895000 });
    expect(payLine(staff({ basicCents: 10000000, allowances: [] })).nssfCents).toBe(432000);
  });

  it('takes loans and advances after tax', () => {
    const l = payLine(staff({ deductions: [{ name: 'Salary advance', amountCents: 500000 }] }));
    expect(l.payeCents).toBe(584585);
    expect(l.netCents).toBe(3402915);
  });

  it('pays only active staff, in name order, with totals and a CSV', () => {
    const run = preparePayroll([staff({ id: 'b', name: 'Doreen' }), staff({ id: 'a', name: 'Daniel' }), staff({ id: 'c', name: 'Gone', active: false })]);
    expect(run.lines.map((l) => l.name)).toEqual(['Daniel', 'Doreen']);
    expect(run.totals).toMatchObject({ staff: 2, grossCents: 10000000, netCents: 7805830, employerCostCents: 10750000 });
    expect(payrollCsv('2026-10', run.lines).split('\n')[1]).toContain('Daniel,A001,N1,S1,50000.00,3000.00,1375.00,750.00,5845.85,0.00,39029.15');
  });

  it('adds one-off pay and takes days not worked before tax', () => {
    const l = payLine(staff(), undefined, { oneOff: [{ name: 'Bonus', amountCents: 1000000 }], unpaid: [{ name: '2 days not worked', amountCents: 400000 }] });
    expect(l.grossCents).toBe(5600000);
    expect(l.nssfCents).toBe(336000);
  });

  it('repays a loan in instalments until its balance is cleared', () => {
    const s = staff({ loans: [{ id: 'L1', name: 'School fees loan', principalCents: 2500000, instalmentCents: 1000000, startMonth: '2026-01' }] });
    const run = (month: string, amountCents: number, status = 'approved'): RunHistory =>
      ({ month, status, lines: [{ staffId: 's1', deductions: [{ name: 'School fees loan', amountCents, loanId: 'L1' }] }] });
    expect(loanItemsFor(s, '2025-12', [])).toEqual([]);
    expect(loanItemsFor(s, '2026-01', [])[0]!.amountCents).toBe(1000000);
    expect(loanItemsFor(s, '2026-03', [run('2026-01', 1000000), run('2026-02', 1000000)])[0]!.amountCents).toBe(500000);
    expect(loanItemsFor(s, '2026-04', [run('2026-01', 1000000), run('2026-02', 1000000), run('2026-03', 500000)])).toEqual([]);
    // A draft run does not count, nor does a later month.
    expect(loanItemsFor(s, '2026-02', [run('2026-01', 1000000, 'draft'), run('2026-05', 1000000)])[0]!.amountCents).toBe(1000000);
    const line = preparePayroll([s], undefined, { month: '2026-01', runs: [] }).lines[0]!;
    expect(line.netCents).toBe(3902915 - 1000000);
  });

  it('writes the four monthly returns and a P9 for the year', () => {
    const { lines } = preparePayroll([staff({ idNo: '12345678' })]);
    expect(returnCsv('nssf', '2026-01', lines).split('\n')[1]).toBe('2026-01,ADIA-001,Ronald Awili,12345678,A001,N1,50000.00,3000.00,3000.00,6000.00');
    expect(returnCsv('paye', '2026-01', lines).split('\n')[1]).toContain('5845.85');
    expect(returnCsv('shif', '2026-01', lines)).toContain('1375.00');
    expect(returnCsv('housing', '2026-01', lines)).toContain('750.00,750.00,1500.00');
    const runs = [{ month: '2026-01', status: 'approved', lines }, { month: '2026-02', status: 'approved', lines }, { month: '2026-03', status: 'draft', lines }, { month: '2025-12', status: 'approved', lines }];
    const p9 = p9For('s1', '2026', runs);
    expect(p9.rows.map((r) => r.month)).toEqual(['2026-01', '2026-02']);
    expect(p9.totals).toMatchObject({ grossCents: 10000000, payeCents: 1169170, benefitsCents: 2000000 });
  });
});
