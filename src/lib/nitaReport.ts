import writeXlsxFile from 'write-excel-file';
import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];

/** One student's line in the NITA results list, as printed (Andy, 2026-11-20, 12A). */
export interface NitaLine { admissionNo: string; name: string; trade: string; grade: string; indexNo: string; theory: string; practical: string; overall: string; certificateNo: string; issued: string }
export interface NitaInfo { cohort: string; release: string; counts: string; today: string }

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileName = (i: NitaInfo, ext: string) => `NITA-results-${safe(i.cohort)}-${safe(i.release.replace(/ sitting$/, ''))}.${ext}`;
const title = (i: NitaInfo) => `NITA results · ${i.cohort} · ${i.release}`;

/** The list in Excel. */
export async function nitaWorkbook(info: NitaInfo, lines: NitaLine[]): Promise<File> {
  const HEAD = ['Admission no', 'Name', 'Trade', 'Grade', 'Index no', 'Theory', 'Practical', 'Overall', 'Certificate no', 'NITA certificate'];
  const head = HEAD.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = lines.map((l) => [l.admissionNo, l.name, l.trade, l.grade, l.indexNo, l.theory, l.practical, l.overall, l.certificateNo, l.issued].map((value) => ({ value, type: String })));
  const top = [[{ value: `ADIA Training Centre · ${title(info)}`, fontWeight: 'bold' as const }], [{ value: `${info.counts} · ${info.today}`, type: String }], []];
  const blob = await writeXlsxFile([...top, head, ...body] as never, { columns: [18, 28, 22, 11, 18, 10, 10, 10, 18, 22].map((width) => ({ width })), sheet: 'NITA results' } as never) as unknown as Blob;
  return new File([blob], fileName(info, 'xlsx'), { type: XLSX });
}

/** The list as a PDF on the ADIA letterhead, landscape. */
export async function nitaPdf(info: NitaInfo, lines: NitaLine[]): Promise<File> {
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const HEAD = ['Admission no', 'Name', 'Trade', 'Grade', 'Index no', 'Theory', 'Practical', 'Overall', 'Certificate no', 'Certificate'];
  const xs = [14, 46, 86, 120, 140, 172, 190, 210, 230, 260];
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
    pdf.text(title(info).toUpperCase(), 40, 21);
    pdf.setCharSpace(0);
    let y = 40;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(...INK);
    pdf.text(`${info.counts} · ${info.today}`, 14, y);
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
    // Long cells wrap onto a second line (at most two), so nothing is cut off.
    const cells = [l.admissionNo, l.name, l.trade, l.grade, l.indexNo, l.theory, l.practical, l.overall, l.certificateNo, l.issued]
      .map((c, i) => (pdf.splitTextToSize(c || '–', (xs[i + 1] ?? w - 14) - xs[i]! - 2) as string[]).slice(0, 2));
    const tall = Math.max(...cells.map((c) => c.length));
    if (y + (tall - 1) * 3.6 > h - 20) { pdf.addPage(); y = head(); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...INK); }
    cells.forEach((c, i) => c.forEach((line, k) => pdf.text(line, xs[i]!, y + k * 3.6)));
    const bottom = y + (tall - 1) * 3.6;
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, bottom + 2, w - 14, bottom + 2);
    y = bottom + 6.2;
  }
  y = Math.min(y + 14, h - 22);
  pdf.setDrawColor(...GREY);
  pdf.setLineWidth(0.3);
  pdf.line(14, y, 84, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Principal', 14, y + 4.5);
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], fileName(info, 'pdf'), { type: 'application/pdf' });
}
