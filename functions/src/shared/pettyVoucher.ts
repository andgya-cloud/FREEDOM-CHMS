import type { jsPDF as JsPdf } from 'jspdf';
import { formatMoney } from './giving.js';
import { categoryLabel, type PettyCashItem } from './pettyCash.js';

/*
 * The petty cash voucher drawing, shared by the app (Download PDF) and the server (the signed voucher
 * emailed to stakeholders once a request is approved). Navy and gold, with each organization's letterhead.
 */
export const NAVY: [number, number, number] = [11, 17, 44];
export const GOLD: [number, number, number] = [210, 167, 75];
export const GOLD_SOFT: [number, number, number] = [246, 236, 212];
export const INK: [number, number, number] = [31, 41, 55];
export const GREY: [number, number, number] = [107, 114, 128];
export const GREEN: [number, number, number] = [22, 163, 74];
export const RED: [number, number, number] = [220, 38, 38];

type Rgb = [number, number, number];

/**
 * An organization's letterhead: the name, the address lines printed under it, the email it sends from, its
 * logo (a file in /org in the app and in functions/assets on the server) and its colours.
 */
export interface Letterhead { name: string; lines: string[]; email: string | null; crest: string | null; band: Rgb; accent: Rgb }

/** ADIA's details (Andy, 2026-10-23). */
export const ADIA_LETTERHEAD: Letterhead = {
  name: 'ADIA Training Centre',
  lines: ['P.O. Box 228770-00100 Nairobi', 'Tel 010086218 · adiatrainingc@gmail.com'],
  email: 'adiatrainingc@gmail.com',
  crest: 'adia-crest.png',
  band: NAVY,
  accent: GOLD,
};

/** Freedom Church's details and logo greens (Andy, 2026-10-30). */
export const CHURCH_LETTERHEAD: Letterhead = {
  name: 'Freedom Church',
  lines: ['Box 22870 - 00100 Nairobi', 'freedomchurchnairobi@gmail.com'],
  email: 'freedomchurchnairobi@gmail.com',
  crest: 'freedom-church-mark.png',
  band: [47, 110, 74],
  accent: [162, 201, 134],
};

/** Freedom Hope Center's details and OneChild green (Andy, 2026-10-30). */
export const HOPE_LETTERHEAD: Letterhead = {
  name: 'Freedom Hope Center',
  lines: ['Box 22870 - 00100 Nairobi', 'freedomnbi@gmail.com'],
  email: 'freedomnbi@gmail.com',
  crest: 'hope-centre-mark.png',
  band: [3, 130, 65],
  accent: [120, 196, 146],
};

export function letterheadFor(org: { type?: string; name: string }): Letterhead {
  if (org.type === 'college') return ADIA_LETTERHEAD;
  if (org.type === 'church_campus') return { ...CHURCH_LETTERHEAD, name: org.name || CHURCH_LETTERHEAD.name };
  if (org.type === 'ministry') return { ...HOPE_LETTERHEAD, name: org.name || HOPE_LETTERHEAD.name };
  return { name: org.name, lines: [], email: null, crest: null, band: NAVY, accent: GOLD };
}

/** Draws the letterhead; `crest` is a PNG data URL (or null). Returns where the page body starts. */
export function drawLetterhead(pdf: JsPdf, lh: Letterhead, crest: string | null, title: string, sub: string): number {
  const w = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...lh.band);
  pdf.rect(0, 0, w, 34, 'F');
  pdf.setFillColor(...lh.accent);
  pdf.rect(0, 34, w, 1.6, 'F');
  let x = 14;
  if (lh.crest) {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...lh.accent);
    pdf.setLineWidth(0.9);
    pdf.circle(25, 17, 11, 'FD');
    if (crest) pdf.addImage(crest, 'PNG', 17.5, 9.5, 15, 15);
    x = 42;
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(lh.name, x, 14);
  pdf.setTextColor(...lh.accent);
  pdf.setFontSize(8.5);
  pdf.setCharSpace(1.4);
  pdf.text(title.toUpperCase(), x, 20.5);
  pdf.setCharSpace(0);
  pdf.setTextColor(220, 224, 235);
  pdf.setFont('helvetica', 'normal');
  pdf.text(sub, x, 26.5);
  // The address, on the right of the band.
  pdf.setFontSize(7.5);
  lh.lines.forEach((line, i) => pdf.text(line, w - 14, 14 + i * 5, { align: 'right' }));
  return 44;
}

export function drawFooter(pdf: JsPdf, text: string, madeAt: string) {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.4);
  pdf.line(14, h - 14, w - 14, h - 14);
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GREY);
  pdf.text(text, 14, h - 9);
  pdf.text(`Made ${madeAt}`, w - 14, h - 9, { align: 'right' });
}

export interface PdfSignOff { role: string; name: string | null; when: string | null }

export interface VoucherRequisition {
  number: string | null; requesterName: string; category: string; categoryNote?: string | null; items: PettyCashItem[];
  totalCents: number; status: string; statusLabel: string; date: string;
  payee?: string | null; mpesaCode?: string | null;
}

/**
 * A requisition on the page: who asked, the items with quantity and unit price, the total and every
 * signature so far. Once approved it is the payment voucher, stamped APPROVED, and each signature is
 * marked as signed electronically with the signer's title, date and time.
 */
export function drawRequisition(pdf: JsPdf, lh: Letterhead, crest: string | null, currency: string, r: VoucherRequisition,
  signOffs: PdfSignOff[], receiptCount: number, madeAt: string) {
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, currency);
  const approved = r.status === 'approved';
  let y = drawLetterhead(pdf, lh, crest, approved ? 'Approved petty cash voucher' : 'Petty cash requisition', `${r.number ?? 'Number to follow'} · ${r.date}`);
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
  const rows: [string, string][] = [['Requested by', r.requesterName], ['Category', categoryLabel(r)], ['Status', r.statusLabel]];
  if (r.payee || r.mpesaCode) rows.push(['Paid to', [r.payee, r.mpesaCode ? `M-Pesa ${r.mpesaCode}` : ''].filter(Boolean).join(' · ')]);
  pdf.setFillColor(...GOLD_SOFT);
  pdf.roundedRect(14, y, w - 76, rows.length * 8 + 6, 2, 2, 'F');
  pdf.setFontSize(9);
  rows.forEach(([k, v], i) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...GREY);
    pdf.text(k, 19, y + 8 + i * 8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(v, w - 130)[0] as string, 52, y + 8 + i * 8);
  });
  y += rows.length * 8 + 16;

  // Items table.
  const cols = [14, 24, w - 92, w - 66, w - 14];
  pdf.setFillColor(...lh.band);
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
  pdf.setDrawColor(...lh.accent);
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
  pdf.setTextColor(...lh.band);
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
    if (s.when) pdf.text(s.when, x + 4, y + 20);
    if (s.name) {
      pdf.setTextColor(...GREEN);
      pdf.setFontSize(6.5);
      pdf.text('SIGNED ELECTRONICALLY', x + 4, y + 24.5);
    }
  });
  y += 34;
  pdf.setFontSize(8.5);
  pdf.setTextColor(...GREY);
  pdf.text(`${receiptCount} receipt${receiptCount === 1 ? '' : 's'} attached in Insight-IQ.`, 14, y);

  drawFooter(pdf, `${lh.name} · Petty cash · Each signature is made from the signer's own account or PIN`, madeAt);
}
