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

export interface PayItem { name: string; amountCents: number; /** Set on a loan repayment, to keep the loan's balance. */ loanId?: string }

/** A loan or salary advance repaid in monthly instalments; its balance comes from the approved pay runs. */
export interface PayrollLoan { id: string; name: string; principalCents: number; instalmentCents: number; /** First month repaid, YYYY-MM. */ startMonth: string }

/** Amounts for one month only, entered on the pay run. */
export interface MonthAdjustment {
  /** Added to this month's pay, and taxed: bonus, overtime, arrears. */
  earnings: PayItem[];
  /** Taken off this month's pay before tax: days not worked. */
  unpaid: PayItem[];
}

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
  /** National ID number, needed on the NSSF, SHIF and Housing Levy returns. */
  idNo?: string;
  /** For sending the payslip by WhatsApp or email. */
  phone?: string;
  email?: string;
  /** Where the pay goes: bank and account, or M-Pesa number. */
  paymentDetails: string;
  basicCents: number;
  allowances: PayItem[];
  /** Deductions taken after tax every month (welfare, SACCO). */
  deductions: PayItem[];
  loans?: PayrollLoan[];
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
  idNo?: string;
  phone?: string;
  email?: string;
  paymentDetails: string;
  basicCents: number;
  allowances: PayItem[];
  /** This month only. Older pay runs do not have these. */
  oneOff?: PayItem[];
  unpaid?: PayItem[];
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

/** One staff member's pay for a month. `extra` holds this month's one-off amounts and loan instalments. */
export function payLine(s: PayrollStaff, rates: PayrollRates = DEFAULT_PAYROLL_RATES,
  extra: { oneOff?: PayItem[]; unpaid?: PayItem[]; loanItems?: PayItem[] } = {}): PayLine {
  const oneOff = extra.oneOff ?? [];
  const unpaid = extra.unpaid ?? [];
  const deductions = [...s.deductions, ...(extra.loanItems ?? [])];
  const grossCents = Math.max(0, s.basicCents + sum(s.allowances) + sum(oneOff) - sum(unpaid));
  const nssfCents = round(rates.nssfRate * Math.min(grossCents, rates.nssfUpperLimitCents));
  const shifCents = grossCents > 0 ? Math.max(round(rates.shifRate * grossCents), rates.shifMinimumCents) : 0;
  const housingCents = round(rates.housingRate * grossCents);
  const taxableCents = Math.max(0, grossCents - nssfCents - shifCents - housingCents);
  const taxBeforeReliefCents = taxBeforeRelief(taxableCents);
  const reliefCents = Math.min(rates.personalReliefCents, taxBeforeReliefCents);
  const payeCents = taxBeforeReliefCents - reliefCents;
  const totalDeductionsCents = nssfCents + shifCents + housingCents + payeCents + sum(deductions);
  return {
    staffId: s.id, name: s.name, staffNo: s.staffNo, jobTitle: s.jobTitle, kraPin: s.kraPin, nssfNo: s.nssfNo, shifNo: s.shifNo,
    idNo: s.idNo ?? '', phone: s.phone ?? '', email: s.email ?? '',
    paymentDetails: s.paymentDetails, basicCents: s.basicCents, allowances: s.allowances, oneOff, unpaid,
    grossCents, nssfCents, shifCents, housingCents, taxableCents, taxBeforeReliefCents, reliefCents, payeCents,
    deductions, totalDeductionsCents, netCents: grossCents - totalDeductionsCents,
    employerNssfCents: nssfCents, employerHousingCents: housingCents,
  };
}

/** The parts of a saved pay run that loan balances and pay history are worked out from. */
export interface RunHistory { month: string; status: string; lines: readonly Pick<PayLine, 'staffId' | 'deductions'>[] }

/** How much of a loan has been repaid in approved pay runs before `month` (all approved runs when month is omitted). */
export function loanRepaidCents(staffId: string, loanId: string, runs: readonly RunHistory[], month?: string): number {
  let paid = 0;
  for (const r of runs) {
    if (r.status !== 'approved' || (month && r.month >= month)) continue;
    for (const l of r.lines) if (l.staffId === staffId) for (const d of l.deductions) if (d.loanId === loanId) paid += d.amountCents;
  }
  return paid;
}

/** This month's instalment on each of a staff member's loans; the last one is only what is left. */
export function loanItemsFor(s: PayrollStaff, month: string, runs: readonly RunHistory[]): PayItem[] {
  const out: PayItem[] = [];
  for (const loan of s.loans ?? []) {
    if (loan.startMonth > month) continue;
    const left = loan.principalCents - loanRepaidCents(s.id, loan.id, runs, month);
    const amountCents = Math.min(loan.instalmentCents, left);
    if (amountCents > 0) out.push({ name: loan.name, amountCents, loanId: loan.id });
  }
  return out;
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

/** A month's pay for every active staff member, in name order, with loan instalments and this month's one-off amounts. */
export function preparePayroll(staff: readonly PayrollStaff[], rates: PayrollRates = DEFAULT_PAYROLL_RATES,
  month?: { month: string; runs: readonly RunHistory[]; adjustments?: Record<string, MonthAdjustment> }): { lines: PayLine[]; totals: PayrollTotals } {
  const lines = staff.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const adj = month?.adjustments?.[s.id];
    return payLine(s, rates, { oneOff: adj?.earnings ?? [], unpaid: adj?.unpaid ?? [], loanItems: month ? loanItemsFor(s, month.month, month.runs) : [] });
  });
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

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (head: string[], rows: (string | number)[][]) => [head, ...rows].map((r) => r.map((v) => csvCell(String(v))).join(',')).join('\n');
const k2 = (c: number) => (c / 100).toFixed(2);

