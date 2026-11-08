import { formatMoney } from '../../functions/src/shared/giving';
import { drawFooter, drawLetterhead, GOLD, GOLD_SOFT, GREEN, GREY, INK, letterheadFor, NAVY, RED } from '../../functions/src/shared/pettyVoucher';
import { finChange, periodEnd, type FinReport, type FinRow } from '../../functions/src/shared/finance';
import { REPORT_PREPARED_BY } from '../../functions/src/shared/pettyReport';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';
import { logoImage } from './pettyPdf';

type RGB = [number, number, number];
const madeAt = () => new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
/** Amounts in tables: 1,234.00, and (1,234.00) below zero, as accountants write them. */
export const num = (c: number) => { const s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${s})` : s; };
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

interface TRow { cells: string[]; bold?: boolean; head?: boolean; indent?: boolean; tone?: RGB }

/**
 * The monthly or yearly financial report (Andy, 2026-11-08, 4A 8A): summary boxes, a plain-words summary,
 * a chart, the Income and Expenditure statement, the Balance Sheet, the Cash Flow, the Bank Reconciliation,
 * Budget vs Actual, the checks and the sign-off. "Powered by Insight-IQ" at the bottom.
 */
export async function financeReportPdf(org: Organization, rep: FinReport, approvedBy: string): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const bottom = H - 22;
  const cur = org.currency || 'KES';
  const m = (c: number) => formatMoney(c, cur);
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), rep.year ? 'Annual financial report' : 'Monthly financial report', rep.name);
  const space = (need: number) => { if (y + need > bottom) { pdf.addPage(); y = 20; } };

  // Summary boxes.
  const boxes: [string, string, RGB][] = [
    ['Income', m(rep.totalIncome.cents), GREEN], ['Running costs', m(rep.totalExpenses.cents), RED],
    [rep.surplus.cents >= 0 ? 'Surplus' : 'Deficit', m(Math.abs(rep.surplus.cents)), rep.surplus.cents >= 0 ? GREEN : RED], ['Cash at the end', m(rep.cash.closingCents), NAVY],
  ];
  const bw = (w - 28 - 12) / 4;
  boxes.forEach(([k, v, colour], i) => {
    const x = 14 + i * (bw + 4);
    pdf.setFillColor(...GOLD_SOFT); pdf.roundedRect(x, y, bw, 19, 2, 2, 'F');
    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GREY); pdf.text(k.toUpperCase(), x + 3, y + 6);
    pdf.setFontSize(11.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...colour); pdf.text(v, x + 3, y + 14.5);
  });
  y += 25;

  /** A heading, kept on the same page as what follows it (`need` millimetres, a whole page at most). */
  const section = (title: string, need = 16) => {
    y += 3; space(Math.min(need, 190) + 9);
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY); pdf.text(title, 14, y);
    pdf.setDrawColor(...GOLD_SOFT); pdf.setLineWidth(0.6); pdf.line(14, y + 1.6, w - 14, y + 1.6); y += 6;
  };
  const para = (text: string, size = 8.5, colour: RGB = INK) => {
    pdf.setFontSize(size); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...colour);
    const lines = pdf.splitTextToSize(text, w - 28) as string[];
    space(lines.length * 4.2 + 2); pdf.text(lines, 14, y + 1); y += lines.length * 4.2 + 2;
  };
  type Col = { label: string; x: number; right?: boolean; width: number };
  const table = (cols: Col[], rows: TRow[]) => {
    const headRow = () => {
      pdf.setFillColor(...NAVY); pdf.rect(14, y, w - 28, 7.5, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
      cols.forEach((c) => pdf.text(c.label, c.x, y + 5, c.right ? { align: 'right' } : undefined));
      y += 7.5; pdf.setFont('helvetica', 'normal');
    };
    const need = 7.5 + rows.length * 6.5;
    space(need < 80 ? need : 16); headRow();
    rows.forEach((row, i) => {
      if (y + 6.5 > bottom) { pdf.addPage(); y = 20; headRow(); }
      if (row.bold) { pdf.setFillColor(...GOLD_SOFT); pdf.rect(14, y, w - 28, 6.5, 'F'); }
      else if (row.head) { pdf.setFillColor(236, 239, 245); pdf.rect(14, y, w - 28, 6.5, 'F'); }
      else if (i % 2) { pdf.setFillColor(248, 249, 251); pdf.rect(14, y, w - 28, 6.5, 'F'); }
      pdf.setFontSize(row.indent ? 6.8 : 7.3); pdf.setFont('helvetica', row.bold || row.head ? 'bold' : 'normal');
      row.cells.forEach((cell, n) => {
        const c = cols[n]!;
        pdf.setTextColor(...(n === 0 ? (row.head ? NAVY : row.indent ? GREY : INK) : row.tone ?? INK));
        const x = n === 0 && row.indent ? c.x + 5 : c.x;
        const t = (pdf.splitTextToSize(cell, c.width - (n === 0 && row.indent ? 5 : 0)) as string[])[0] ?? '';
        pdf.text(t, x, y + 4.5, c.right ? { align: 'right' } : undefined);
      });
      y += 6.5;
    });
    pdf.setFont('helvetica', 'normal'); y += 4;
  };

  // At a glance.
  section('At a glance');
  para(rep.summary.join(' '));

  // Chart: income and spending, month by month.
  if (rep.trend.length > 1) {
    space(58);
    const cx = 30, cw = w - 14 - cx, ch = 40, top = y + 4;
    const max = Math.max(1, ...rep.trend.flatMap((t) => [t.inCents, t.outCents]));
    const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
    pdf.setFontSize(6.5); pdf.setTextColor(...GREY); pdf.setDrawColor(225, 228, 235); pdf.setLineWidth(0.2);
    for (let k = 0; k <= 4; k++) {
      const yy = top + ch - (ch * k) / 4;
      pdf.line(cx, yy, cx + cw, yy);
      const v = (nice * k) / 4 / 100;
      pdf.text(v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)), cx - 2, yy + 1, { align: 'right' });
    }
    const slot = cw / rep.trend.length; const bar = Math.min(7, slot * 0.34);
    rep.trend.forEach((t, i) => {
      const x = cx + i * slot + slot / 2;
      const hi = (t.inCents / nice) * ch; const ho = (t.outCents / nice) * ch;
      pdf.setFillColor(...GREEN); pdf.rect(x - bar - 0.4, top + ch - hi, bar, hi, 'F');
      pdf.setFillColor(...RED); pdf.rect(x + 0.4, top + ch - ho, bar, ho, 'F');
      pdf.setTextColor(...(t.period === rep.period ? NAVY : GREY)); pdf.setFont('helvetica', t.period === rep.period ? 'bold' : 'normal');
      pdf.text(t.label, x, top + ch + 4.5, { align: 'center' });
    });
    pdf.setFont('helvetica', 'normal');
    y = top + ch + 9;
    pdf.setFillColor(...GREEN); pdf.rect(cx, y - 2, 4, 2.4, 'F'); pdf.setTextColor(...GREY); pdf.text('Income', cx + 5.5, y);
    pdf.setFillColor(...RED); pdf.rect(cx + 28, y - 2, 4, 2.4, 'F'); pdf.text('Running costs', cx + 33.5, y);
    y += 5;
  }

  // 1. Income and Expenditure.
  const nowL = rep.year ? rep.period : 'This month';
  const befL = rep.year ? String(+rep.period - 1) : 'Last month';
  const cols: Col[] = rep.year
    ? [{ label: '', x: 17, width: 92 }, { label: `${nowL} (${cur})`, x: 140, right: true, width: 32 }, { label: `${befL} (${cur})`, x: 172, right: true, width: 30 }, { label: 'Change', x: w - 17, right: true, width: 16 }]
    : [{ label: '', x: 17, width: 80 }, { label: `${nowL} (${cur})`, x: 124, right: true, width: 28 }, { label: `${befL} (${cur})`, x: 151, right: true, width: 26 }, { label: `Last year (${cur})`, x: 178, right: true, width: 26 }, { label: 'Change', x: w - 17, right: true, width: 14 }];
  const line = (r: Pick<FinRow, 'label' | 'cents' | 'beforeCents' | 'lastYearCents'> & { indent?: boolean }, opts: Partial<TRow> = {}): TRow => ({
    cells: rep.year ? [r.label, num(r.cents), num(r.beforeCents), finChange(r.cents, r.beforeCents)] : [r.label, num(r.cents), num(r.beforeCents), num(r.lastYearCents), finChange(r.cents, r.beforeCents)],
    indent: r.indent, ...opts,
  });
  const headRow = (label: string): TRow => ({ cells: [label], head: true });
  section(`1. Income and Expenditure statement · ${rep.name}`, 40);
  table(cols, [
    headRow('INCOME'),
    ...(rep.income.length ? rep.income.map((r) => line(r)) : [{ cells: ['No income in this period'] }]),
    line({ label: 'Total income', ...rep.totalIncome }, { bold: true }),
    headRow('EXPENDITURE'),
    ...(rep.expenses.length ? rep.expenses.map((r) => line(r)) : [{ cells: ['No running costs in this period'] }]),
    line({ label: 'Total expenditure', ...rep.totalExpenses }, { bold: true }),
    line({ label: rep.surplus.cents >= 0 ? 'SURPLUS for the period' : 'DEFICIT for the period', ...rep.surplus }, { bold: true, tone: rep.surplus.cents >= 0 ? GREEN : RED }),
  ]);
  if (rep.capital.length) para(`Not counted as running costs: ${rep.capital.map((c) => `${c.label.toLowerCase()} ${m(c.cents)}`).join(', ')} (see the Cash Flow).`, 7.5, GREY);

  // Where the money went, as bars.
  const top = rep.expenses.filter((r) => !r.indent && r.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 8);
  if (top.length > 1) {
    section('Where the money went', top.length * 6.5);
    const barX = 70; const barW = w - 14 - barX - 36;
    top.forEach((r) => {
      space(7);
      const share = rep.totalExpenses.cents ? r.cents / rep.totalExpenses.cents : 0;
      pdf.setFontSize(7.5); pdf.setTextColor(...INK); pdf.text((pdf.splitTextToSize(r.label, 54) as string[])[0] ?? '', 14, y + 3.2);
      pdf.setFillColor(238, 240, 245); pdf.rect(barX, y, barW, 4, 'F');
      pdf.setFillColor(...NAVY); pdf.rect(barX, y, Math.max(0.6, share * barW), 4, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.text(`${Math.round(share * 100)}%`, barX + barW + 3, y + 3.2);
      pdf.setFont('helvetica', 'normal'); pdf.text(num(r.cents), w - 14, y + 3.2, { align: 'right' });
      y += 6.5;
    });
    y += 3;
  }

  // 2. Balance Sheet.
  const bs = rep.balanceSheet;
  const bsCols: Col[] = [{ label: '', x: 17, width: 120 }, { label: `${cur}`, x: w - 17, right: true, width: 40 }];
  section(`2. Balance Sheet as at ${day(periodEnd(rep.period))}`, 7.5 + (bs.assets.length + bs.liabilities.length + 6) * 6.5);
  table(bsCols, [
    headRow('WHAT WE OWN (ASSETS)'),
    ...bs.assets.map((a) => ({ cells: [a.label, num(a.cents)], indent: a.indent })),
    { cells: ['Total assets', num(bs.totalAssets)], bold: true },
    headRow('WHAT WE OWE (LIABILITIES)'),
    ...(bs.liabilities.length ? bs.liabilities.map((a) => ({ cells: [a.label, num(a.cents)], indent: a.indent })) : [{ cells: ['Nothing recorded', num(0)] }]),
    { cells: ['Total liabilities', num(bs.totalLiabilities)], bold: true },
    { cells: ['NET ASSETS (ACCUMULATED FUND)', num(bs.netAssets)], bold: true, tone: bs.netAssets >= 0 ? NAVY : RED },
  ]);

  // 3. Cash Flow.
  section('3. Cash Flow statement', 7.5 + rep.cashFlow.length * 6.5);
  table(bsCols, rep.cashFlow.map((c) => ({ cells: [c.label, num(c.cents)], bold: c.strong && (c.label.startsWith('Cash at') || c.label === 'Change in cash'), head: c.strong && !c.label.startsWith('Cash at') && c.label !== 'Change in cash', indent: c.indent })));

  // 4. Bank Reconciliation.
  section('4. Bank Reconciliation', 7.5 + (rep.accounts.length + 1) * 6.5);
  const rc: Col[] = [{ label: 'Account', x: 17, width: 44 }, { label: 'Opening', x: 82, right: true, width: 22 }, { label: 'Money in', x: 105, right: true, width: 22 },
    { label: 'Money out', x: 128, right: true, width: 22 }, { label: 'Should be', x: 151, right: true, width: 22 }, { label: 'Statement', x: 174, right: true, width: 22 }, { label: 'Difference', x: w - 17, right: true, width: 16 }];
  table(rc, [
    ...rep.accounts.map((a) => ({ cells: [a.account, num(a.openingCents), num(a.inCents), num(a.outCents), num(a.closingCents), num(a.statementCents), a.closingCents === a.statementCents ? 'nil' : num(a.statementCents - a.closingCents)],
      tone: a.closingCents === a.statementCents ? undefined : RED })),
    ...(rep.petty ? [{ cells: ['Petty cash', num(rep.petty.openingCents), num(rep.petty.inCents), num(rep.petty.outCents), num(rep.petty.openingCents + rep.petty.inCents - rep.petty.outCents), num(rep.petty.closingCents), 'nil'] }] : []),
  ]);

  // 5. Budget vs Actual.
  if (rep.budget.length) {
    section(`5. Budget vs Actual${rep.year ? ' (budget for the months so far)' : ''}`, 7.5 + rep.budget.length * 6.5);
    table([{ label: 'Category', x: 17, width: 70 }, { label: 'Budget', x: 120, right: true, width: 28 }, { label: 'Actual', x: 148, right: true, width: 28 }, { label: 'Over / under', x: 176, right: true, width: 28 }, { label: 'Used', x: w - 17, right: true, width: 14 }],
      rep.budget.map((b) => ({ cells: [b.label, num(b.budgetCents), num(b.actualCents), num(b.diffCents), `${Math.round(b.used * 100)}%`], tone: b.diffCents < 0 ? RED : undefined })));
  }

  // Checks.
  section('Checks', 14);
  rep.checks.forEach((c) => {
    const lines = pdf.splitTextToSize(c.text, w - 36) as string[];
    space(lines.length * 4 + 3);
    pdf.setFillColor(...(c.ok ? GREEN : RED)); pdf.circle(16.5, y, 1.6, 'F');
    pdf.setFontSize(8.3); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(lines, 21, y + 1); y += lines.length * 4 + 2.5;
  });
  y += 3;

  // Sign-off (Andy 6A): prepared by the accountant, approved by Andrew Guya, Doreen Guya or Elias Omondi.
  section('Sign-off', 27);
  const sw = (w - 28 - 10) / 2;
  [{ role: `Prepared by · ${REPORT_PREPARED_BY.role}`, name: REPORT_PREPARED_BY.name }, { role: 'Approved by', name: approvedBy }].forEach((s, i) => {
    const x = 14 + i * (sw + 10);
    pdf.setFontSize(7); pdf.setTextColor(...GREY); pdf.text(s.role.toUpperCase(), x, y + 3);
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK); pdf.text(s.name, x, y + 9.5); pdf.setFont('helvetica', 'normal');
    pdf.setDrawColor(...GOLD); pdf.setLineWidth(0.25);
    pdf.line(x, y + 21, x + sw * 0.62, y + 21); pdf.line(x + sw * 0.68, y + 21, x + sw, y + 21);
    pdf.setFontSize(7); pdf.setTextColor(...GREY); pdf.text('Signature', x, y + 25); pdf.text('Date', x + sw * 0.68, y + 25);
  });
  y += 30;

  const pages = pdf.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    pdf.setPage(n);
    drawFooter(pdf, `${lh.name} · Financial report · ${rep.name} · Page ${n} of ${pages}`, madeAt());
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${org.name.replace(/[^A-Za-z0-9]+/g, '-')}-financial-report-${rep.period}.pdf`, { type: 'application/pdf' });
}
