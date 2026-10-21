/**
 * ADIA payroll: monthly pay with Kenya's statutory deductions. All money is in cents (KES × 100).
 *
 * Order of the calculation (Kenya, since the Tax Laws (Amendment) Act 2024):
 *   gross = basic + allowances
 *   NSSF (employee) = rate × gross, up to the upper earnings limit
 *   SHIF = rate × gross, at least the minimum
 *   Housing Levy (employee) = rate × gross
 *   taxable pay = gross − NSSF − SHIF − Housing Levy
 *   PAYE = tax on taxable pay by the monthly bands, less personal relief, never below zero
 *   net = gross − NSSF − SHIF − Housing Levy − PAYE − other deductions (loans, advances)
 * The employer also pays the same NSSF and Housing Levy; they are shown but never taken from the employee.
 */

export interface PayItem { name: string; amountCents: number }

/** The rates a board member can update when the law changes. */
export interface PayrollRates {
  nssfRate: number;
  nssfUpperLimitCents: number;
  shifRate: number;
  shifMinimumCents: number;
  housingRate: number;
  personalReliefCents: number;
}

/** The rates in force from February 2025. Check them with the accountant when the law changes. */
export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  nssfRate: 0.06,
  nssfUpperLimitCents: 7200000,
  shifRate: 0.0275,
  shifMinimumCents: 30000,
  housingRate: 0.015,
  personalReliefCents: 240000,
};

/** Monthly PAYE bands: [width of the band in cents, rate]. The last band has no upper limit. */
export const PAYE_BANDS: readonly [number, number][] = [
  [2400000, 0.1],
  [833300, 0.25],
  [46766700, 0.3],
  [30000000, 0.325],
  [Infinity, 0.35],
];

export interface PayrollStaff {
  id: string;
  name: string;
  staffNo: string;
  jobTitle: string;
  kraPin: string;
  nssfNo: string;
  shifNo: string;
  /** Where the pay goes: bank and account, or M-Pesa number. */
  paymentDetails: string;
  basicCents: number;
  allowances: PayItem[];
  /** Loans, salary advances and other deductions taken after tax. */
  deductions: PayItem[];
  active: boolean;
}

export interface PayLine {
  staffId: string;
  name: string;
  staffNo: string;
  jobTitle: string;
  kraPin: string;
  nssfNo: string;
  shifNo: string;
  paymentDetails: string;
  basicCents: number;
  allowances: PayItem[];
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  housingCents: number;
  taxableCents: number;
  taxBeforeReliefCents: number;
  reliefCents: number;
  payeCents: number;
  deductions: PayItem[];
  totalDeductionsCents: number;
  netCents: number;
  employerNssfCents: number;
  employerHousingCents: number;
}

export interface PayrollTotals {
  staff: number;
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  housingCents: number;
  payeCents: number;
  otherDeductionsCents: number;
  netCents: number;
  employerNssfCents: number;
  employerHousingCents: number;
  /** What ADIA pays out in all: gross pay plus the employer's NSSF and Housing Levy. */
  employerCostCents: number;
}

const sum = (items: readonly PayItem[]) => items.reduce((t, i) => t + i.amountCents, 0);
const round = (n: number) => Math.round(n);

/** Income tax on a month's taxable pay, before personal relief. */
export function taxBeforeRelief(taxableCents: number): number {
  let left = Math.max(0, taxableCents);
  let tax = 0;
  for (const [width, rate] of PAYE_BANDS) {
    const inBand = Math.min(left, width);
    tax += inBand * rate;
    left -= inBand;
    if (left <= 0) break;
  }
  return round(tax);
}

/** One staff member's pay for a month. */
export function payLine(s: PayrollStaff, rates: PayrollRates = DEFAULT_PAYROLL_RATES): PayLine {
  const grossCents = s.basicCents + sum(s.allowances);
  const nssfCents = round(rates.nssfRate * Math.min(grossCents, rates.nssfUpperLimitCents));
  const shifCents = grossCents > 0 ? Math.max(round(rates.shifRate * grossCents), rates.shifMinimumCents) : 0;
  const housingCents = round(rates.housingRate * grossCents);
  const taxableCents = Math.max(0, grossCents - nssfCents - shifCents - housingCents);
  const taxBeforeReliefCents = taxBeforeRelief(taxableCents);
  const reliefCents = Math.min(rates.personalReliefCents, taxBeforeReliefCents);
  const payeCents = taxBeforeReliefCents - reliefCents;
  const totalDeductionsCents = nssfCents + shifCents + housingCents + payeCents + sum(s.deductions);
  return {
    staffId: s.id, name: s.name, staffNo: s.staffNo, jobTitle: s.jobTitle, kraPin: s.kraPin, nssfNo: s.nssfNo, shifNo: s.shifNo,
    paymentDetails: s.paymentDetails, basicCents: s.basicCents, allowances: s.allowances,
    grossCents, nssfCents, shifCents, housingCents, taxableCents, taxBeforeReliefCents, reliefCents, payeCents,
    deductions: s.deductions, totalDeductionsCents, netCents: grossCents - totalDeductionsCents,
    employerNssfCents: nssfCents, employerHousingCents: housingCents,
  };
}

export function payrollTotals(lines: readonly PayLine[]): PayrollTotals {
  const t = (f: (l: PayLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const grossCents = t((l) => l.grossCents);
  const employerNssfCents = t((l) => l.employerNssfCents);
  const employerHousingCents = t((l) => l.employerHousingCents);
  return {
    staff: lines.length, grossCents, nssfCents: t((l) => l.nssfCents), shifCents: t((l) => l.shifCents),
    housingCents: t((l) => l.housingCents), payeCents: t((l) => l.payeCents), otherDeductionsCents: t((l) => sum(l.deductions)),
    netCents: t((l) => l.netCents), employerNssfCents, employerHousingCents,
    employerCostCents: grossCents + employerNssfCents + employerHousingCents,
  };
}

/** A month's pay for every active staff member, in name order. */
export function preparePayroll(staff: readonly PayrollStaff[], rates: PayrollRates = DEFAULT_PAYROLL_RATES): { lines: PayLine[]; totals: PayrollTotals } {
  const lines = staff.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)).map((s) => payLine(s, rates));
  return { lines, totals: payrollTotals(lines) };
}

/** The pay run's rows as CSV, for the bank or the accountant. */
export function payrollCsv(month: string, lines: readonly PayLine[]): string {
  const k = (c: number) => (c / 100).toFixed(2);
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ['Month', 'Staff no', 'Name', 'KRA PIN', 'NSSF no', 'SHIF no', 'Gross', 'NSSF', 'SHIF', 'Housing Levy', 'PAYE', 'Other deductions', 'Net pay', 'Pay to'];
  const rows = lines.map((l) => [month, l.staffNo, l.name, l.kraPin, l.nssfNo, l.shifNo, k(l.grossCents), k(l.nssfCents), k(l.shifCents),
    k(l.housingCents), k(l.payeCents), k(sum(l.deductions)), k(l.netCents), l.paymentDetails].map((v) => q(String(v))).join(','));
  return [head.join(','), ...rows].join('\n');
}
