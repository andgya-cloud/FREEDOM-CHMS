import type { jsPDF as JsPdf } from 'jspdf';
import { formatMoney, GIFT_METHOD_LABELS, PAYBILL_NUMBER, provisionalReceiptNumber } from '../../functions/src/shared/giving';
import { formatDateKey } from '../../functions/src/shared/datetime';
import type { Organization } from '../state/OrgContext';
import type { Gift } from '../state/useGiving';

/**
 * Receipts and giving statements as PDF files, made on the device so they
 * work offline. They can be shared to WhatsApp from a phone or printed.
 */

export async function newPdf(format: 'a5' | 'a4'): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf');
  return new jsPDF({ unit: 'mm', format });
}

export const GOLD: [number, number, number] = [176, 137, 52];
export const INK: [number, number, number] = [30, 30, 30];
export const GREY: [number, number, number] = [110, 110, 110];

export function header(pdf: JsPdf, org: Organization, title: string) {
  const w = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 0, w, 4, 'F');
  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(org.name, 14, 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(...GREY);
  pdf.text(title, 14, 25);
  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, 29, w - 14, 29);
}

export function receiptNumberFor(org: Pick<Organization, 'receiptPrefix'>, gift: Pick<Gift, 'id' | 'receiptNumber'>) {
  return gift.receiptNumber ?? provisionalReceiptNumber(org.receiptPrefix || 'RCT', gift.id);
}

export function paymentLabel(gift: Pick<Gift, 'method' | 'mpesaCode'>) {
  return gift.method === 'mpesa' && gift.mpesaCode ? `M-Pesa ${gift.mpesaCode}` : GIFT_METHOD_LABELS[gift.method];
}

export async function receiptPdf(org: Organization, gift: Gift, fundName: string): Promise<File> {
  const pdf = await newPdf('a5');
  const w = pdf.internal.pageSize.getWidth();
  const number = receiptNumberFor(org, gift);
  const provisional = !gift.receiptNumber;
  header(pdf, org, provisional ? 'Receipt (provisional)' : 'Official receipt');

  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(number, w - 14, 18, { align: 'right' });

  const rows: [string, string][] = [
    ['Date', formatDateKey(gift.date)],
    ['Received from', gift.giverName],
    ['Fund', fundName],
    ['Amount', formatMoney(gift.amountCents, org.currency || 'KES')],
    ['Payment', paymentLabel(gift)],
    ['Received by', gift.receivedByName],
  ];
  let y = 42;
  for (const [label, value] of rows) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...GREY);
    pdf.text(label, 14, y);
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', label === 'Amount' ? 'bold' : 'normal');
    pdf.setFontSize(label === 'Amount' ? 14 : 11);
    pdf.text(pdf.splitTextToSize(value, w - 64) as string[], 50, y);
    y += label === 'Amount' ? 11 : 9;
  }

  if (gift.status === 'void') {
    pdf.setTextColor(200, 40, 40);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(40);
    pdf.text('VOID', w / 2, 75, { align: 'center', angle: 20 });
    pdf.setFontSize(10);
    pdf.text(`Voided: ${gift.voidReason ?? ''}`, 14, y + 4);
    y += 8;
  }

  pdf.setTextColor(...GREY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const notes: string[] = [];
  if (provisional) notes.push('Saved offline. The official receipt number is given once this device is back online.');
  if (org.type === 'church_campus') notes.push(`Give by M-Pesa: Paybill ${PAYBILL_NUMBER}, account FCC#Fund (for example FCC#Tithes).`);
  notes.push('Thank you for your giving.');
  pdf.text(pdf.splitTextToSize(notes.join('  '), w - 28) as string[], 14, y + 8);

  return new File([pdf.output('blob')], `${number}.pdf`, { type: 'application/pdf' });
}

export interface StatementPage {
  personName: string;
  gifts: Gift[];
}

/**
 * Giving statements for a date range: one page (or more) per person, with
 * every confirmed gift and the totals per fund. Void gifts are left out.
 */
export async function statementPdf(
  org: Organization,
  pages: StatementPage[],
  from: string,
  to: string,
  fundName: (id: string | null) => string,
  fileName: string,
): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const currency = org.currency || 'KES';
  const cols = [14, 44, 92, 138, w - 14];

  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage();
    const gifts = page.gifts.filter((g) => g.status === 'confirmed').sort((a, b) => a.date.localeCompare(b.date));
    header(pdf, org, 'Giving statement');
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(page.personName, 14, 39);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...GREY);
    pdf.text(`${formatDateKey(from)} to ${formatDateKey(to)}`, 14, 45);

    let y = 56;
    const head = () => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...GREY);
      pdf.text('Date', cols[0]!, y);
      pdf.text('Receipt', cols[1]!, y);
      pdf.text('Fund', cols[2]!, y);
      pdf.text('Payment', cols[3]!, y);
      pdf.text('Amount', cols[4]!, y, { align: 'right' });
      y += 6;
    };
    head();
    pdf.setFont('helvetica', 'normal');
    for (const g of gifts) {
      if (y > h - 40) {
        pdf.addPage();
        y = 20;
        head();
        pdf.setFont('helvetica', 'normal');
      }
      pdf.setTextColor(...INK);
      pdf.setFontSize(9);
      pdf.text(formatDateKey(g.date), cols[0]!, y);
      pdf.text(receiptNumberFor(org, g), cols[1]!, y);
      pdf.text(pdf.splitTextToSize(fundName(g.fundId), 44)[0] as string, cols[2]!, y);
      pdf.text(paymentLabel(g), cols[3]!, y);
      pdf.text(formatMoney(g.amountCents, currency), cols[4]!, y, { align: 'right' });
      y += 6;
    }
    if (!gifts.length) {
      pdf.setTextColor(...GREY);
      pdf.text('No gifts recorded in this period.', 14, y);
      y += 6;
    }

    const byFund = new Map<string, number>();
    gifts.forEach((g) => byFund.set(fundName(g.fundId), (byFund.get(fundName(g.fundId)) ?? 0) + g.amountCents));
    y += 4;
    pdf.setDrawColor(220, 220, 220);
    pdf.line(14, y - 4, w - 14, y - 4);
    pdf.setFontSize(10);
    for (const [name, cents] of [...byFund].sort((a, b) => a[0].localeCompare(b[0]))) {
      pdf.setTextColor(...GREY);
      pdf.text(name, cols[3]!, y);
      pdf.setTextColor(...INK);
      pdf.text(formatMoney(cents, currency), cols[4]!, y, { align: 'right' });
      y += 6;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Total', cols[3]!, y + 1);
    pdf.text(formatMoney(gifts.reduce((s, g) => s + g.amountCents, 0), currency), cols[4]!, y + 1, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...GREY);
    pdf.text('Thank you for your faithful giving.', 14, h - 14);
  });

  return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
}

/** Opens the phone's share sheet (WhatsApp and others) with the file, or downloads it. */
export async function shareOrDownload(file: File, text: string): Promise<'shared' | 'downloaded'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name, text });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'shared';
    }
  }
  downloadFile(file);
  return 'downloaded';
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens the PDF in a new tab, where it can be printed. */
export function openForPrinting(file: File) {
  const url = URL.createObjectURL(file);
  const win = window.open(url, '_blank');
  if (!win) downloadFile(file);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
