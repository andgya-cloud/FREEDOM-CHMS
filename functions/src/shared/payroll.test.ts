import { describe, expect, it } from 'vitest';
import { payLine, payrollCsv, preparePayroll, taxBeforeRelief, type PayrollStaff } from './payroll';

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
});
