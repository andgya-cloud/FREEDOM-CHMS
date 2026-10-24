import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, gradeFor, type ExamReport, type ExamSettings, type ReportRow } from '../../functions/src/shared/exams';
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
export interface Transcript { name: string; admissionNo: string; programme: string; cohort: string; semesters: TranscriptSemester[]; final: FinalResult; printed: SemesterScore | null; notes: string[] }

/**
 * Full academic transcripts on the ADIA letterhead, one A4 page per student (Andy, 2026-10-24): each
 * semester with its courses (from the marks sheets) or its points (from past results), and the final
 * result, the average of the two semesters.
 */
export async function transcriptsPdf(opts: { transcripts: Transcript[]; settings: ExamSettings; title: string }): Promise<File> {
  const { transcripts, settings, title } = opts;
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  transcripts.forEach((t, n) => {
    if (n > 0) pdf.addPage();
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
    pdf.text('ACADEMIC TRANSCRIPT', 44, 23);
    pdf.setCharSpace(0);
    pdf.setTextColor(220, 224, 235);
    pdf.setFont('helvetica', 'normal');
    pdf.text(t.cohort, 44, 29.5);

    let y = 46;
    pdf.setFillColor(...GOLD_SOFT);
    pdf.rect(14, y - 5, w - 28, 12, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(14, y - 5, 1.2, 12, 'F');
    const who: [string, string][] = [['NAME', t.name], ['ADMISSION NO.', t.admissionNo || '–'], ['PROGRAMME', t.programme || '–']];
    const cw = (w - 34) / 3;
    who.forEach(([k, v], i) => {
      const x = 18 + i * cw;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(138, 109, 44);
      pdf.text(k, x, y);
      pdf.setFontSize(9.5);
      pdf.setTextColor(...NAVY);
      pdf.text(pdf.splitTextToSize(v, cw - 3)[0] as string, x, y + 4.2);
    });
    y += 16;

    for (const sem of t.semesters) {
      pdf.setFillColor(...NAVY);
      pdf.rect(14, y - 4.5, w - 28, 7, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text(sem.label.toUpperCase(), 16, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.text(sem.source, w - 16, y, { align: 'right' });
      y += 6.5;
      pdf.setTextColor(...INK);
      if (sem.courses.length) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.setTextColor(...GREY);
        pdf.text('Course', 16, y); pdf.text('Trainer', 100, y); pdf.text('Score', 160, y); pdf.text('Grade', 178, y);
        y += 5;
        for (const c of sem.courses) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8.5);
          pdf.setTextColor(...INK);
          pdf.text(pdf.splitTextToSize(c.courseName, 80)[0] as string, 16, y);
          pdf.text(pdf.splitTextToSize(c.teacherName, 56)[0] as string, 100, y);
          pdf.text(c.total == null ? (c.partial != null ? `(${c.partial})` : '–') : String(c.total), 160, y);
          pdf.text(c.total == null ? '–' : gradeFor(c.total, settings).grade, 178, y);
          pdf.setDrawColor(229, 231, 235);
          pdf.setLineWidth(0.2);
          pdf.line(14, y + 2, w - 14, y + 2);
          y += 6;
          if (y > h - 90) break;
        }
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...NAVY);
      const pts = sem.points != null ? String(sem.points) : sem.partial != null ? `(${sem.partial}) so far` : 'Not yet available';
      pdf.text(`${sem.label} points: ${pts}`, 16, y + 1);
      if (sem.grade) pdf.text(`Grade: ${sem.grade}`, 130, y + 1);
      y += 10;
    }

    // Final result.
    pdf.setFillColor(...NAVY);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.8);
    pdf.roundedRect(14, y, w - 28, 16, 2.5, 2.5, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GOLD);
    pdf.setCharSpace(1.1);
    pdf.text('FINAL POINTS', 20, y + 6.5);
    pdf.text('FINAL GRADE', 80, y + 6.5);
    pdf.text('REMARK', 130, y + 6.5);
    pdf.setCharSpace(0);
    pdf.setFontSize(12.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(t.final.final == null ? '–' : String(t.final.final), 20, y + 12.5);
    pdf.text(t.final.grade || '–', 80, y + 12.5);
    pdf.setFontSize(8.5);
    pdf.text(pdf.splitTextToSize(t.final.remark || '–', w - 150)[0] as string, 130, y + 12.5);
    y += 22;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    const lines = [
      `Final points are the average of Semester 1 and Semester 2. Grades: ${bandsText(settings)}. A figure in brackets is not final: some papers are not yet marked.`,
      ...(t.printed ? [`Printed graduation list: ${t.printed.points}${t.printed.grade ? ` ${t.printed.grade}` : ''}.`] : []),
      ...t.notes.slice(0, 3),
    ];
    for (const l of lines) { const part = pdf.splitTextToSize(l, w - 28) as string[]; pdf.text(part, 14, y); y += 3.6 * part.length + 1; }

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
    pdf.text('Computer-generated transcript', w / 2, h - 10, { align: 'center' });
    pdf.setFillColor(...GOLD);
    pdf.rect(0, h - 4, w, 4, 'F');
  });
  stampPoweredBy(pdf);
  const safe = (transcripts.length === 1 ? transcripts[0]!.name : title).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Transcript-${safe}.pdf`, { type: 'application/pdf' });
}
