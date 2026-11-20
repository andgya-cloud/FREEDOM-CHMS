import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, unitTotal, type ExamReport, type ExamSettings, type ExamWeights, type ReportRow, type StudentMarks } from '../../functions/src/shared/exams';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import type { CourseLine, FinalResult, SemesterScore } from '../../functions/src/shared/examResults';

const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const GOLD_SOFT: [number, number, number] = [246, 236, 212];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];

const fmt = (v: number | string | null | undefined) => (v == null ? '–' : String(v));

/**
 * ADIA result slips on the navy and gold letterhead, one A4 page per student, for a whole report or
 * one student. Built on the device, so it works offline.
 */
export async function resultSlipsPdf(opts: { cohort: string; reportTitle: string; report: ExamReport; rows: ReportRow[]; settings: ExamSettings }): Promise<File> {
  const { cohort, reportTitle, report, rows, settings } = opts;
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const outOf = report.rows.filter((r) => r.average != null).length;

  rows.forEach((row, n) => {
    if (n > 0) pdf.addPage();
    // Letterhead.
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, w, 36, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(0, 36, w, 1.8, 'F');
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.circle(26, 18, 12, 'FD');
    if (img) pdf.addImage(img, 'PNG', 18, 10, 16, 16);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('ADIA Training Centre', 44, 16);
    pdf.setTextColor(...GOLD);
    pdf.setFontSize(9);
    pdf.setCharSpace(1.6);
    // Not every course approved yet: the slip says so (Andy, 2026-10-24).
    pdf.text(row.provisional ? 'STUDENT RESULT SLIP · PROVISIONAL' : 'STUDENT RESULT SLIP', 44, 23);
    pdf.setCharSpace(0);
    pdf.setTextColor(220, 224, 235);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${cohort} · ${reportTitle}`, 44, 29.5);

    // Student panel.
    let y = 46;
    pdf.setFillColor(...GOLD_SOFT);
    pdf.rect(14, y - 5, w - 28, 22, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(14, y - 5, 1.2, 22, 'F');
    const who: [string, string][] = [['NAME', row.name], ['ADMISSION NO.', row.admissionNo || '–'], ['PROGRAMME', row.programme || '–'],
      ['POSITION', row.position == null ? '–' : `${row.position} of ${outOf}`], ['ATTENDANCE', row.attendance == null ? '–' : `${row.attendance}%`], ['AVERAGE', row.average == null ? '–' : `${row.average}%`]];
    const cw = (w - 34) / 3;
    who.forEach(([k, v], i) => {
      const x = 18 + (i % 3) * cw;
      const yy = y + Math.floor(i / 3) * 10;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(138, 109, 44);
      pdf.text(k, x, yy);
      pdf.setFontSize(9.5);
      pdf.setTextColor(...NAVY);
      pdf.text(pdf.splitTextToSize(v, cw - 3)[0] as string, x, yy + 4.2);
    });
    y += 26;

    // Units table.
    const cols = [{ t: 'Course', x: 14 }, { t: 'Trainer', x: 70 }, ...EXAM_COMPONENTS.map((c, i) => ({ t: EXAM_COMPONENT_LABELS[c], x: 110 + i * 15 })), { t: 'Total', x: 170 }, { t: 'Grade', x: 184 }];
    pdf.setFillColor(...NAVY);
    pdf.rect(14, y - 4.5, w - 28, 7, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    for (const c of cols) pdf.text(c.t, c.x + 1, y);
    y += 7;
    let lastCommon = false;
    for (const u of report.units) {
      if (u.common && !lastCommon) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.setTextColor(138, 109, 44);
        pdf.text('COMMON COURSES', 15, y);
        y += 5;
        lastCommon = true;
      }
      const c = row.cells[u.sheetId];
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(u.courseName, 54)[0] as string, 15, y);
      pdf.text(pdf.splitTextToSize(u.teacherName, 38)[0] as string, 71, y);
      EXAM_COMPONENTS.forEach((k, i) => pdf.text(u.weights[k].wt > 0 ? `${fmt(c?.[k])}/${u.weights[k].max}` : '–', 111 + i * 15, y));
      pdf.setFont('helvetica', 'bold');
      pdf.text(c?.exempt ? 'EX' : c?.total == null ? (c?.partial != null ? `(${c.partial})` : '–') : `${c.total}${c.resitUsed ? ' R' : ''}`, 171, y);
      pdf.text(c?.exempt ? 'Exempt' : c?.grade || '–', 185, y);
      pdf.setDrawColor(229, 231, 235);
      pdf.setLineWidth(0.2);
      pdf.line(14, y + 2, w - 14, y + 2);
      y += 6.5;
      if (y > h - 80) break;
    }

    // Summary bar.
    y += 4;
    pdf.setFillColor(...NAVY);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.8);
    pdf.roundedRect(14, y, w - 28, 16, 2.5, 2.5, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GOLD);
    pdf.setCharSpace(1.1);
    pdf.text('AVERAGE', 20, y + 6.5);
    pdf.text('GRADE', 80, y + 6.5);
    pdf.text('POSITION', 140, y + 6.5);
    pdf.setCharSpace(0);
    pdf.setFontSize(12.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(row.average == null ? '–' : `${row.average}%`, 20, y + 12.5);
    pdf.text(row.grade || '–', 80, y + 12.5);
    pdf.text(row.position == null ? '–' : `${row.position} of ${outOf}`, 140, y + 12.5);
    y += 24;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...NAVY);
    pdf.text('Remarks', 14, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(row.remarks || '–', w - 50), 36, y);
    y += 8;
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    pdf.text(`Pass mark ${settings.passMark}%. Grades: ${bandsText(settings)}. A total in brackets is not final: some papers are not yet marked. ABS is absent (0); EX is exempt; R is a resit, capped at the pass mark.${row.provisional ? ' Provisional: not every course is approved by the principal yet.' : ''}`, 14, y, { maxWidth: w - 28 });

    // Signatures.
    const sy = h - 34;
    pdf.setDrawColor(...GREY);
    pdf.setLineWidth(0.3);
    pdf.line(14, sy, 84, sy);
    pdf.line(w - 84, sy, w - 14, sy);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(...NAVY);
    pdf.text(settings.principalName, 14, sy + 5);
    pdf.text(settings.directorName, w - 84, sy + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...GREY);
    pdf.text(settings.principalTitle, 14, sy + 9.5);
    pdf.text(settings.directorTitle, w - 84, sy + 9.5);
    pdf.text('Computer-generated result slip', w / 2, h - 10, { align: 'center' });
    pdf.setFillColor(...GOLD);
    pdf.rect(0, h - 4, w, 4, 'F');
  });

  const safe = (rows.length === 1 ? rows[0]!.name : reportTitle).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `Result-Slip-${cohort.replace(/[^A-Za-z0-9]+/g, '-')}-${safe}.pdf`, { type: 'application/pdf' });
}

/** "Distinction 79 and above, Credit above 59 to below 79, Pass 39 to 59, Fail below 39" from the bands. */
export function bandsText(settings: Pick<ExamSettings, 'bands'>) {
  const b = [...settings.bands].sort((x, y) => y.min - x.min);
  // Whole-number bands read as ranges, as the transcripts print them: "A 79–100, B 69–78, … E 0–38".
  if (b.every((x) => Number.isInteger(x.min))) return b.map((band, i) => `${band.grade} ${band.min}–${i === 0 ? 100 : b[i - 1]!.min - 1}`).join(', ');
  // A minimum of 59.01 means "above 59" (Andy's table, 2026-10-24).
  const above = (n: number) => Math.round(n * 100) % 100 === 1 && n % 1 !== 0;
  const show = (n: number) => String(Math.round(n * 100) / 100);
  return b.map((band, i) => {
    if (i === 0) return `${band.grade} ${show(band.min)} and above`;
    const prev = b[i - 1]!.min;
    const upper = above(prev) ? show(Math.floor(prev)) : `below ${show(prev)}`;
    if (band.min <= 0) return `${band.grade} below ${show(above(prev) ? Math.floor(prev) : prev)}`;
    return `${band.grade} ${above(band.min) ? `above ${show(Math.floor(band.min))}` : show(band.min)} to ${upper}`;
  }).join(', ');
}

export interface TranscriptSemester { label: string; points: number | null; partial: number | null; grade: string; source: string; courses: CourseLine[] }
export interface Transcript {
  name: string; admissionNo: string; programme: string; cohort: string; semesters: TranscriptSemester[]; final: FinalResult; printed: SemesterScore | null; notes: string[];
  /** Added for the Students transcripts section (Andy, 2026-11-19, 6A-8A). */
  serial?: string; verify?: string; attendance?: number | null; nita?: string; dates?: string; provisional?: boolean; issuedOn?: string;
  /** Industrial attachment mark and grade, e.g. "78 · B" (Andy, 2026-11-19, 7A). */
  attachment?: string;
  /** ADIA's layout (Andy, 2026-11-20, Stage 2): "ATC-2508", "HOSPITALITY", "AUGUST 2025", "DECEMBER 2026", "11-12-2026". */
  atc?: string; department?: string; admittedOn?: string; completedOn?: string; graduatedOn?: string;
  /** Hours covered in Semester I and II, and the attachment's hours when it is on the Semester II page. */
  hours?: [number | null, number | null]; attachmentHours?: number | null;
  /** Printed beside the Registrar line: the date the transcript is printed, "20-11-2026". */
  printedOn?: string;
}

/** The figure a semester shows: its points, or a running figure while marks are still coming in. */
export const semesterPointsText = (sem: Pick<TranscriptSemester, 'points' | 'partial'>) => (sem.points != null ? sem.points.toFixed(2) : sem.partial != null ? `(${sem.partial.toFixed(2)}) so far` : '–');
/** A unit's grade on the transcript: the letter once its total is in. */
export const unitGradeText = (c: Pick<CourseLine, 'total'>, settings: Pick<ExamSettings, 'bands'>) => (c.total == null ? '–' : gradeFor(c.total, settings).grade);
/** What the transcript prints for a semester whose results came from the past-results upload (Stage 2, 4A). */
export const PAST_ONLY_NOTE = 'Unit grades held on the college file.';
export const SEAL_NOTE = ['This Transcript is issued without any alterations whatsoever and is only valid with the College Seal', 'Any queries relating to this document should be addressed to the Academic Registrar'];

/**
 * Academic transcripts in ADIA's own layout (Andy, 2026-11-20, Stage 2: 1A+B 2A 3A 4A), one A4 page per
 * semester as on the Cohort 2 transcripts: the ATC number, the letterhead, the student's details with
 * cumulative points and Honours, each unit's code, description, credit and grade, the semester's points and
 * award, the grading system, hours covered, the Registrar's line with the date and name, and the seal note.
 * The app adds the serial number and QR check code, and Powered by Insight-IQ.
 */
export async function transcriptsPdf(opts: { transcripts: Transcript[]; settings: ExamSettings; title: string }): Promise<File> {
  const { transcripts, settings, title } = opts;
  const pdf = await newPdf('a4');
  const QRCode = transcripts.some((t) => t.verify) ? (await import('qrcode')).default : null;
  const qrs = await Promise.all(transcripts.map((t) => (QRCode && t.verify ? QRCode.toDataURL(t.verify, { margin: 0, width: 260, errorCorrectionLevel: 'M' }) : Promise.resolve(''))));
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const L = 20, R = w - 20;
  const ROMAN = ['I', 'II'];
  let first = true;
  transcripts.forEach((t, n) => {
    t.semesters.forEach((sem, si) => {
      if (!first) pdf.addPage();
      first = false;
      pdf.setTextColor(...NAVY);
      // The ATC number at the top right, the crest and letterhead in the middle.
      if (t.atc) { pdf.setFont('times', 'bold'); pdf.setFontSize(11); pdf.text(t.atc, R, 16, { align: 'right' }); }
      if (img) pdf.addImage(img, 'PNG', w / 2 - 9, 9, 18, 18);
      pdf.setFont('times', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(...GOLD);
      pdf.setCharSpace(3);
      pdf.text('A D I A', w / 2, 33, { align: 'center' });
      pdf.setCharSpace(0.8);
      pdf.setFontSize(9);
      pdf.text('TRAINING CENTRE', w / 2, 38, { align: 'center' });
      pdf.setCharSpace(0);
      pdf.setTextColor(...NAVY);
      pdf.setFontSize(10);
      pdf.text('P.O. BOX 22870-00100 NAIROBI', w / 2, 44, { align: 'center' });
      pdf.setFont('times', 'normal');
      pdf.setFontSize(9);
      pdf.text('TEL: +254 105 086 218  —  E-MAIL: info@adiaempowerment.org', w / 2, 49, { align: 'center' });
      pdf.setFont('times', 'bold');
      pdf.setFontSize(14);
      pdf.text('ACADEMIC TRANSCRIPT', w / 2, 59, { align: 'center' });

      // The student's details, two to a line.
      let y = 69;
      const field = (label: string, value: string, x: number, width: number) => {
        pdf.setFont('times', 'bold'); pdf.setFontSize(10.5); pdf.text(`${label}:`, x, y);
        const lw = pdf.getTextWidth(`${label}:`) + 2;
        pdf.setFont('times', 'normal'); pdf.text(pdf.splitTextToSize(value || '', width - lw)[0] as string ?? '', x + lw, y);
      };
      const mid = w / 2 + 4;
      field('NAME', t.name.toUpperCase(), L, mid - L - 4); field('ADMISSION NUMBER', t.admissionNo, mid, R - mid); y += 8;
      field('DEPARTMENT', (t.department || t.programme).toUpperCase(), L, R - L); y += 8;
      field('ADMITTED ON', t.admittedOn ?? '', L, mid - L - 4); field('COMPLETED ON', t.completedOn ?? '', mid, R - mid); y += 8;
      field('CUMULATIVE POINTS', t.final.final == null ? '' : t.final.final.toFixed(2), L, mid - L - 4); field('GRADUATED ON', t.graduatedOn ?? '', mid, R - mid); y += 8;
      field('HONOURS', t.final.complete ? t.final.grade.toUpperCase() : '', L, R - L); y += 5;
      pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.6); pdf.line(L, y, R, y); y += 7;

      // The semester's units.
      pdf.setFont('times', 'bold'); pdf.setFontSize(11);
      pdf.text(`SEMESTER ${ROMAN[si] ?? si + 1}`, L, y); y += 6;
      const cx = { code: L, desc: L + 26, credit: 150, grade: 176 };
      pdf.setFontSize(10);
      pdf.text('CODE', cx.code, y); pdf.text('DESCRIPTION', cx.desc, y); pdf.text('CREDIT', cx.credit, y, { align: 'center' }); pdf.text('GRADE', cx.grade, y, { align: 'center' });
      y += 7;
      pdf.setFont('times', 'normal'); pdf.setFontSize(10.5);
      if (!sem.courses.length) {
        pdf.text(sem.points != null ? PAST_ONLY_NOTE : 'No results for this semester yet.', cx.desc, y); y += 7;
      }
      for (const c of sem.courses) {
        pdf.text(c.code || '', cx.code, y);
        pdf.text(pdf.splitTextToSize(c.unitName || c.courseName, cx.credit - cx.desc - 12)[0] as string, cx.desc, y);
        pdf.text(c.credit == null ? '–' : c.credit.toFixed(1), cx.credit, y, { align: 'center' });
        pdf.text(unitGradeText(c, settings), cx.grade, y, { align: 'center' });
        y += 6.6;
        if (y > h - 92) break;
      }
      y += 2;
      pdf.setFont('times', 'bold'); pdf.setFontSize(10.5);
      pdf.text(`POINTS: ${semesterPointsText(sem)}`, L, y); y += 6;
      pdf.text(`AWARD: ${sem.points != null ? sem.grade : ''}`, L, y); y += 6;
      // NITA and attendance under Semester II (Stage 2, 3A).
      if (si === t.semesters.length - 1) {
        const extra = [t.nita ? `NITA: ${t.nita}` : '', t.attendance != null ? `ATTENDANCE: ${Math.round(t.attendance)}%` : ''].filter(Boolean).join('     ');
        if (extra) { pdf.setFont('times', 'normal'); pdf.setFontSize(10); pdf.text(pdf.splitTextToSize(extra, R - L) as string[], L, y); y += 6; }
      }
      pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.6); pdf.line(L, y, R, y); y += 7;

      pdf.setFont('times', 'bold'); pdf.setFontSize(10.5);
      pdf.text('GRADING SYSTEM:', L, y); y += 5.5;
      pdf.setFontSize(10);
      const bands = [...settings.bands].sort((a, b) => b.min - a.min);
      const gx = (R - L) / Math.max(1, bands.length);
      bands.forEach((b, i) => pdf.text(`${b.grade}: ${Math.round(b.min)}-${i === 0 ? 100 : Math.round(bands[i - 1]!.min) - 1}%`, L + i * gx, y));
      y += 9;
      const hrs = t.hours?.[si];
      const att = si === 1 && sem.courses.some((c) => c.sheetId === 'attachment') && t.attachmentHours ? ` + ${t.attachmentHours} attachment` : '';
      pdf.setFontSize(10.5);
      pdf.text(`HOURS COVERED: ${hrs ?? ''}${hrs != null ? att : ''}`, L, y);

      // The Registrar's line with the date, and the name under it (Stage 2, 1A and B).
      const sy = h - 62;
      pdf.setLineDashPattern([1, 1], 0); pdf.setLineWidth(0.3);
      pdf.line(L, sy, L + 62, sy);
      pdf.setLineDashPattern([], 0);
      pdf.setFont('times', 'bold'); pdf.setFontSize(10);
      pdf.text('Registrar (Academic Affairs)', L, sy + 5);
      if (settings.registrarName) { pdf.setFont('times', 'normal'); pdf.text(settings.registrarName, L, sy + 10); }
      pdf.setFont('times', 'bold');
      pdf.text(t.printedOn ?? '', R, sy - 1.5, { align: 'right' });
      pdf.text('Date', R, sy + 5, { align: 'right' });
      pdf.setFont('times', 'bold'); pdf.setFontSize(9.5);
      pdf.text(SEAL_NOTE[0]!, w / 2, sy + 18, { align: 'center' });
      pdf.text(SEAL_NOTE[1]!, w / 2, sy + 23, { align: 'center' });

      // The app's check code and serial.
      pdf.setDrawColor(...GREY); pdf.setLineWidth(0.2); pdf.line(L, h - 33, R, h - 33);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GREY);
      const pageNo = `Page ${si + 1} of ${t.semesters.length}`;
      if (qrs[n]) {
        pdf.addImage(qrs[n]!, 'PNG', L, h - 30, 16, 16);
        const how = `Serial ${t.serial} · ${pageNo} · Scan to check this transcript is genuine, or open ${t.verify!.replace(/^https?:\/\//, '').replace(/\/[^/]+$/, '')} and enter ${t.serial} with the admission number.`;
        pdf.text(pdf.splitTextToSize(how, R - L - 22) as string[], L + 20, h - 25);
      } else pdf.text(`${pageNo} · Computer-generated transcript`, L, h - 25);
      if (t.provisional) {
        // Not final until the principal approves every result.
        const G = (pdf as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
        const set = (o: number) => (pdf as unknown as { setGState: (g: unknown) => void }).setGState(new G({ opacity: o }));
        set(0.13);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(78); pdf.setTextColor(179, 38, 30);
        pdf.text('PROVISIONAL', w / 2, h / 2 + 20, { align: 'center', angle: 30 });
        set(1);
      }
    });
  });
  stampPoweredBy(pdf);
  const safe = (transcripts.length === 1 ? transcripts[0]!.name : title).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Transcript-${safe}.pdf`, { type: 'application/pdf' });
}

/**
 * One course's marks sheet for the file (Andy, 2026-10-25, 8A): every student's CAT and Final marks, total
 * and grade, with signature lines for the trainer and the principal.
 */
export async function marksSheetPdf(opts: {
  courseName: string; programme: string; cohort: string; semester: string; teacherName: string; status: string;
  weights: ExamWeights; rows: { admissionNo: string; name: string; marks: StudentMarks | undefined; flag?: string }[]; settings: ExamSettings;
}): Promise<File> {
  const { weights, settings } = opts;
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const used = EXAM_COMPONENTS.filter((c) => weights[c].wt > 0 && weights[c].max > 0);
  // Columns: No, Adm no, Name, each paper, Total, Grade.
  const paperX = (i: number) => 100 + i * 15;
  const totalX = paperX(used.length) + 2;
  const gradeX = totalX + 16;
  const head = () => {
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, w, 36, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(0, 36, w, 1.8, 'F');
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.circle(26, 18, 12, 'FD');
    if (img) pdf.addImage(img, 'PNG', 18, 10, 16, 16);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('ADIA Training Centre', 44, 16);
    pdf.setTextColor(...GOLD);
    pdf.setFontSize(9);
    pdf.setCharSpace(1.6);
    pdf.text('MARKS SHEET', 44, 23);
    pdf.setCharSpace(0);
    pdf.setTextColor(220, 224, 235);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${opts.cohort} · ${opts.semester}`, 44, 29.5);
    let y = 46;
    pdf.setFillColor(...GOLD_SOFT);
    pdf.rect(14, y - 5, w - 28, 12, 'F');
    const who: [string, string][] = [['COURSE', opts.courseName], ['DEPARTMENT', opts.programme], ['TRAINER', opts.teacherName], ['STATUS', opts.status]];
    const cw = (w - 34) / 4;
    who.forEach(([k, v], i) => {
      const x = 18 + i * cw;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(138, 109, 44);
      pdf.text(k, x, y);
      pdf.setFontSize(9);
      pdf.setTextColor(...NAVY);
      pdf.text(pdf.splitTextToSize(v || '–', cw - 3)[0] as string, x, y + 4.2);
    });
    y += 13;
    pdf.setFillColor(...NAVY);
    pdf.rect(14, y - 4.5, w - 28, 7, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text('No', 16, y); pdf.text('Adm no', 23, y); pdf.text('Name', 52, y);
    used.forEach((c, i) => { pdf.text(EXAM_COMPONENT_LABELS[c], paperX(i), y - 1.2); pdf.setFontSize(6); pdf.text(`/${weights[c].max}`, paperX(i), y + 1.6); pdf.setFontSize(7.5); });
    pdf.text('Total', totalX, y); pdf.text('Grade', gradeX, y);
    return y + 6.5;
  };
  let y = head();
  opts.rows.forEach((r, n) => {
    if (y > h - 52) { pdf.addPage(); y = head(); }
    const t = unitTotal(weights, r.marks, settings.passMark);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK);
    pdf.text(String(n + 1), 16, y);
    pdf.text(pdf.splitTextToSize(r.admissionNo || '–', 28)[0] as string, 23, y);
    pdf.text(pdf.splitTextToSize(r.name + (r.flag ? ` (${r.flag})` : ''), 46)[0] as string, 52, y);
    used.forEach((c, i) => pdf.text(fmt(r.marks?.[c] ?? null), paperX(i), y));
    pdf.setFont('helvetica', 'bold');
    pdf.text(t.exempt ? 'EX' : t.total != null ? String(t.total) : t.partial != null ? `(${t.partial})` : '–', totalX, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(t.exempt ? 'Exempt' : t.total == null ? '–' : gradeFor(t.total, settings).grade, gradeX, y);
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, y + 2, w - 14, y + 2);
    y += 6;
  });
  pdf.setFontSize(7.5);
  pdf.setTextColor(...GREY);
  pdf.text(pdf.splitTextToSize(`ABS = absent (0). EX = exempt. A figure in brackets is a running total. Grades: ${bandsText(settings)}.`, w - 28) as string[], 14, y + 3);
  // Signatures.
  const sy = h - 30;
  pdf.setDrawColor(...GREY);
  pdf.setLineWidth(0.3);
  pdf.line(14, sy, 84, sy);
  pdf.line(w - 84, sy, w - 14, sy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(opts.teacherName, 14, sy + 5);
  pdf.text(settings.principalName, w - 84, sy + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Trainer · signature and date', 14, sy + 9.5);
  pdf.text(`${settings.principalTitle} · signature and date`, w - 84, sy + 9.5);
  pdf.setFillColor(...GOLD);
  pdf.rect(0, h - 4, w, 4, 'F');
  stampPoweredBy(pdf);
  const safe = `${opts.courseName}-${opts.cohort}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Marks-sheet-${safe}.pdf`, { type: 'application/pdf' });
}
