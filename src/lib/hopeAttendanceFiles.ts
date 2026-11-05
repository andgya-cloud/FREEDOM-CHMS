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
