import writeXlsxFile from 'write-excel-file';
import type { Organization } from '../state/OrgContext';
import { header, newPdf, GREY, INK } from './givingPdf';
import { stampPoweredBy, POWERED_BY } from '../../functions/src/shared/poweredBy';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { KID_MARK_LABELS, type KidEntry } from '../../functions/src/shared/hopeRegister';

/** One child's line on a register day. */
export interface DayLine { name: string; code: string; entry: KidEntry | null }
type Cell = { value: string | number | null; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold' } | null;
const text = (value: string): Cell => ({ value, type: String });
const bold = (value: string): Cell => ({ value, type: String, fontWeight: 'bold' });
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const here = (e: KidEntry | null) => e?.s === 'present' || e?.s === 'departing';
const markText = (e: KidEntry | null) => (e ? KID_MARK_LABELS[e.s] : 'Not marked');

/** A register day as a PDF (2A): counts, then everyone who came with the time, then absent and excused. */
export async function attendanceDayPdf(org: Organization, date: string, lines: DayLine[]): Promise<File> {
  const pdf = await newPdf('a4');
  const h = pdf.internal.pageSize.getHeight();
  header(pdf, org, `Children's attendance · ${formatDateKey(date)}`);
  const came = lines.filter((l) => here(l.entry));
  const absent = lines.filter((l) => l.entry?.s === 'absent');
  const excused = lines.filter((l) => l.entry?.s === 'excused');
  let y = 38;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...GREY);
  pdf.text(`${came.length} came · ${absent.length} absent · ${excused.length} excused`, 14, y);
  y += 8;
  const section = (title: string, rows: DayLine[], detail: (l: DayLine) => string) => {
    if (!rows.length) return;
    if (y > h - 30) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...INK);
    pdf.text(`${title} (${rows.length})`, 14, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
    rows.forEach((l, i) => {
      if (y > h - 20) { pdf.addPage(); y = 20; }
      pdf.setTextColor(...GREY); pdf.text(String(i + 1), 14, y);
      pdf.setTextColor(...INK); pdf.text(l.name, 22, y);
      pdf.setTextColor(...GREY); pdf.text(l.code, 110, y); pdf.text(detail(l), 135, y);
      y += 5.2;
    });
    y += 4;
  };
  section('Came', came, (l) => (l.entry?.t ? `Arrived ${l.entry.t}` : 'Here'));
  section('Absent', absent, () => 'Absent');
  section('Excused', excused, (l) => l.entry?.r || 'Excused');
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `Attendance-${date}.pdf`, { type: 'application/pdf' });
}

/** A register day as an Excel sheet. */
export async function attendanceDayExcel(org: Organization, date: string, lines: DayLine[]): Promise<File> {
  const rows: Cell[][] = [[bold(`${org.name} · Children's attendance · ${formatDateKey(date)}`)], [],
    [bold('Name'), bold('Code'), bold('Mark'), bold('Arrived'), bold('Reason')],
    ...lines.map((l) => [text(l.name), text(l.code), text(markText(l.entry)), text(l.entry?.t ?? ''), text(l.entry?.r ?? '')]),
    [], [text(POWERED_BY)]];
  const blob = await writeXlsxFile(rows as never, { columns: [32, 12, 14, 10, 30].map((width) => ({ width })) } as never) as unknown as Blob;
  return new File([blob], `${safe(org.name)}-attendance-${date}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** A month as one Excel grid: a row per child, a column per register day, P/A/E and the totals. */
export async function attendanceMonthExcel(org: Organization, month: string, label: string, dates: string[], children: { name: string; code: string; marks: (KidEntry | null)[] }[]): Promise<File> {
  const short = (e: KidEntry | null) => (!e ? '' : here(e) ? 'P' : e.s === 'absent' ? 'A' : e.s === 'excused' ? 'E' : '');
  const rows: Cell[][] = [[bold(`${org.name} · Children's attendance · ${label}`)], [text('P = came, A = absent, E = excused')], [],
    [bold('Name'), bold('Code'), ...dates.map((d) => bold(formatDateKey(d))), bold('Came'), bold('Absent')],
    ...children.map((c) => [text(c.name), text(c.code), ...c.marks.map((m) => text(short(m))),
      { value: c.marks.filter(here).length, type: Number }, { value: c.marks.filter((m) => m?.s === 'absent').length, type: Number }] as Cell[]),
    [bold('Total came'), null, ...dates.map((_, i) => ({ value: children.filter((c) => here(c.marks[i] ?? null)).length, type: Number }) as Cell)],
    [], [text(POWERED_BY)]];
  const blob = await writeXlsxFile(rows as never, { columns: [32, 12, ...dates.map(() => 12), 8, 8].map((width) => ({ width })) } as never) as unknown as Blob;
  return new File([blob], `${safe(org.name)}-attendance-${month}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The children list (Andy, 2026-11-05, v173 7A): one row per current child, for the Director, Andy and Doreen. */
export async function childrenListExcel(org: Organization, today: string, children: { code: string; name: string; gender: string; dob: string; age: string; school: string; cls: string; parent: string; phone: string; sponsor: string; consent: string; status: string }[]): Promise<File> {
  const head = ['Code', 'Name', 'Gender', 'Date of birth', 'Age', 'School', 'Class', 'Parent', "Parent's contact", 'Sponsor', 'Consent', 'Status'];
  const rows: Cell[][] = [[bold(`${org.name} · Children · ${formatDateKey(today)}`)], [],
    head.map(bold),
    ...children.map((c) => [c.code, c.name, c.gender, c.dob, c.age, c.school, c.cls, c.parent, c.phone, c.sponsor, c.consent, c.status].map(text)),
    [], [text(`${children.length} children`)], [text(POWERED_BY)]];
  const blob = await writeXlsxFile(rows as never, { columns: [10, 30, 9, 13, 6, 26, 10, 26, 16, 24, 12, 10].map((width) => ({ width })) } as never) as unknown as Blob;
  return new File([blob], `${safe(org.name)}-children-${today}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * QR check-in cards (Andy, 2026-11-05, v173 12A): twelve cards to an A4 page, each with the child's QR code (their HC
 * code), name and code. Cut them out; at the door the phone's camera reads the card and checks the child in.
 */
export async function qrCardsPdf(org: Organization, children: { name: string; code: string }[]): Promise<File> {
  const { default: QRCode } = await import('qrcode');
  const pdf = await newPdf('a4');
  const W = pdf.internal.pageSize.getWidth();
  const cols = 3, rows = 4, mx = 10, my = 12;
  const cw = (W - mx * 2) / cols, ch = 66;
  for (let i = 0; i < children.length; i++) {
    const k = i % (cols * rows);
    if (i > 0 && k === 0) pdf.addPage();
    const c = children[i]!;
    const x = mx + (k % cols) * cw, y = my + Math.floor(k / cols) * ch;
    pdf.setDrawColor(200, 200, 200); pdf.setLineDashPattern([1, 1], 0); pdf.rect(x + 1, y + 1, cw - 2, ch - 2);
    const img = await QRCode.toDataURL(c.code, { margin: 1, width: 300, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } });
    const q = 38;
    pdf.addImage(img, 'PNG', x + (cw - q) / 2, y + 4, q, q);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(c.name, cw - 8).slice(0, 2), x + cw / 2, y + q + 9, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GREY);
    pdf.text(`${c.code} · ${org.name}`.slice(0, 48), x + cw / 2, y + ch - 6, { align: 'center' });
  }
  pdf.setLineDashPattern([], 0);
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${safe(org.name)}-check-in-cards.pdf`, { type: 'application/pdf' });
}
