import { formatMoney } from '../../functions/src/shared/giving';
import { type LedgerLine } from '../../functions/src/shared/pettyCash';
import {
  drawFooter, drawLetterhead, drawRequisition, GOLD_SOFT, GREEN, GREY, INK, letterheadFor, NAVY, RED,
  type PdfSignOff, type VoucherRequisition,
} from '../../functions/src/shared/pettyVoucher';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';
import { crestImage } from './payrollPdf';

const logos = new Map<string, Promise<string | null>>();
/** The organization's logo from /org as a data URL, for the PDF letterhead; ADIA's crest is shared with payroll. */
function logoImage(file: string | null): Promise<string | null> {
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

/** The balance sheet as a PDF: every top-up, reset and approved request with the running balance. */
export async function balanceSheetPdf(org: Organization, lines: LedgerLine[], when: (ms: number) => string, totals: { in: number; out: number; balance: number }): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), 'Petty cash balance sheet', `${lines.length} entries`);

  const boxes: [string, string][] = [['Money in', m(totals.in)], ['Money out', m(totals.out)], ['Balance now', m(totals.balance)]];
  const bw = (w - 28 - 8) / 3;
  boxes.forEach(([k, v], i) => {
    const x = 14 + i * (bw + 4);
    pdf.setFillColor(...GOLD_SOFT);
    pdf.roundedRect(x, y, bw, 18, 2, 2, 'F');
    pdf.setFontSize(7.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...GREY);
    pdf.text(k.toUpperCase(), x + 4, y + 6);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...INK);
    pdf.text(v, x + 4, y + 14);
  });
  y += 26;

  const head = () => {
    pdf.setFillColor(...NAVY);
    pdf.rect(14, y, w - 28, 9, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Date', 17, y + 6);
    pdf.text('Description', 48, y + 6);
    pdf.text('In', w - 70, y + 6, { align: 'right' });
    pdf.text('Out', w - 44, y + 6, { align: 'right' });
    pdf.text('Balance', w - 17, y + 6, { align: 'right' });
    y += 9;
    pdf.setFont('helvetica', 'normal');
  };
  head();
  lines.forEach((l, i) => {
    const desc = pdf.splitTextToSize(l.description, w - 70 - 48 - 26) as string[];
    const h = Math.max(7.5, desc.length * 4.2 + 3.3);
    if (y + h > 272) { pdf.addPage(); y = 20; head(); }
    if (i % 2) { pdf.setFillColor(248, 248, 250); pdf.rect(14, y, w - 28, h, 'F'); }
    pdf.setFontSize(8);
    pdf.setTextColor(...INK);
    pdf.text(when(l.at), 17, y + 5);
    pdf.text(desc, 48, y + 5);
    if (l.creditCents) { pdf.setTextColor(...GREEN); pdf.text(m(l.creditCents), w - 70, y + 5, { align: 'right' }); }
    if (l.debitCents) { pdf.setTextColor(...RED); pdf.text(m(l.debitCents), w - 44, y + 5, { align: 'right' }); }
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold');
    pdf.text(m(l.balanceCents), w - 17, y + 5, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += h;
  });
  drawFooter(pdf, `${lh.name} · Petty cash balance sheet`, madeAt());
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${org.name.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-balance-sheet.pdf`, { type: 'application/pdf' });
}

export interface MonthReport {
  month: string; monthName: string; status: string;
  openingCents: number; inCents: number; outCents: number; closingCents: number;
  byCategory: { category: string; count: number; cents: number }[];
  requests: { number: string; date: string; requester: string; category: string; payee: string; cents: number; receipts: number }[];
  closedBy: { name: string; role: string; when: string }[];
  missingReceipts: number;
}

/** The signed month-end report for the board (Andy, 2026-10-24). */
export async function monthReportPdf(org: Organization, rep: MonthReport): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), 'Petty cash month-end report', `${rep.monthName} · ${rep.status}`);
  const boxes: [string, string][] = [['Opening balance', m(rep.openingCents)], ['Money in', m(rep.inCents)], ['Money out', m(rep.outCents)], ['Closing balance', m(rep.closingCents)]];
  const bw = (w - 28 - 12) / 4;
  boxes.forEach(([k, v], i) => {
    const x = 14 + i * (bw + 4);
    pdf.setFillColor(...GOLD_SOFT);
    pdf.roundedRect(x, y, bw, 18, 2, 2, 'F');
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...GREY);
    pdf.text(k.toUpperCase(), x + 3, y + 6);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...INK);
    pdf.text(v, x + 3, y + 14);
  });
  y += 26;
  const section = (title: string) => {
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
    pdf.text(title, 14, y); y += 5;
  };
  const table = (cols: { label: string; x: number; right?: boolean }[], rows: string[][]) => {
    const headRow = () => {
      pdf.setFillColor(...NAVY); pdf.rect(14, y, w - 28, 8, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold');
      cols.forEach((c) => pdf.text(c.label, c.x, y + 5.5, c.right ? { align: 'right' } : undefined));
      y += 8; pdf.setFont('helvetica', 'normal');
    };
    headRow();
    rows.forEach((row, i) => {
      if (y > 268) { pdf.addPage(); y = 20; headRow(); }
      if (i % 2) { pdf.setFillColor(248, 248, 250); pdf.rect(14, y, w - 28, 7, 'F'); }
      pdf.setFontSize(7.5); pdf.setTextColor(...INK);
      row.forEach((cell, n) => {
        const c = cols[n]!;
        const next = cols[n + 1]?.x ?? w - 14;
        const room = c.right ? 40 : next - c.x - 2;
        const t = (pdf.splitTextToSize(cell, room) as string[])[0] ?? '';
        pdf.text(t, c.x, y + 5, c.right ? { align: 'right' } : undefined);
      });
      y += 7;
    });
    y += 6;
  };
  section('Spending by category');
  table([{ label: 'Category', x: 17 }, { label: 'Requests', x: 130, right: true }, { label: 'Amount', x: w - 17, right: true }],
    [...rep.byCategory.map((c) => [c.category, String(c.count), m(c.cents)]), ['Total', String(rep.requests.length), m(rep.byCategory.reduce((n, c) => n + c.cents, 0))]]);
  section('Approved requisitions');
  table([{ label: 'Number', x: 17 }, { label: 'Date', x: 42 }, { label: 'Requester', x: 66 }, { label: 'Category', x: 100 }, { label: 'Paid to', x: 132 }, { label: 'Receipts', x: 172, right: true }, { label: 'Amount', x: w - 17, right: true }],
    rep.requests.map((r) => [r.number, r.date, r.requester, r.category, r.payee || '–', String(r.receipts), m(r.cents)]));
  if (rep.missingReceipts) {
    pdf.setFontSize(8.5); pdf.setTextColor(...RED);
    pdf.text(`${rep.missingReceipts} approved requisition${rep.missingReceipts === 1 ? ' has' : 's have'} no receipt.`, 14, y); y += 8;
  }
  section('Closed by');
  if (y > 240) { pdf.addPage(); y = 20; }
  const sw = (w - 28 - 8) / 2;
  (rep.closedBy.length ? rep.closedBy : [{ name: 'Not yet closed', role: '', when: '' }]).forEach((s, i) => {
    const x = 14 + (i % 2) * (sw + 8);
    pdf.setDrawColor(...GREY); pdf.setLineWidth(0.2); pdf.roundedRect(x, y, sw, 20, 2, 2, 'S');
    pdf.setFontSize(7); pdf.setTextColor(...GREY); pdf.text((s.role || 'Stakeholder').toUpperCase(), x + 4, y + 6);
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK); pdf.text(s.name, x + 4, y + 12);
    pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GREEN); pdf.text(s.when ? `Signed electronically · ${s.when}` : '', x + 4, y + 17);
  });
  drawFooter(pdf, `${lh.name} · Petty cash month-end report · ${rep.monthName}`, madeAt());
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${org.name.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-${rep.month}-report.pdf`, { type: 'application/pdf' });
}
