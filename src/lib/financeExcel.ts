import writeXlsxFile from 'write-excel-file';
import { finLabel, periodEnd, potLabel, type FinReport, type FinRow } from '../../functions/src/shared/finance';
import { REPORT_PREPARED_BY } from '../../functions/src/shared/pettyReport';
import { POWERED_BY } from '../../functions/src/shared/poweredBy';

type Cell = { value: string | number | Date | null; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold'; indent?: number } | null;
const text = (value: string | null | undefined): Cell => ({ value: value ?? '', type: String });
const bold = (value: string): Cell => ({ value, fontWeight: 'bold' });
const kes = (cents: number, b = false): Cell => ({ value: cents / 100, type: Number, format: '#,##0.00;(#,##0.00)', ...(b ? { fontWeight: 'bold' as const } : {}) });
const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' as const }));
const day = (d: string): Cell => ({ value: new Date(`${d}T12:00:00Z`), type: Date, format: 'dd mmm yyyy' });

/** The financial report as Excel (Andy, 2026-11-08): each statement on its own sheet, amounts as numbers. */
export async function financeReportWorkbook(orgName: string, rep: FinReport, approvedBy: string): Promise<File> {
  const title: Cell[] = [bold(`${orgName} · Financial report · ${rep.name}`)];
  const foot: Cell[] = [text(POWERED_BY)];
  const now = rep.year ? rep.period : 'This month';
  const before = rep.year ? String(+rep.period - 1) : 'Last month';
  const ieHead = head(rep.year ? ['', `${now} (KES)`, `${before} (KES)`] : ['', `${now} (KES)`, `${before} (KES)`, 'Same month last year (KES)']);
  const ie = (r: Pick<FinRow, 'label' | 'cents' | 'beforeCents' | 'lastYearCents'> & { indent?: boolean }, b = false): Cell[] =>
    [{ value: r.label, ...(b ? { fontWeight: 'bold' as const } : {}), ...(r.indent ? { indent: 2 } : {}) }, kes(r.cents, b), kes(r.beforeCents, b), ...(rep.year ? [] : [kes(r.lastYearCents, b)])];

  const summary: Cell[][] = [title, [],
    [bold('Income (KES)'), kes(rep.totalIncome.cents)],
    [bold('Running costs (KES)'), kes(rep.totalExpenses.cents)],
    [bold(rep.surplus.cents >= 0 ? 'Surplus (KES)' : 'Deficit (KES)'), kes(rep.surplus.cents)],
    [bold('Cash at the start (KES)'), kes(rep.cash.openingCents)],
    [bold('Cash at the end (KES)'), kes(rep.cash.closingCents)],
    [], [bold('At a glance')], ...rep.summary.map((s) => [text(s)]),
    [], [bold('Checks')], ...rep.checks.map((c) => [text(`${c.ok ? '✓' : '✗'} ${c.text}`)]),
    [], [bold('Prepared by'), text(`${REPORT_PREPARED_BY.name} (${REPORT_PREPARED_BY.role})`), text('Signature:'), text('Date:')],
    [bold('Approved by'), text(approvedBy), text('Signature:'), text('Date:')],
    [], foot];
  const income: Cell[][] = [title, [], ieHead, [bold('INCOME')], ...rep.income.map((r) => ie(r)), ie({ label: 'Total income', ...rep.totalIncome }, true),
    [], [bold('EXPENDITURE')], ...rep.expenses.map((r) => ie(r)), ie({ label: 'Total expenditure', ...rep.totalExpenses }, true),
    [], ie({ label: rep.surplus.cents >= 0 ? 'Surplus for the period' : 'Deficit for the period', ...rep.surplus }, true),
    ...(rep.capital.length ? [[], [bold('Not counted as running costs (see Cash flow)')], ...rep.capital.map((r) => ie(r))] : []),
    [], foot];
  const bs = rep.balanceSheet;
  const row = (label: string, cents: number, indent?: boolean, b = false): Cell[] => [{ value: label, ...(indent ? { indent: 2 } : {}), ...(b ? { fontWeight: 'bold' as const } : {}) }, kes(cents, b)];
  const balance: Cell[][] = [title, [text(`As at ${periodEnd(rep.period).split('-').reverse().join('/')}`)], [], head(['', 'KES']),
    [bold('WHAT WE OWN (ASSETS)')], ...bs.assets.map((a) => row(a.label, a.cents, a.indent)), row('Total assets', bs.totalAssets, false, true),
    [], [bold('WHAT WE OWE (LIABILITIES)')], ...bs.liabilities.map((a) => row(a.label, a.cents, a.indent)), row('Total liabilities', bs.totalLiabilities, false, true),
    [], row('NET ASSETS (ACCUMULATED FUND)', bs.netAssets, false, true),
    ...(bs.restrictedCents ? [row('Held for set purposes (# pots)', bs.restrictedCents, true), row('General fund', bs.generalCents, true)] : []), [], foot];
  const potsSheet: Cell[][] = [title, [], head(['Purpose', 'At the start (KES)', 'Given (KES)', 'Spent (KES)', 'Held at the end (KES)']),
    ...rep.pots.map((x) => [text(`#${x.name} · ${potLabel(x.name)}`), kes(x.openingCents), kes(x.inCents), kes(x.outCents), kes(x.closingCents)] as Cell[]), [], foot];
  const flow: Cell[][] = [title, [], head(['', 'KES']), ...rep.cashFlow.map((c) => row(c.label, c.cents, c.indent, c.strong)), [], foot];
  const recon: Cell[][] = [title, [], head(['Account', 'Opening (KES)', 'Money in (KES)', 'Money out (KES)', 'Should be (KES)', 'Statement balance (KES)', 'Difference (KES)', 'Lines']),
    ...rep.accounts.map((a) => [text(a.account), kes(a.openingCents), kes(a.inCents), kes(a.outCents), kes(a.closingCents), kes(a.statementCents), kes(a.statementCents - a.closingCents), { value: a.lines, type: Number }] as Cell[]),
    ...(rep.petty ? [[text('Petty cash'), kes(rep.petty.openingCents), kes(rep.petty.inCents), kes(rep.petty.outCents), kes(rep.petty.openingCents + rep.petty.inCents - rep.petty.outCents), kes(rep.petty.closingCents), kes(0), null] as Cell[]] : []),
    [], foot];
  const budget: Cell[][] = [title, [], head(['Category', 'Budget (KES)', 'Actual (KES)', 'Over / under (KES)', 'Used']),
    ...rep.budget.map((b) => [text(b.label), kes(b.budgetCents), kes(b.actualCents), kes(b.diffCents), { value: b.used, type: Number, format: '0%' }] as Cell[]), [], foot];
  const lines: Cell[][] = [title, [], head(['Date', 'Account', 'Description', 'Reference', 'Category', 'Money in (KES)', 'Money out (KES)', 'Balance (KES)', 'Confirmed']),
    ...rep.lines.map((l) => [day(l.d), text(l.account), text(l.t), text(l.r), text(finLabel(l.c)), l.i ? kes(l.i) : null, l.o ? kes(l.o) : null, kes(l.b), text(l.s ? 'Yes' : 'Not yet')] as Cell[]),
    [], foot];

  const mt = rep.match;
  const dailySheet: Cell[][] = mt ? [title, [], head(['Typed on', 'Money', 'What it was', 'Account', 'Category', 'Amount (KES)', 'On the statement']),
    ...mt.matched.map((x) => [day(x.entry.date), text(x.entry.dir === 'in' ? 'In' : 'Out'), text(x.entry.text), text(x.entry.account), text(finLabel(x.entry.category)), kes(x.entry.cents), text(`Yes, ${x.line.d.split('-').reverse().join('/')}`)] as Cell[]),
    ...mt.typedMissing.map((e) => [day(e.date), text(e.dir === 'in' ? 'In' : 'Out'), text(e.text), text(e.account), text(finLabel(e.category)), kes(e.cents), bold('Not found')] as Cell[]),
    [], [bold('Petty cash top-ups found leaving the bank'), text(`${mt.topupsMatched} of ${mt.topupsMatched + mt.topupsMissing.length}`)],
    ...mt.topupsMissing.map((t) => [text('Not found'), day(t.date), null, null, null, kes(t.cents)] as Cell[]),
    [bold('Statement lines nobody typed'), { value: mt.untyped.count, type: Number }],
    [], foot] : [];
  const sheets = ['Summary', 'Income & Expenditure', 'Balance sheet', 'Cash flow', 'Reconciliation', ...(rep.pots.length ? ['Set purposes'] : []), ...(rep.budget.length ? ['Budget vs actual'] : []), ...(mt ? ['Daily vs bank'] : []), 'Lines'];
  const data = [summary, income, balance, flow, recon, ...(rep.pots.length ? [potsSheet] : []), ...(rep.budget.length ? [budget] : []), ...(mt ? [dailySheet] : []), lines];
  const widths = [[36, 22, 18, 18], [40, 18, 18, 22], [42, 18], [42, 18], [30, 16, 16, 16, 16, 20, 16, 8], ...(rep.pots.length ? [[36, 18, 16, 16, 20]] : []), ...(rep.budget.length ? [[38, 16, 16, 18, 8]] : []), ...(mt ? [[13, 8, 36, 24, 28, 15, 18]] : []), [13, 24, 50, 18, 30, 15, 15, 15, 10]];
  const blob = await writeXlsxFile(data as never, { sheets, columns: widths.map((ws) => ws.map((width) => ({ width }))) } as never) as unknown as Blob;
  return new File([blob], `${orgName.replace(/[^A-Za-z0-9]+/g, '-')}-financial-report-${rep.period}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
