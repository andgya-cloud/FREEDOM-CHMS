import writeXlsxFile from 'write-excel-file';
import type { jsPDF as JsPdf } from 'jspdf';
import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { DAY_NAMES, DAY_SHORT, periodText, slotKey, type ClassTimetable, type SchoolEntry, type WholeSchool } from '../../functions/src/shared/timetable';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The ADIA letterhead band; returns where the page's content starts. */
async function letterhead(pdf: JsPdf, title: string, sub: string) {
  const w = pdf.internal.pageSize.getWidth();
  const img = await crestImage();
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, w, 30, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(0, 30, w, 1.6, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(...GOLD);
  pdf.setLineWidth(0.9);
  pdf.circle(24, 15, 10, 'FD');
  if (img) pdf.addImage(img, 'PNG', 17.5, 8.5, 13, 13);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('ADIA Training Centre', 40, 13.5);
  pdf.setTextColor(...GOLD);
  pdf.setFontSize(9);
  pdf.setCharSpace(1.4);
  pdf.text(title.toUpperCase(), 40, 21);
  pdf.setCharSpace(0);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...INK);
  pdf.text(sub, 14, 39);
  return 45;
}

export interface ClassInfo { cohort: string; department: string; semester: number; status: string }
const className = (i: ClassInfo, ext: string) => `Class-timetable-${safe(i.cohort)}-${safe(i.department)}-Sem-${i.semester}.${ext}`;
const classTitle = (i: ClassInfo) => `Class timetable · ${i.cohort} · ${i.department} · Semester ${i.semester}`;

/** 12A: the weekly grid on the letterhead, landscape. */
export async function classTimetablePdf(info: ClassInfo, t: ClassTimetable): Promise<File> {
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  let y = await letterhead(pdf, classTitle(info), info.status);
  const days = t.saturday ? 6 : 5;
  const left = 14, timeW = 26;
  const colW = (w - 28 - timeW) / days;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  for (let d = 0; d < days; d++) pdf.text(DAY_NAMES[d]!.toUpperCase(), left + timeW + d * colW + colW / 2, y, { align: 'center' });
  y += 3;
  t.periods.forEach((p, i) => {
    if (p.isBreak) {
      pdf.setFillColor(246, 240, 226);
      pdf.rect(left, y, w - 28, 6, 'F');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(...GREY);
      pdf.text(`${(p.label || 'Break').toUpperCase()} · ${periodText(p)}`, w / 2, y + 4.1, { align: 'center' });
      y += 7.5;
      return;
    }
    const h = 19;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK);
    pdf.text(periodText(p), left, y + 5);
    for (let d = 0; d < days; d++) {
      const x = left + timeW + d * colW;
      const s = t.slots[slotKey(d, i)];
      pdf.setDrawColor(225, 222, 235);
      pdf.setLineWidth(0.25);
      if (s?.course) { pdf.setFillColor(247, 246, 252); pdf.roundedRect(x + 1, y, colW - 2, h, 2, 2, 'FD'); } else pdf.roundedRect(x + 1, y, colW - 2, h, 2, 2, 'S');
      if (!s?.course) continue;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.2);
      pdf.setTextColor(...NAVY);
      const lines = (pdf.splitTextToSize(s.course, colW - 6) as string[]).slice(0, 2);
      lines.forEach((l, k) => pdf.text(l, x + 3, y + 4.6 + k * 3.4));
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.2);
      pdf.setTextColor(...GREY);
      const top = y + 4.6 + lines.length * 3.4 + 0.6;
      if (s.lecturer) pdf.text((pdf.splitTextToSize(s.lecturer, colW - 6) as string[])[0] ?? '', x + 3, top);
      if (s.room) pdf.text((pdf.splitTextToSize(s.room, colW - 6) as string[])[0] ?? '', x + 3, top + 3.2);
    }
    y += h + 2;
  });
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], className(info, 'pdf'), { type: 'application/pdf' });
}

export async function classTimetableWorkbook(info: ClassInfo, t: ClassTimetable): Promise<File> {
  const days = t.saturday ? 6 : 5;
  const head = ['Time', ...DAY_SHORT.slice(0, days)].map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = t.periods.map((p, i) => [
    { value: p.isBreak ? `${p.label || 'Break'} ${periodText(p)}` : periodText(p), type: String },
    ...Array.from({ length: days }, (_, d) => {
      const s = t.slots[slotKey(d, i)];
      return { value: p.isBreak ? '' : s?.course ? [s.course, s.lecturer, s.room].filter(Boolean).join(' · ') : '', type: String };
    }),
  ]);
  const top = [[{ value: `ADIA Training Centre · ${classTitle(info)}`, fontWeight: 'bold' as const }], [{ value: info.status, type: String }], []];
  const blob = await writeXlsxFile([...top, head, ...body] as never, { columns: [18, ...Array(days).fill(34)].map((width) => ({ width })), sheet: 'Timetable' } as never) as unknown as Blob;
  return new File([blob], className(info, 'xlsx'), { type: XLSX });
}

/** The whole school for one cohort and semester (Andy, 2026-11-20, 14A), laid out as ADIA's printed timetables. */
export interface SchoolInfo { cohort: string; semester: number; status: string }
const schoolName = (i: SchoolInfo, ext: string) => `Whole-school-timetable-${safe(i.cohort)}-Sem-${i.semester}.${ext}`;
const schoolTitle = (i: SchoolInfo) => `Semester ${i.semester === 1 ? 'I' : 'II'} academic timetable · ${i.cohort}`;
export const entryText = (e: SchoolEntry) => (e.common ? e.course.toUpperCase() : `${e.title.toUpperCase()}${e.course ? ` (${e.course})` : ''}`);

