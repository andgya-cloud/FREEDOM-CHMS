import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { EXAM_COMPONENTS, EXAM_COMPONENT_LABELS, type ExamReport, type ExamSettings, type ReportRow } from '../../functions/src/shared/exams';

const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const GOLD_SOFT: [number, number, number] = [246, 236, 212];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];

const fmt = (v: number | null | undefined) => (v == null ? '–' : String(v));

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
    pdf.text('STUDENT RESULT SLIP', 44, 23);
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
      pdf.text(c?.total == null ? (c?.partial != null ? `(${c.partial})` : '–') : String(c.total), 171, y);
      pdf.text(c?.grade || '–', 185, y);
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
    pdf.text(`Pass mark ${settings.passMark}%. Grades: ${settings.bands.map((b) => `${b.grade} ${b.min}+`).join(', ')}. A total in brackets is not final: some papers are not yet marked.`, 14, y, { maxWidth: w - 28 });

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
  return new File([pdf.output('blob')], `Result-Slip-${cohort.replace(/[^A-Za-z0-9]+/g, '-')}-${safe}.pdf`, { type: 'application/pdf' });
}