/** The monthly returns for KRA, NSSF, SHIF and the Housing Levy, as CSV lists to enter or upload on each portal. */
export type ReturnKind = 'paye' | 'nssf' | 'shif' | 'housing';
export const RETURN_LABELS: Record<ReturnKind, string> = {
  paye: 'PAYE (KRA P10)', nssf: 'NSSF', shif: 'SHIF (SHA)', housing: 'Housing Levy',
};

export function returnCsv(kind: ReturnKind, month: string, lines: readonly PayLine[]): string {
  const cash = (l: PayLine) => sum(l.allowances) + sum(l.oneOff ?? []) - sum(l.unpaid ?? []);
  switch (kind) {
    case 'paye':
      return csv(['Month', 'KRA PIN', 'Name', 'Residential status', 'Type of employee', 'Basic salary', 'Allowances and other pay', 'Gross pay',
        'NSSF', 'SHIF', 'Housing Levy', 'Taxable pay', 'Tax charged', 'Personal relief', 'PAYE'],
      lines.map((l) => [month, l.kraPin, l.name, 'Resident', 'Primary Employee', k2(l.basicCents), k2(cash(l)), k2(l.grossCents),
        k2(l.nssfCents), k2(l.shifCents), k2(l.housingCents), k2(l.taxableCents), k2(l.taxBeforeReliefCents), k2(l.reliefCents), k2(l.payeCents)]));
    case 'nssf':
      return csv(['Month', 'Staff no', 'Name', 'ID number', 'KRA PIN', 'NSSF number', 'Gross pay', 'Employee contribution', 'Employer contribution', 'Total'],
        lines.map((l) => [month, l.staffNo, l.name, l.idNo ?? '', l.kraPin, l.nssfNo, k2(l.grossCents), k2(l.nssfCents), k2(l.employerNssfCents), k2(l.nssfCents + l.employerNssfCents)]));
    case 'shif':
      return csv(['Month', 'Name', 'ID number', 'SHIF number', 'Gross pay', 'SHIF contribution'],
        lines.map((l) => [month, l.name, l.idNo ?? '', l.shifNo, k2(l.grossCents), k2(l.shifCents)]));
    case 'housing':
      return csv(['Month', 'Name', 'ID number', 'KRA PIN', 'Gross pay', 'Employee levy', 'Employer levy', 'Total'],
        lines.map((l) => [month, l.name, l.idNo ?? '', l.kraPin, k2(l.grossCents), k2(l.housingCents), k2(l.employerHousingCents), k2(l.housingCents + l.employerHousingCents)]));
  }
}

/** One month's line on a P9 tax deduction card. */
export interface P9Row {
  month: string; basicCents: number; benefitsCents: number; grossCents: number; nssfCents: number; shifCents: number; housingCents: number;
  taxableCents: number; taxCents: number; reliefCents: number; payeCents: number;
}

/** A staff member's P9 for a year, from the approved pay runs: one row per month paid, and the year's totals. */
export function p9For(staffId: string, year: string, runs: readonly { month: string; status: string; lines: readonly PayLine[] }[]): { rows: P9Row[]; totals: P9Row } {
  const rows: P9Row[] = [];
  for (const r of [...runs].sort((a, b) => a.month.localeCompare(b.month))) {
    if (r.status !== 'approved' || !r.month.startsWith(`${year}-`)) continue;
    const l = r.lines.find((x) => x.staffId === staffId);
    if (!l) continue;
    rows.push({
      month: r.month, basicCents: l.basicCents, benefitsCents: l.grossCents - l.basicCents, grossCents: l.grossCents, nssfCents: l.nssfCents,
      shifCents: l.shifCents, housingCents: l.housingCents, taxableCents: l.taxableCents, taxCents: l.taxBeforeReliefCents,
      reliefCents: l.reliefCents, payeCents: l.payeCents,
    });
  }
  const t = (f: keyof Omit<P9Row, 'month'>) => rows.reduce((a, r) => a + r[f], 0);
  const totals: P9Row = {
    month: 'Total', basicCents: t('basicCents'), benefitsCents: t('benefitsCents'), grossCents: t('grossCents'), nssfCents: t('nssfCents'),
    shifCents: t('shifCents'), housingCents: t('housingCents'), taxableCents: t('taxableCents'), taxCents: t('taxCents'),
    reliefCents: t('reliefCents'), payeCents: t('payeCents'),
  };
  return { rows, totals };
}
