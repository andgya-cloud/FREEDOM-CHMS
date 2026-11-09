import { formatMoney } from '../../functions/src/shared/giving';
import {
  drawFooter, drawLetterhead, drawRequisition, GOLD_SOFT, GREEN, GREY, INK, letterheadFor, NAVY, RED,
  type PdfSignOff, type VoucherRequisition,
} from '../../functions/src/shared/pettyVoucher';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';
import { crestImage } from './payrollPdf';

const logos = new Map<string, Promise<string | null>>();
/** The organization's logo from /org as a data URL, for the PDF letterhead; ADIA's crest is shared with payroll. */
export function logoImage(file: string | null): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  if (file === 'adia-crest.png') return crestImage();
  if (!logos.has(file)) {
    logos.set(file, fetch(`/org/${file}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no logo'))))
      .then((b) => new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(b);
      }))
      .catch(() => { logos.delete(file); return null; }));
  }
  return logos.get(file)!;
}
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';

export type { PdfSignOff };
const madeAt = () => new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

/** The requisition (or, once approved, the payment voucher) as a PDF, made on this device. */
export async function requisitionPdf(org: Organization, r: VoucherRequisition, signOffs: PdfSignOff[], receiptCount: number): Promise<File> {
  const pdf = await newPdf('a4');
  const lh = letterheadFor(org);
  drawRequisition(pdf, lh, await logoImage(lh.crest), org.currency || 'KES', r, signOffs, receiptCount, madeAt());
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${r.number ?? 'Requisition'}${r.status === 'approved' ? '-approved' : ''}.pdf`, { type: 'application/pdf' });
}

export interface MonthReport {
  month: string; monthName: string; status: string;
  openingCents: number; inCents: number; outCents: number; closingCents: number;
  byCategory: { category: string; count: number; cents: number }[];
  requests: { number: string; date: string; requester: string; category: string; payee: string; cents: number; receipts: number }[];
  closedBy: { name: string; role: string; when: string }[];
  missingReceipts: number;
}

/**
 * The professional petty cash report (Andy, 2026-11-08) for a month or a year: summary, spending by
 * category with a bar chart and the change from the period before, the months of a year, every voucher,
 * money in, checks, and the sign-off (prepared by the accountant, approved by the chosen stakeholder).
 */
export async function pettyReportPdf(org: Organization, rep: import('../../functions/src/shared/pettyReport').PettyReport, approvedBy: string): Promise<File> {
  const { changeLabel, REPORT_PREPARED_BY } = await import('../../functions/src/shared/pettyReport');
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const bottom = H - 22;
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  const lh = letterheadFor(org);
  const year = rep.period.length === 4;
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), year ? 'Petty cash annual report' : 'Petty cash monthly report', rep.name);
  const space = (need: number) => { if (y + need > bottom) { pdf.addPage(); y = 20; } };

  // Summary boxes.
  const boxes: [string, string, [number, number, number]][] = [['Opening balance', m(rep.openingCents), INK], ['Money in', m(rep.inCents), GREEN], ['Money out', m(rep.outCents), RED], ['Closing balance', m(rep.closingCents), NAVY]];
  const bw = (w - 28 - 12) / 4;
  boxes.forEach(([k, v, colour], i) => {
    const x = 14 + i * (bw + 4);
    pdf.setFillColor(...GOLD_SOFT); pdf.roundedRect(x, y, bw, 19, 2, 2, 'F');
    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GREY); pdf.text(k.toUpperCase(), x + 3, y + 6);
    pdf.setFontSize(11.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...colour); pdf.text(v, x + 3, y + 14.5);
  });
  y += 24;
  pdf.setFontSize(8.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK);
  const said = `${rep.vouchers.length} voucher${rep.vouchers.length === 1 ? '' : 's'} paid, ${m(rep.outCents)} in total`
    + (rep.beforeOutCents ? ` (${changeLabel(rep.outCents, rep.beforeOutCents)} compared with ${rep.beforeName}, ${m(rep.beforeOutCents)})` : '') + `. ${rep.moneyIn.length} top-up${rep.moneyIn.length === 1 ? '' : 's'} brought in ${m(rep.inCents)}.`;
  pdf.text(pdf.splitTextToSize(said, w - 28) as string[], 14, y); y += 10;

  const section = (title: string) => {
    y += 3;
    space(18);
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY); pdf.text(title, 14, y);
    pdf.setDrawColor(...GOLD_SOFT); pdf.setLineWidth(0.6); pdf.line(14, y + 1.6, w - 14, y + 1.6); y += 6;
  };
  type Col = { label: string; x: number; right?: boolean; width: number };
  const table = (cols: Col[], rows: string[][], boldLast = false) => {
    const headRow = () => {
      pdf.setFillColor(...NAVY); pdf.rect(14, y, w - 28, 7.5, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold');
      cols.forEach((c) => pdf.text(c.label, c.x, y + 5, c.right ? { align: 'right' } : undefined));
      y += 7.5; pdf.setFont('helvetica', 'normal');
    };
    space(16); headRow();
    rows.forEach((row, i) => {
      if (y + 6.5 > bottom) { pdf.addPage(); y = 20; headRow(); }
      const last = boldLast && i === rows.length - 1;
      if (last) { pdf.setFillColor(...GOLD_SOFT); pdf.rect(14, y, w - 28, 6.5, 'F'); } else if (i % 2) { pdf.setFillColor(247, 248, 250); pdf.rect(14, y, w - 28, 6.5, 'F'); }
      pdf.setFontSize(7); pdf.setTextColor(...INK); pdf.setFont('helvetica', last ? 'bold' : 'normal');
      row.forEach((cell, n) => {
        const c = cols[n]!;
        const t = (pdf.splitTextToSize(cell, c.width) as string[])[0] ?? '';
        pdf.text(t, c.x, y + 4.5, c.right ? { align: 'right' } : undefined);
      });
      y += 6.5;
    });
    pdf.setFont('helvetica', 'normal'); y += 5;
  };

  // Spending by category, with bars.
  section('Spending by category');
  if (!rep.categories.length) { pdf.setFontSize(8.5); pdf.setTextColor(...GREY); pdf.text('Nothing was paid out in this period.', 14, y + 2); y += 8; }
  else {
    const max = Math.max(...rep.categories.map((c) => Math.max(c.cents, c.beforeCents)), 1);
    const barX = 62; const barW = w - 14 - barX - 34;
    rep.categories.forEach((c) => {
      space(9);
      pdf.setFontSize(7.5); pdf.setTextColor(...INK); pdf.text((pdf.splitTextToSize(c.category, 46) as string[])[0] ?? '', 14, y + 3.4);
      pdf.setFillColor(...NAVY); pdf.rect(barX, y, Math.max(0.6, (c.cents / max) * barW), 3.6, 'F');
      pdf.setFillColor(205, 210, 220); pdf.rect(barX, y + 4.2, Math.max(c.beforeCents ? 0.6 : 0, (c.beforeCents / max) * barW), 1.6, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.text(m(c.cents), w - 14, y + 3.4, { align: 'right' }); pdf.setFont('helvetica', 'normal');
      y += 8;
    });
    pdf.setFontSize(6.5); pdf.setTextColor(...GREY);
    pdf.setFillColor(...NAVY); pdf.rect(barX, y - 1.8, 4, 2, 'F'); pdf.text(rep.name, barX + 5.5, y);
    pdf.setFillColor(205, 210, 220); pdf.rect(barX + 50, y - 1.4, 4, 1.4, 'F'); pdf.text(rep.beforeName, barX + 55.5, y);
    y += 6;
    table([{ label: 'Category', x: 17, width: 70 }, { label: 'Vouchers', x: 105, right: true, width: 18 }, { label: 'Share', x: 125, right: true, width: 16 },
      { label: rep.beforeName.replace('January to December ', ''), x: 158, right: true, width: 30 }, { label: 'Change', x: 172, right: true, width: 13 }, { label: 'Amount', x: w - 17, right: true, width: 30 }],
    [...rep.categories.map((c) => [c.category, String(c.count), `${Math.round(c.share * 100)}%`, c.beforeCents ? m(c.beforeCents) : '–', changeLabel(c.cents, c.beforeCents), m(c.cents)]),
      ['Total', String(rep.vouchers.length), rep.outCents ? '100%' : '–', rep.beforeOutCents ? m(rep.beforeOutCents) : '–', changeLabel(rep.outCents, rep.beforeOutCents), m(rep.outCents)]], true);
  }

  if (year && rep.months.length) {
    section('Month by month');
    table([{ label: 'Month', x: 17, width: 40 }, { label: 'Vouchers', x: 74, right: true, width: 16 }, { label: 'Opening', x: 104, right: true, width: 28 }, { label: 'Money in', x: 134, right: true, width: 28 },
      { label: 'Money out', x: 164, right: true, width: 28 }, { label: 'Closing', x: w - 17, right: true, width: 28 }],
    [...rep.months.map((r) => [r.name, String(r.vouchers), m(r.openingCents), m(r.inCents), m(r.outCents), m(r.closingCents)]),
      ['Year', String(rep.vouchers.length), m(rep.openingCents), m(rep.inCents), m(rep.outCents), m(rep.closingCents)]], true);
  }

  section(`Vouchers paid (${rep.vouchers.length})`);
  if (rep.vouchers.length) {
    table([{ label: 'Voucher', x: 16, width: 19 }, { label: 'Date', x: 36, width: 16 }, { label: 'Paid to', x: 53, width: 28 }, { label: 'Category', x: 82, width: 25 },
      { label: 'M-Pesa', x: 108, width: 18 }, { label: 'Family Bank', x: 127, width: 18 }, { label: 'Approved by', x: 146, width: 30 }, { label: 'Amount', x: w - 16, right: true, width: 18 }],
    [...rep.vouchers.map((v) => [v.number + (v.past ? '*' : ''), v.date.split('-').reverse().join('/'), v.payee || v.requester, v.category, v.mpesaCode || '–', v.refNo || '–',
      v.approvedBy.replace(/Andrew Guya/g, 'A. Guya').replace(/Doreen (Mayaka|Guya)/g, 'D. Guya').replace(/Elias Omondi/g, 'E. Omondi'), m(v.cents)]),
      ['Total', '', '', '', '', '', '', m(rep.outCents)]], true);
    if (rep.pastRecords) { pdf.setFontSize(6.8); pdf.setTextColor(...GREY); pdf.text('* Past record, added from the earlier paper books.', 14, y - 2); y += 3; }
  }

  section(`Money in (${rep.moneyIn.length})`);
  if (rep.moneyIn.length) {
    table([{ label: 'Date', x: 17, width: 20 }, { label: 'Added by', x: 40, width: 40 }, { label: 'Note', x: 84, width: 80 }, { label: 'Amount', x: w - 17, right: true, width: 30 }],
      [...rep.moneyIn.map((f) => [f.date.split('-').reverse().join('/'), f.by, f.note || '–', m(f.cents)]), ['Total', '', '', m(rep.inCents)]], true);
  } else { pdf.setFontSize(8.5); pdf.setTextColor(...GREY); pdf.text('No money was added in this period.', 14, y + 2); y += 8; }

  section('Checks');
  const checks: [string, boolean][] = [
    [rep.waiting.count ? `${rep.waiting.count} request${rep.waiting.count === 1 ? '' : 's'} still waiting for signatures (${m(rep.waiting.cents)}).` : 'No requests waiting for signatures.', !rep.waiting.count],
    [rep.missingReceipts ? `${rep.missingReceipts} voucher${rep.missingReceipts === 1 ? ' has' : 's have'} no receipt yet.` : 'Every voucher has its receipt (past records excepted).', !rep.missingReceipts],
    [rep.closingCents >= 0 ? `The books balance: ${m(rep.openingCents)} + ${m(rep.inCents)} - ${m(rep.outCents)} = ${m(rep.closingCents)}.` : `The balance is below zero (${m(rep.closingCents)}).`, rep.closingCents >= 0],
  ];
  checks.forEach(([t, ok]) => {
    space(7);
    pdf.setFillColor(...(ok ? GREEN : RED)); pdf.circle(16.5, y, 1.6, 'F');
    pdf.setFontSize(8.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(t, 21, y + 1); y += 6.5;
  });
  y += 4;

  // Sign-off (Andy 2A): prepared by the accountant, approved by Andrew Guya, Doreen Guya or Elias Omondi.
  section('Sign-off');
  space(34);
  const sw = (w - 28 - 10) / 2;
  [{ role: `Prepared by · ${REPORT_PREPARED_BY.role}`, name: REPORT_PREPARED_BY.name }, { role: 'Approved by', name: approvedBy }].forEach((s, i) => {
    const x = 14 + i * (sw + 10);
    pdf.setFontSize(7); pdf.setTextColor(...GREY); pdf.text(s.role.toUpperCase(), x, y + 3);
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK); pdf.text(s.name, x, y + 9.5); pdf.setFont('helvetica', 'normal');
    pdf.setDrawColor(...GREY); pdf.setLineWidth(0.25);
    pdf.line(x, y + 21, x + sw * 0.62, y + 21); pdf.line(x + sw * 0.68, y + 21, x + sw, y + 21);
    pdf.setFontSize(7); pdf.setTextColor(...GREY); pdf.text('Signature', x, y + 25); pdf.text('Date', x + sw * 0.68, y + 25);
  });
  y += 30;

  const pages = pdf.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    pdf.setPage(n);
    drawFooter(pdf, `${lh.name} · Petty cash report · ${rep.name} · Page ${n} of ${pages}`, madeAt());
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${org.name.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-report-${rep.period}.pdf`, { type: 'application/pdf' });
}
