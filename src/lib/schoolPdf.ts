import type { jsPDF as JsPdf } from 'jspdf';
import { formatMoney } from '../../functions/src/shared/giving';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { OUTCOME_LABELS, type SchoolReportDoc, type SchoolSettings, type UnitResult } from '../../functions/src/shared/school';
import type { Organization } from '../state/OrgContext';
import type { Gift } from '../state/useGiving';
import { header, newPdf, receiptNumberFor, paymentLabel, GREY, INK } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';

/**
 * ADIA documents as PDF files, made on the device so they work offline:
 * report cards, transcripts, fee statements and the director's school report.
 */

const file = (pdf: JsPdf, name: string) => { stampPoweredBy(pdf); return new File([pdf.output('blob')], name, { type: 'application/pdf' }); };

export interface Column { label: string; x: number; align?: 'right' }

export function drawTable(pdf: JsPdf, y: number, cols: Column[], rows: string[][], bottom: number): number {
  const head = (at: number) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(...GREY);
    for (const c of cols) pdf.text(c.label, c.x, at, c.align ? { align: c.align } : undefined);
    return at + 6;
  };
  y = head(y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  for (const r of rows) {
    if (y > bottom) {
      pdf.addPage();
      y = head(20);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
    }
    pdf.setTextColor(...INK);
    r.forEach((cell, i) => {
      const c = cols[i]!;
      const next = cols[i + 1];
      const room = c.align ? 40 : Math.max(20, (next ? (next.align ? next.x - 30 : next.x) : 196) - c.x - 3);
      pdf.text(pdf.splitTextToSize(cell, room)[0] as string, c.x, y, c.align ? { align: c.align } : undefined);
    });
    y += 6;
  }
  return y;
}

function titleBlock(pdf: JsPdf, lines: [string, string][]) {
  let y = 38;
  for (const [label, value] of lines) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...GREY);
    pdf.text(label, 14, y);
    pdf.setTextColor(...INK);
    pdf.setFontSize(10);
    pdf.text(value, 48, y);
    y += 6;
  }
  return y + 4;
}

export interface StudentIdentity {
  name: string;
  admissionNo: string;
  course: string;
  level: string;
  intake: string;
  status: string;
}

export interface ResultsInput {
  student: StudentIdentity;
  results: UnitResult[];
  overall: { percent: number | null; grade: string | null; passedUnits: number; assessedUnits: number };
  attendance: { held: number; attended: number; percent: number | null };
  settings: SchoolSettings;
  today: string;
  certificate?: { serial?: string; issuedOn: string } | null;
}

/** One term's report card, or the full transcript (the same table, plus the certificate and every level). */
export async function resultsPdf(org: Organization, kind: 'report_card' | 'transcript', input: ResultsInput): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const s = input.student;
  header(pdf, org, kind === 'report_card' ? 'Student report card' : 'Academic transcript');
  let y = titleBlock(pdf, [
    ['Student', s.name], ['Admission number', s.admissionNo || 'Not yet issued'], ['Department', s.course],
    ['Level', s.level || '–'], ['Cohort', s.intake || '–'], ['Date', formatDateKey(input.today)],
  ]);
  const cols: Column[] = [{ label: 'Unit', x: 14 }, { label: 'Trainer', x: 90 }, { label: 'Mark %', x: 160, align: 'right' }, { label: 'Grade', x: 166 }];
  const rows = input.results.map((r) => [r.name, r.trainer || '–', r.percent == null ? '–' : String(r.percent), r.grade ?? 'Not assessed']);
  y = drawTable(pdf, y, cols, rows, h - 50);
  if (!rows.length) {
    pdf.setTextColor(...GREY);
    pdf.text('No units have been set up for this programme.', 14, y);
    y += 6;
  }
  y += 4;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, y - 3, w - 14, y - 3);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  pdf.text(`Overall: ${input.overall.percent == null ? 'not yet assessed' : `${input.overall.percent}% (${input.overall.grade})`}`, 14, y + 3);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`Units passed: ${input.overall.passedUnits} of ${input.overall.assessedUnits} assessed. Pass mark ${input.settings.passMark}%.`, 14, y + 10);
  pdf.text(
    input.attendance.percent == null
      ? 'Attendance: no classes recorded yet.'
      : `Attendance: ${input.attendance.percent}% (${input.attendance.attended} of ${input.attendance.held} classes).`,
    14, y + 16,
  );
  if (kind === 'transcript') {
    pdf.text(input.certificate ? `Certificate ${input.certificate.serial ?? ''} issued ${formatDateKey(input.certificate.issuedOn)}.` : `Status: ${s.status}. No certificate issued yet.`, 14, y + 22);
  }
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Grades: ' + input.settings.gradingScale.map((b) => `${b.grade} ${b.min}%+`).join(', '), 14, h - 20);
  pdf.text('Not valid without the school stamp.', 14, h - 14);
  return file(pdf, `${kind === 'report_card' ? 'Report card' : 'Transcript'} ${s.name}.pdf`);
}

export interface StatementInput {
  student: StudentIdentity;
  invoices: { label: string; dueDate: string | null; totalCents: number; status: string }[];
  gifts: Gift[];
  balanceCents: number;
  /** Total paid, shown when the individual payments can't be read by the person making this. */
  paidCents: number;
  today: string;
}