export async function wholeSchoolPdf(info: SchoolInfo, g: WholeSchool): Promise<File> {
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  let y = await letterhead(pdf, schoolTitle(info), info.status);
  const left = 14, dayW = 30;
  const colW = (w - 28 - dayW) / Math.max(1, g.times.length);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...GREY);
  pdf.text('DAY / TIME', left, y);
  g.times.forEach((t, i) => pdf.text(periodText(t), left + dayW + i * colW + colW / 2, y, { align: 'center' }));
  y += 3;
  for (let d = 0; d < g.days; d++) {
    const lists = g.times.map((_, i) => (g.cells[slotKey(d, i)] ?? []).map(entryText));
    const lines = lists.map((l) => l.flatMap((e) => (pdf.splitTextToSize(e, colW - 6) as string[])));
    const h = Math.max(16, 6 + Math.max(...lines.map((l) => l.length)) * 3.8);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(...NAVY);
    pdf.text(DAY_NAMES[d]!.toUpperCase(), left, y + 6);
    g.times.forEach((_, i) => {
      const x = left + dayW + i * colW;
      pdf.setDrawColor(225, 222, 235);
      pdf.setLineWidth(0.25);
      pdf.roundedRect(x + 1, y, colW - 2, h, 2, 2, 'S');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.2);
      pdf.setTextColor(...INK);
      if (!lines[i]!.length) { pdf.setTextColor(...GREY); pdf.text('—', x + colW / 2, y + 6, { align: 'center' }); return; }
      lines[i]!.forEach((l, k) => pdf.text(l, x + 3, y + 5 + k * 3.8));
    });
    y += h + 2;
    if (y > pdf.internal.pageSize.getHeight() - 20 && d < g.days - 1) { pdf.addPage(); y = 20; }
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], schoolName(info, 'pdf'), { type: 'application/pdf' });
}

export async function wholeSchoolWorkbook(info: SchoolInfo, g: WholeSchool): Promise<File> {
  const head = ['Day / time', ...g.times.map((t) => periodText(t))].map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = Array.from({ length: g.days }, (_, d) => [
    { value: DAY_NAMES[d]!, type: String },
    ...g.times.map((_, i) => ({ value: (g.cells[slotKey(d, i)] ?? []).map(entryText).join('\n'), type: String, wrap: true })),
  ]);
  const top = [[{ value: `ADIA Training Centre · ${schoolTitle(info)}`, fontWeight: 'bold' as const }], [{ value: info.status, type: String }], []];
  const blob = await writeXlsxFile([...top, head, ...body] as never, { columns: [16, ...g.times.map(() => 42)].map((width) => ({ width })), sheet: 'Whole school' } as never) as unknown as Blob;
  return new File([blob], schoolName(info, 'xlsx'), { type: XLSX });
}

export interface ExamLine { date: string; time: string; course: string; department: string; room: string; invigilator: string }
export interface ExamInfo { cohort: string; name: string; status: string }
const examName = (i: ExamInfo, ext: string) => `Exam-timetable-${safe(i.cohort)}-${safe(i.name)}.${ext}`;

export async function examTimetablePdf(info: ExamInfo, lines: ExamLine[]): Promise<File> {
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const HEAD = ['Date', 'Time', 'Course', 'Department', 'Room', 'Invigilator'];
  const xs = [14, 62, 96, 170, 214, 244];
  const top = async () => {
    let y = await letterhead(pdf, `Exam timetable · ${info.cohort} · ${info.name}`, info.status);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    HEAD.forEach((c, i) => pdf.text(c.toUpperCase(), xs[i]!, y));
    y += 6;
    return y;
  };
  let y = await top();
  let lastDate = '';
  for (const l of lines) {
    if (y > h - 22) { pdf.addPage(); y = await top(); lastDate = ''; }
    pdf.setFont('helvetica', l.date !== lastDate ? 'bold' : 'normal');
    pdf.setFontSize(8.8);
    pdf.setTextColor(...INK);
    const cells = [l.date === lastDate ? '' : l.date, l.time, l.course, l.department, l.room, l.invigilator];
    cells.forEach((c, i) => { if (i === 1) pdf.setFont('helvetica', 'normal'); pdf.text((pdf.splitTextToSize(c || (i === 0 ? '' : '–'), (xs[i + 1] ?? w - 14) - xs[i]! - 2) as string[])[0] ?? '', xs[i]!, y); });
    lastDate = l.date;
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, y + 2.2, w - 14, y + 2.2);
    y += 7;
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], examName(info, 'pdf'), { type: 'application/pdf' });
}

export async function examTimetableWorkbook(info: ExamInfo, lines: ExamLine[]): Promise<File> {
  const head = ['Date', 'Time', 'Course', 'Department', 'Room', 'Invigilator'].map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = lines.map((l) => [l.date, l.time, l.course, l.department, l.room, l.invigilator].map((value) => ({ value, type: String })));
  const top = [[{ value: `ADIA Training Centre · Exam timetable · ${info.cohort} · ${info.name}`, fontWeight: 'bold' as const }], [{ value: info.status, type: String }], []];
  const blob = await writeXlsxFile([...top, head, ...body] as never, { columns: [18, 16, 30, 24, 16, 24].map((width) => ({ width })), sheet: 'Exams' } as never) as unknown as Blob;
  return new File([blob], examName(info, 'xlsx'), { type: XLSX });
}
