import { formatMoney } from '../../functions/src/shared/giving';
import type { PayLine } from '../../functions/src/shared/payroll';
import type { Organization } from '../state/OrgContext';
import { newPdf } from './givingPdf';

const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const GOLD_SOFT: [number, number, number] = [246, 236, 212];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];

let crest: Promise<string | null> | null = null;
/** The ADIA crest as a data URL, loaded once; the slip is still made without it when offline. */
function crestImage(): Promise<string | null> {
  crest ??= fetch('/org/adia-crest.png')
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no crest'))))
    .then((b) => new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(b);
    }))
    .catch(() => { crest = null; return null; });
  return crest;
}

/** A staff member's ADIA staff payslip as a PDF, made on the device, for sending by WhatsApp or email. */
export async function payslipPdf(org: Organization, monthLabel: string, month: string, l: PayLine, approvedBy: string | null): Promise<File> {
  const pdf = await newPdf('a5');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');

  // Navy band with the crest, the name and "Staff Payslip".
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, w, 34, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 34, w, 1.6, 'F');
  const img = await crestImage();
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.9);
  pdf.circle(24, 17, 11, 'FD');
  if (img) pdf.addImage(img, 'PNG', 16.5, 9.5, 15, 15);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('ADIA Training Centre', 40, 16);
  pdf.setTextColor(...GOLD);
  pdf.setFontSize(8.5);
  pdf.setCharSpace(1.6);
  pdf.text('STAFF PAYSLIP', 40, 22.5);
  pdf.setCharSpace(0);
  pdf.setTextColor(220, 224, 235);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Pay period: ${monthLabel}`, 40, 28.5);

  // Who the slip is for, on a soft gold panel.
  let y = 42;
  pdf.setFillColor(...GOLD_SOFT);
  pdf.rect(12, y - 4, w - 24, 22, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(12, y - 4, 1.2, 22, 'F');
  const fields: [string, string][] = [
    ['NAME', l.name], ['JOB TITLE', l.jobTitle || '–'], ['STAFF NO.', l.staffNo || '–'],
    ['ID NUMBER', l.idNo || '–'], ['KRA PIN', l.kraPin || '–'], ['NSSF / SHIF', `${l.nssfNo || '–'} / ${l.shifNo || '–'}`],
  ];
  const colW = (w - 30) / 3;
  fields.forEach(([k, v], i) => {
    const x = 16 + (i % 3) * colW;
    const yy = y + Math.floor(i / 3) * 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(138, 109, 44);
    pdf.text(k, x, yy);
    pdf.setFontSize(8.5);
    pdf.setTextColor(...NAVY);
    pdf.text(pdf.splitTextToSize(v, colW - 3)[0] as string, x, yy + 4);
  });
  y += 26;

  const heading = (title: string) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...NAVY);
    pdf.setCharSpace(0.8);
    pdf.text(title, 12, y);
    pdf.setCharSpace(0);
    y += 1.8;
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.6);
    pdf.line(12, y, w - 12, y);
    y += 5;
  };
  const row = (label: string, cents: number, total = false) => {
    pdf.setFont('helvetica', total ? 'bold' : 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...(total ? NAVY : INK));
    pdf.text(pdf.splitTextToSize(label, w - 70)[0] as string, 12, y);
    pdf.text(m(cents), w - 12, y, { align: 'right' });
    if (!total) {
      pdf.setDrawColor(229, 231, 235);
      pdf.setLineWidth(0.2);
      pdf.line(12, y + 1.8, w - 12, y + 1.8);
    }
    y += 5.6;
  };
  heading('EARNINGS');
  row('Basic salary', l.basicCents);
  for (const a of l.allowances) row(a.name, a.amountCents);
  for (const a of l.oneOff ?? []) row(`${a.name} (this month)`, a.amountCents);
  for (const a of l.unpaid ?? []) row(`Less: ${a.name}`, -a.amountCents);
  row('Gross pay', l.grossCents, true);
  y += 2;
  heading('DEDUCTIONS');
  row('NSSF', l.nssfCents);
  row('SHIF', l.shifCents);
  row('Housing Levy', l.housingCents);
  row('PAYE', l.payeCents);
  for (const d of l.deductions) row(d.name, d.amountCents);
  row('Total deductions', l.totalDeductionsCents, true);

  // Net pay on a navy bar with a gold edge.
  y += 3;
  pdf.setFillColor(...NAVY);
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.8);
  pdf.roundedRect(12, y, w - 24, 13, 2.5, 2.5, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...GOLD);
  pdf.setCharSpace(1.2);
  pdf.text('NET PAY', 17, y + 8.2);
  pdf.setCharSpace(0);
  pdf.setFontSize(14);
  pdf.setTextColor(255, 255, 255);
  pdf.text(m(l.netCents), w - 17, y + 8.6, { align: 'right' });
  y += 20;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GREY);
  pdf.text(`Taxable pay ${m(l.taxableCents)} · Tax ${m(l.taxBeforeReliefCents)} less personal relief ${m(l.reliefCents)}`, 12, y, { maxWidth: w - 24 });
  y += 4.5;
  if (l.paymentDetails) pdf.text(`Paid to ${l.paymentDetails}`, 12, y, { maxWidth: w - 24 });

  // Footer.
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.2);
  pdf.line(12, h - 14, w - 12, h - 14);
  pdf.text(approvedBy ? `Approved by ${approvedBy}` : 'Not yet approved', 12, h - 9);
  pdf.text('Computer-generated payslip · Keep it confidential', w - 12, h - 9, { align: 'right' });
  pdf.setFillColor(...GOLD);
  pdf.rect(0, h - 3, w, 3, 'F');

  const safe = l.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Staff-Payslip-${month}-${safe}.pdf`, { type: 'application/pdf' });
}
