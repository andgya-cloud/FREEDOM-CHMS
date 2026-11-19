import writeXlsxFile from 'write-excel-file';
import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];

/** One student's line in the register, as printed. */
export interface RegisterLine { name: string; admissionNo: string; programme: string; sits: string; trade: string; grade: string; indexNo: string; feePaid: string; result: string }
export interface RegisterInfo { cohort: string; sitting: string; locked: string; counts: string }

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileName = (i: RegisterInfo, ext: string) => `Exam-register-${safe(i.cohort)}-${safe(i.sitting.replace(/^NITA & college exams/i, ''))}.${ext}`;
const HEAD = ['Admission no', 'Name', 'Department', 'Sits', 'NITA trade', 'NITA grade', 'NITA index no', 'Fee paid', 'Result'];

/** The register in Excel, for ADIA's own records (Andy, 2026-11-19, 3A). */
export async function registerWorkbook(info: RegisterInfo, lines: RegisterLine[]): Promise<File> {
  const head = HEAD.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = lines.map((l) => [l.admissionNo, l.name, l.programme, l.sits, l.trade, l.grade, l.indexNo, l.feePaid, l.result].map((value) => ({ value, type: String })));
  const top = [[{ value: `ADIA Training Centre · Exam register · ${info.cohort} · ${info.sitting}`, fontWeight: 'bold' as const }], [{ value: `${info.counts}${info.locked ? ` · ${info.locked}` : ''}`, type: String }], []];
  const blob = await writeXlsxFile([...top, head, ...body] as never, { columns: [18, 30, 24, 22, 26, 12, 18, 10, 18].map((width) => ({ width })), sheet: 'Register' } as never) as unknown as Blob;
  return new File([blob], fileName(info, 'xlsx'), { type: XLSX });
}

/** The register as a PDF on the ADIA letterhead, landscape so every column fits. */
export async function registerPdf(info: RegisterInfo, lines: RegisterLine[]): Promise<File> {
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const xs = [14, 44, 86, 122, 158, 196, 216, 244, 260];
  const head = () => {
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
    pdf.text(`EXAM REGISTER · ${info.cohort.toUpperCase()} · ${info.sitting.toUpperCase()}`, 40, 21);
    pdf.setCharSpace(0);
    let y = 40;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...INK);
    pdf.text(`${info.counts}${info.locked ? ` · ${info.locked}` : ''}`, 14, y);
    y += 8;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GREY);
    HEAD.forEach((c, i) => pdf.text(c.toUpperCase(), xs[i]!, y));
    return y + 6;
  };
  let y = head();
  for (const l of lines) {
    if (y > h - 20) { pdf.addPage(); y = head(); }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK);
    [l.admissionNo, l.name, l.programme, l.sits, l.trade, l.grade, l.indexNo, l.feePaid, l.result].forEach((c, i) => {
      pdf.text((pdf.splitTextToSize(c || '–', (xs[i + 1] ?? w - 14) - xs[i]! - 2) as string[])[0] ?? '', xs[i]!, y);
    });
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, y + 2, w - 14, y + 2);
    y += 6.2;
  }
  y = Math.min(y + 14, h - 22);
  pdf.setDrawColor(...GREY);
  pdf.setLineWidth(0.3);
  pdf.line(14, y, 84, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Principal', 14, y + 4.5);
  pdf.text('For ADIA Training Centre\'s own records', w - 14, y + 4.5, { align: 'right' });
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], fileName(info, 'pdf'), { type: 'application/pdf' });
}
