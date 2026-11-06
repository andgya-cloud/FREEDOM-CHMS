import writeXlsxFile from 'write-excel-file';
import type { Organization } from '../state/OrgContext';
import { header, newPdf, GREY, INK } from './givingPdf';
import { stampPoweredBy, POWERED_BY } from '../../functions/src/shared/poweredBy';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { stonePng } from './stoneImage';
import type { PayLine } from '../../functions/src/shared/hopeChampionPay';
import type { HopeClass } from '../../functions/src/shared/hopeClasses';
import { KID_MARK_LABELS, type KidEntry } from '../../functions/src/shared/hopeRegister';

/** One child's line on a register day. */
export interface DayLine { name: string; code: string; entry: KidEntry | null }
type Cell = { value: string | number | null; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold' } | null;
const text = (value: string): Cell => ({ value, type: String });
const bold = (value: string): Cell => ({ value, type: String, fontWeight: 'bold' });
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const here = (e: KidEntry | null) => e?.s === 'present' || e?.s === 'late' || e?.s === 'departing';
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
 * QR check-in cards (Andy, 2026-11-05, v173 12A, v175 3A): twelve cards to an A4 page. Each card has the child's
 * photo, QR code (their HC code), name, code, class with its stone, age, and a red allergy mark when there is one.
 * Cut them out; at the door the phone's camera reads the card and checks the child in. Child Champions' cards
 * (11A) are the same, with "Child Champion" in place of the class.
 */
export interface QrCard {
  name: string;
  code: string;
  age?: number | null;
  klass?: HopeClass | null;
  allergies?: string;
  photo?: string | null;
  /** In place of the class line, such as "Child Champion". */
  role?: string;
}
export async function qrCardsPdf(org: Organization, cards: QrCard[], fileName = 'check-in-cards'): Promise<File> {
  const { default: QRCode } = await import('qrcode');
  const pdf = await newPdf('a4');
  const W = pdf.internal.pageSize.getWidth();
  const cols = 3, rows = 4, mx = 10, my = 12;
  const cw = (W - mx * 2) / cols, ch = 66;
  for (let i = 0; i < cards.length; i++) {
    const k = i % (cols * rows);
    if (i > 0 && k === 0) pdf.addPage();
    const c = cards[i]!;
    const x = mx + (k % cols) * cw, y = my + Math.floor(k / cols) * ch;
    pdf.setDrawColor(200, 200, 200); pdf.setLineDashPattern([1, 1], 0); pdf.rect(x + 1, y + 1, cw - 2, ch - 2);
    pdf.setLineDashPattern([], 0);
    // Photo on the left, QR code on the right.
    const p = 26, q = 28, top = y + 4;
    if (c.photo) {
      try { pdf.addImage(c.photo, c.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG', x + 4, top + 1, p, p); }
      catch { /* a photo that cannot be drawn leaves the box empty */ }
    } else {
      pdf.setFillColor(240, 236, 247); pdf.rect(x + 4, top + 1, p, p, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...GREY);
      pdf.text(initials(c.name), x + 4 + p / 2, top + 1 + p / 2 + 2, { align: 'center' });
    }
    pdf.setDrawColor(210, 210, 210); pdf.rect(x + 4, top + 1, p, p);
    const img = await QRCode.toDataURL(c.code, { margin: 1, width: 300, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } });
    pdf.addImage(img, 'PNG', x + cw - q - 4, top, q, q);
    // Name, then class and age, then code.
    let ty = top + q + 6;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK);
    const nameLines = pdf.splitTextToSize(c.name, cw - 8).slice(0, 2) as string[];
    pdf.text(nameLines, x + cw / 2, ty, { align: 'center' });
    ty += nameLines.length * 4.2 + 0.6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
    const line = c.role ?? [c.klass ? c.klass.name : 'No class yet', c.age != null ? `${c.age} years` : ''].filter(Boolean).join(' · ');
    const tw = pdf.getTextWidth(line);
    const s = 4;
    if (c.klass && !c.role) {
      const [r, g, b] = rgb(c.klass.colour);
      pdf.setTextColor(r, g, b);
      try { pdf.addImage(await stonePng(c.klass), 'PNG', x + cw / 2 - (tw + s + 1) / 2, ty - 3.3, s, s); } catch { /* text only */ }
      pdf.text(line, x + cw / 2 + (s + 1) / 2, ty, { align: 'center' });
    } else {
      pdf.setTextColor(...GREY);
      pdf.text(line, x + cw / 2, ty, { align: 'center' });
    }
    if (c.allergies) {
      ty += 2;
      pdf.setFillColor(200, 30, 30); pdf.roundedRect(x + 5, ty, cw - 10, 5.2, 1, 1, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255);
      pdf.text(`! ALLERGY: ${c.allergies}`.slice(0, 44), x + cw / 2, ty + 3.7, { align: 'center' });
    }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...GREY);
    pdf.text(`${c.code} · ${org.name}`.slice(0, 48), x + cw / 2, y + ch - 4.5, { align: 'center' });
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${safe(org.name)}-${fileName}.pdf`, { type: 'application/pdf' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const MONTH_NAME = (month: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

/** Child Champions' pay for a month (Andy, 2026-11-05, 10A): weeks came × weekly amount, plus extras. */
export async function championPayPdf(org: Organization, month: string, lines: PayLine[], total: number, approved: string | null): Promise<File> {
  const pdf = await newPdf('a4');
  const h = pdf.internal.pageSize.getHeight();
  header(pdf, org, `Child Champions' pay · ${MONTH_NAME(month)}`);
  let y = 38;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...GREY);
  pdf.text(`${lines.length} champions · total ${kes(total)} · ${approved ? `Approved by ${approved}` : 'Not yet approved'}`, 14, y);
  y += 9;
  const cols: [string, number, 'left' | 'right'][] = [['Name', 14, 'left'], ['Weekly', 98, 'right'], ['Weeks', 114, 'right'], ['Late', 128, 'right'], ['Basic', 150, 'right'], ['Extra', 172, 'right'], ['Total', 196, 'right']];
  const head = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...INK);
    for (const [t, x, a] of cols) pdf.text(t, x, y, { align: a });
    y += 2; pdf.setDrawColor(220, 220, 220); pdf.line(14, y, 196, y); y += 5;
  };
  head();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
  for (const l of lines) {
    if (y > h - 24) { pdf.addPage(); y = 20; head(); pdf.setFont('helvetica', 'normal'); }
    pdf.setTextColor(...INK);
    pdf.text(l.name.slice(0, 40), 14, y);
    pdf.text(l.monthlyPay ? `${l.monthlyPay.toLocaleString('en-KE')}/mo` : l.weeklyPay.toLocaleString('en-KE'), 98, y, { align: 'right' });
    pdf.text(String(l.weeks), 114, y, { align: 'right' });
    pdf.text(String(l.late), 128, y, { align: 'right' });
    pdf.text(l.basic.toLocaleString('en-KE'), 150, y, { align: 'right' });
    pdf.text(l.extras ? l.extras.toLocaleString('en-KE') : '', 172, y, { align: 'right' });
    pdf.setFont('helvetica', 'bold'); pdf.text(l.total.toLocaleString('en-KE'), 196, y, { align: 'right' }); pdf.setFont('helvetica', 'normal');
    y += 5;
    if (l.extraReasons.length) { pdf.setFontSize(8); pdf.setTextColor(...GREY); pdf.text(`Extra: ${l.extraReasons.join('; ')}`.slice(0, 110), 18, y); pdf.setFontSize(9.5); y += 4.5; }
  }
  y += 2; pdf.line(14, y, 196, y); y += 6;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...INK);
  pdf.text('Total to pay', 14, y); pdf.text(kes(total), 196, y, { align: 'right' });
  y += 16;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...GREY);
  pdf.text('Weeks = Saturdays (or other days that week) the champion came, on time or late. Champions report at 8:30am.', 14, y);
  y += 14;
  pdf.setTextColor(...INK);
  pdf.text('Director: ____________________________   Date: ______________', 14, y);
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${safe(org.name)}-champions-pay-${month}.pdf`, { type: 'application/pdf' });
}

export async function championPayExcel(org: Organization, month: string, lines: PayLine[], total: number, approved: string | null): Promise<File> {
  const num = (n: number) => ({ type: Number, value: n });
  const rows: Cell[][] = [[bold(`${org.name} · Child Champions' pay · ${MONTH_NAME(month)}`)], [text(approved ? `Approved by ${approved}` : 'Not yet approved')], [],
    [bold('Name'), bold('Weekly amount (KES)'), bold('Weeks came'), bold('Late'), bold('Basic (KES)'), bold('Extra (KES)'), bold('Extra reason'), bold('Total (KES)')],
    ...lines.map((l) => [text(l.name), l.monthlyPay ? text(`${l.monthlyPay} a month (fixed)`) : num(l.weeklyPay), num(l.weeks), num(l.late), num(l.basic), num(l.extras), text(l.extraReasons.join('; ')), num(l.total)] as Cell[]),
    [], [bold('Total to pay'), text(''), text(''), text(''), text(''), text(''), text(''), num(total) as Cell], [], [text(POWERED_BY)]];
  const blob = await writeXlsxFile(rows as never, { columns: [30, 14, 11, 7, 12, 12, 30, 12].map((width) => ({ width })) } as never) as unknown as Blob;
  return new File([blob], `${safe(org.name)}-champions-pay-${month}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