export async function feeStatementPdf(org: Organization, input: StatementInput): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const currency = org.currency || 'KES';
  header(pdf, org, 'Fee statement');
  let y = titleBlock(pdf, [
    ['Student', input.student.name], ['Admission number', input.student.admissionNo || 'Not yet issued'],
    ['Department', input.student.course], ['Statement date', formatDateKey(input.today)],
  ]);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  pdf.text('Billed', 14, y);
  y += 6;
  const bills = input.invoices.filter((i) => i.status !== 'void');
  y = drawTable(pdf, y, [{ label: 'Bill', x: 14 }, { label: 'Due', x: 120 }, { label: 'Amount', x: w - 14, align: 'right' }],
    bills.map((i) => [i.label, i.dueDate ? formatDateKey(i.dueDate) : '–', formatMoney(i.totalCents, currency)]), h - 60);
  y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  pdf.text('Paid', 14, y);
  y += 6;
  const paid = input.gifts.filter((g) => g.status === 'confirmed').sort((a, b) => a.date.localeCompare(b.date));
  y = drawTable(pdf, y, [{ label: 'Date', x: 14 }, { label: 'Receipt', x: 44 }, { label: 'Payment', x: 100 }, { label: 'Amount', x: w - 14, align: 'right' }],
    paid.map((g) => [formatDateKey(g.date), receiptNumberFor(org, g), paymentLabel(g), formatMoney(g.amountCents, currency)]), h - 40);
  if (!paid.length) {
    pdf.setTextColor(...GREY);
    pdf.text(input.paidCents > 0 ? `Total paid to date: ${formatMoney(input.paidCents, currency)}` : 'No payments recorded yet.', 14, y);
    y += 6;
  }
  y += 6;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, y - 4, w - 14, y - 4);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(...INK);
  pdf.text(input.balanceCents > 0 ? 'Balance to pay' : input.balanceCents < 0 ? 'Paid ahead' : 'Balance', 100, y + 2);
  pdf.text(formatMoney(Math.abs(input.balanceCents), currency), w - 14, y + 2, { align: 'right' });
  return file(pdf, `Fee statement ${input.student.name}.pdf`);
}

/** The director's weekly or monthly school report. */
export async function schoolReportPdf(org: Organization, r: SchoolReportDoc): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const currency = org.currency || 'KES';
  const m = r.metrics;
  header(pdf, org, `${r.type === 'weekly' ? 'Weekly' : 'Monthly'} school report: ${r.label}`);
  const pc = (v: number | null) => (v == null ? '–' : `${v}%`);
  let y = 38;
  const section = (title: string) => {
    if (y > h - 40) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...INK);
    pdf.text(title, 14, y);
    y += 7;
  };
  section('The numbers');
  y = drawTable(pdf, y, [{ label: 'Measure', x: 14 }, { label: 'Value', x: w - 14, align: 'right' }], [
    ['Students enrolled', String(m.enrolled)], ['Withdrawn', String(m.withdrawn)], ['Retention', pc(m.retentionRate)],
    ['Attendance rate', pc(m.attendanceRate)], ['Students below the attendance threshold', String(m.belowThreshold)], ['Pass rate', pc(m.passRate)],
    ['Fees billed', formatMoney(m.billedCents, currency)], ['Fees paid', formatMoney(m.paidCents, currency)], ['Arrears', formatMoney(m.arrearsCents, currency)],
    ['Fee collection rate', pc(m.collectionRate)], ['Graduation rate', pc(m.graduationRate)], ['Graduates working at 6 months', pc(m.employmentRate)],
  ], h - 30);
  y += 4;
  section('By programme');
  y = drawTable(pdf, y, [{ label: 'Department', x: 14 }, { label: 'Students', x: 120, align: 'right' }, { label: 'Trainers', x: 145, align: 'right' }, { label: 'Students per trainer', x: w - 14, align: 'right' }],
    m.byCourse.map((c) => [c.name, String(c.enrolled), String(c.trainers), c.ratio == null ? '–' : String(c.ratio)]), h - 30);
  y += 4;
  section('Attendance alerts');
  y = r.alerts.length
    ? drawTable(pdf, y, [{ label: 'Student', x: 14 }, { label: 'Department', x: 90 }, { label: 'Attendance', x: w - 14, align: 'right' }], r.alerts.map((a) => [a.name, a.course, `${a.percent}% of ${a.held}`]), h - 30)
    : (pdf.setFont('helvetica', 'normal'), pdf.setFontSize(9), pdf.setTextColor(...GREY), pdf.text('Nobody is below the threshold.', 14, y), y + 6);
  y += 4;
  section('Fee arrears');
  y = r.arrears.length
    ? drawTable(pdf, y, [{ label: 'Student', x: 14 }, { label: 'Department', x: 90 }, { label: 'Balance', x: w - 14, align: 'right' }], r.arrears.map((a) => [`${a.name}${a.overdue ? ' (overdue)' : ''}`, a.course, formatMoney(a.balanceCents, currency)]), h - 30)
    : (pdf.setFont('helvetica', 'normal'), pdf.setFontSize(9), pdf.setTextColor(...GREY), pdf.text('No fees are owed.', 14, y), y + 6);
  if (r.outcomesDue.length) {
    y += 4;
    section('Graduate follow-ups due');
    drawTable(pdf, y, [{ label: 'Graduate', x: 14 }, { label: 'Check', x: 110 }, { label: 'Due', x: w - 14, align: 'right' }], r.outcomesDue.map((o) => [o.name, `${o.months} months`, formatDateKey(o.due)]), h - 30);
  }
  return file(pdf, `School report ${r.label}.pdf`);
}

export function csvFile(name: string, rows: (string | number | null | undefined)[][]): File {
  const cell = (v: string | number | null | undefined) => {
    const t = String(v ?? '');
    // A leading = + - @ would run as a formula in Excel, so it is made plain text.
    const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return new File(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], name, { type: 'text/csv' });
}

export const outcomeLabel = (s: string | null | undefined) => (s ? OUTCOME_LABELS[s as keyof typeof OUTCOME_LABELS] ?? s : 'Not yet recorded');
