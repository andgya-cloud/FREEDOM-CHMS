import { formatMoney } from '../../functions/src/shared/giving';
import type { PayLine } from '../../functions/src/shared/payroll';
import type { Organization } from '../state/OrgContext';
import { GREY, header, INK, newPdf } from './givingPdf';

/** A staff member's payslip as a PDF, made on the device, for sending by WhatsApp or email. */
export async function payslipPdf(org: Organization, monthLabel: string, month: string, l: PayLine, approvedBy: string | null): Promise<File> {
  const pdf = await newPdf('a5');
  const w = pdf.internal.pageSize.getWidth();
  const m = (c: number) => formatMoney(c, org.currency || 'KES');
  header(pdf, org, `Payslip · ${monthLabel}`);
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  pdf.setFont('helvetica', 'bold');
  pdf.text(l.name, 14, 37);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...GREY);
  pdf.text([l.jobTitle, l.staffNo && `Staff no. ${l.staffNo}`, `KRA PIN ${l.kraPin || '–'} · NSSF ${l.nssfNo || '–'} · SHIF ${l.shifNo || '–'}`].filter(Boolean).join('   '), 14, 42, { maxWidth: w - 28 });

  let y = 52;
  const section = (title: string) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(...INK);
    pdf.text(title, 14, y);
    y += 2;
    pdf.setDrawColor(220, 220, 220);
    pdf.line(14, y, w - 14, y);
    y += 5;
    pdf.setFont('helvetica', 'normal');
  };
  const row = (label: string, cents: number, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK);
    pdf.text(label, 14, y, { maxWidth: w - 60 });
    pdf.text(m(cents), w - 14, y, { align: 'right' });
    y += 5.5;
  };
  section('Earnings');
  row('Basic salary', l.basicCents);
  for (const a of l.allowances) row(a.name, a.amountCents);
  for (const a of l.oneOff ?? []) row(`${a.name} (this month)`, a.amountCents);
  for (const a of l.unpaid ?? []) row(`Less: ${a.name}`, -a.amountCents);
  row('Gross pay', l.grossCents, true);
  y += 3;
  section('Deductions');
  row('NSSF', l.nssfCents);
  row('SHIF', l.shifCents);
  row('Housing Levy', l.housingCents);
  row('PAYE', l.payeCents);
  for (const d of l.deductions) row(d.name, d.amountCents);
  row('Total deductions', l.totalDeductionsCents, true);
  y += 4;
  pdf.setFillColor(232, 245, 236);
  pdf.rect(14, y - 5, w - 28, 10, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(22, 101, 52);
  pdf.text('Net pay', 17, y + 1.5);
  pdf.text(m(l.netCents), w - 17, y + 1.5, { align: 'right' });
  y += 12;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...GREY);
  pdf.text(`Taxable pay ${m(l.taxableCents)} · Tax ${m(l.taxBeforeReliefCents)} less personal relief ${m(l.reliefCents)}`, 14, y, { maxWidth: w - 28 });
  y += 5;
  if (l.paymentDetails) { pdf.text(`Paid to ${l.paymentDetails}`, 14, y, { maxWidth: w - 28 }); y += 5; }
  pdf.text(approvedBy ? `Approved by ${approvedBy}` : 'Not yet approved', 14, y);
  const safe = l.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Payslip-${month}-${safe}.pdf`, { type: 'application/pdf' });
}
