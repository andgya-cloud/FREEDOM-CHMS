import { formatMoney } from '../../functions/src/shared/giving';
import { type LedgerLine } from '../../functions/src/shared/pettyCash';
import {
  drawFooter, drawLetterhead, drawRequisition, GOLD_SOFT, GREEN, GREY, INK, letterheadFor, NAVY, RED,
  type PdfSignOff, type VoucherRequisition,
} from '../../functions/src/shared/pettyVoucher';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';
import { crestImage } from './payrollPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';

export type { PdfSignOff };
const madeAt = () => new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

/** The requisition (or, once approved, the payment voucher) as a PDF, made on this device. */
export async function requisitionPdf(org: Organization, r: VoucherRequisition, signOffs: PdfSignOff[], receiptCount: number): Promise<File> {
  const pdf = await newPdf('a4');
  const lh = letterheadFor(org);
  drawRequisition(pdf, lh, lh.crest ? await crestImage() : null, org.currency || 'KES', r, signOffs, receiptCount, madeAt());
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${r.number ?? 'Requisition'}${r.status === 'approved' ? '-approved' : ''}.pdf`, { type: 'application/pdf' });
}

/** The balance sheet as a PDF: every top-up, reset and approved request with the running balance. */
export async function balanceSheetPdf(org: Organization, lines: LedgerLine[], when: (ms: number) => string, totals: { in: number; out: number; balance: number }): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, lh.crest ? await crestImage() : null, 'Petty cash balance sheet', `${lines.length} entries`);

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
