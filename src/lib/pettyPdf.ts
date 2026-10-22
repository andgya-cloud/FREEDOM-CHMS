import type { jsPDF as JsPdf } from 'jspdf';
import { formatMoney } from '../../functions/src/shared/giving';
import { categoryLabel, type LedgerLine, type PettyCashItem } from '../../functions/src/shared/pettyCash';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';
import { crestImage } from './payrollPdf';

const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const GOLD_SOFT: [number, number, number] = [246, 236, 212];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];
const GREEN: [number, number, number] = [22, 163, 74];
const RED: [number, number, number] = [220, 38, 38];

/** The navy and gold letterhead; ADIA's carries its crest. Returns where the page body starts. */
async function letterhead(pdf: JsPdf, org: Organization, title: string, sub: string): Promise<number> {
  const w = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, w, 34, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 34, w, 1.6, 'F');
  let x = 14;
  if (org.type === 'college') {
    const img = await crestImage();
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.circle(25, 17, 11, 'FD');
    if (img) pdf.addImage(img, 'PNG', 17.5, 9.5, 15, 15);
    x = 42;
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(org.name, x, 16);
  pdf.setTextColor(...GOLD);
  pdf.setFontSize(8.5);
  pdf.setCharSpace(1.4);
  pdf.text(title.toUpperCase(), x, 22.5);
  pdf.setCharSpace(0);
  pdf.setTextColor(220, 224, 235);
  pdf.setFont('helvetica', 'normal');
  pdf.text(sub, x, 28.5);
  return 44;
}

function footer(pdf: JsPdf, text: string) {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.4);
  pdf.line(14, h - 14, w - 14, h - 14);
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GREY);
  pdf.text(text, 14, h - 9);
  pdf.text(`Made ${new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}`, w - 14, h - 9, { align: 'right' });
}

export interface PdfSignOff { role: string; name: string | null; when: string | null }

/**
 * A requisition as a PDF: who asked, the items with quantity and unit price, the total and every
 * signature so far. Once approved it is the payment voucher, stamped APPROVED.
 */
export async function requisitionPdf(org: Organization, r: {
  number: string | null; requesterName: string; category: string; categoryNote?: string | null; items: PettyCashItem[];
  totalCents: number; status: string; statusLabel: string; date: string;
}, signOffs: PdfSignOff[], receiptCount: number): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  const approved = r.status === 'approved';
  let y = await letterhead(pdf, org, approved ? 'Approved petty cash voucher' : 'Petty cash requisition', `${r.number ?? 'Number to follow'} · ${r.date}`);

  // Status stamp.
  const stamp = approved ? 'APPROVED' : r.status === 'rejected' ? 'REJECTED' : 'PENDING';
  pdf.setDrawColor(...(approved ? GREEN : r.status === 'rejected' ? RED : GOLD));
  pdf.setTextColor(...(approved ? GREEN : r.status === 'rejected' ? RED : GOLD));
  pdf.setLineWidth(0.8);
  pdf.roundedRect(w - 56, y, 42, 12, 2, 2, 'S');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(stamp, w - 35, y + 8, { align: 'center' });

  // Who and what.
  pdf.setFillColor(...GOLD_SOFT);
  pdf.roundedRect(14, y, w - 76, 30, 2, 2, 'F');
  const rows: [string, string][] = [['Requested by', r.requesterName], ['Category', categoryLabel(r)], ['Status', r.statusLabel]];
  pdf.setFontSize(9);
  rows.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...GREY);
    pdf.text(k, 19, y + 8 + i * 8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(v, w - 130)[0] as string, 52, y + 8 + i * 8);
  });
  y += 40;

  // Items table.
  const cols = [14, 24, w - 92, w - 66, w - 14];
  pdf.setFillColor(...NAVY);
  pdf.rect(14, y, w - 28, 9, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'bold');
  pdf.text('#', cols[0]! + 3, y + 6);
  pdf.text('Description', cols[1]!, y + 6);
  pdf.text('Qty', cols[2]!, y + 6, { align: 'right' });
  pdf.text('Unit price', cols[3]!, y + 6, { align: 'right' });
  pdf.text('Amount', cols[4]! - 3, y + 6, { align: 'right' });
  y += 9;
  pdf.setFont('helvetica', 'normal');
  r.items.forEach((it, i) => {
    const desc = pdf.splitTextToSize(it.description, cols[2]! - cols[1]! - 18) as string[];
    const h = Math.max(8, desc.length * 4.5 + 3.5);
    if (y + h > 250) { pdf.addPage(); y = 20; }
    if (i % 2) { pdf.setFillColor(248, 248, 250); pdf.rect(14, y, w - 28, h, 'F'); }
    pdf.setTextColor(...INK);
    pdf.text(String(i + 1), cols[0]! + 3, y + 5.5);
    pdf.text(desc, cols[1]!, y + 5.5);
    pdf.text(String(it.quantity ?? 1), cols[2]!, y + 5.5, { align: 'right' });
    pdf.text(m(it.unitPriceCents ?? it.amountCents), cols[3]!, y + 5.5, { align: 'right' });
    pdf.text(m(it.amountCents), cols[4]! - 3, y + 5.5, { align: 'right' });
    y += h;
  });
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.6);
  pdf.line(14, y + 1, w - 14, y + 1);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Total', cols[3]!, y + 9, { align: 'right' });
  pdf.text(m(r.totalCents), cols[4]! - 3, y + 9, { align: 'right' });
  y += 20;

  // Signatures.
  if (y > 220) { pdf.addPage(); y = 20; }
  pdf.setFontSize(10);
  pdf.setTextColor(...NAVY);
  pdf.text('Authorization', 14, y);
  y += 4;
  const boxW = (w - 28 - (signOffs.length - 1) * 4) / signOffs.length;
  signOffs.forEach((s, i) => {
    const x = 14 + i * (boxW + 4);
    pdf.setDrawColor(...(s.name ? GREEN : [210, 210, 215] as [number, number, number]));
    pdf.setLineWidth(0.5);
    pdf.roundedRect(x, y, boxW, 26, 2, 2, 'S');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    pdf.text(s.role.toUpperCase(), x + 4, y + 6);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(...(s.name ? INK : GREY));
    pdf.text(pdf.splitTextToSize(s.name ?? 'Not yet signed', boxW - 8)[0] as string, x + 4, y + 14);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    if (s.when) pdf.text(s.when, x + 4, y + 21);
  });
  y += 34;
  pdf.setFontSize(8.5);
  pdf.setTextColor(...GREY);
  pdf.text(`${receiptCount} receipt${receiptCount === 1 ? '' : 's'} attached in Insight-IQ.`, 14, y);

  footer(pdf, `${org.name} · Petty cash · Signed from each person's own Insight-IQ account`);
  return new File([pdf.output('blob')], `${r.number ?? 'Requisition'}${approved ? '-approved' : ''}.pdf`, { type: 'application/pdf' });
}

/** The balance sheet as a PDF: every top-up, reset and approved request with the running balance. */
export async function balanceSheetPdf(org: Organization, lines: LedgerLine[], when: (ms: number) => string, totals: { in: number; out: number; balance: number }): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  let y = await letterhead(pdf, org, 'Petty cash balance sheet', `${lines.length} entries`);

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
  footer(pdf, `${org.name} · Petty cash balance sheet`);
  return new File([pdf.output('blob')], `${org.name.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-balance-sheet.pdf`, { type: 'application/pdf' });
}
