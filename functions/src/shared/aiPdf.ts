import type { jsPDF as JsPdf } from 'jspdf';

/** The helper's dark gold (Andy, 2026-11-10): the same colour as on screen. */
export const AI_GOLD: [number, number, number] = [138, 106, 18];
const AI_TINT: [number, number, number] = [251, 246, 230];
const INK: [number, number, number] = [33, 37, 41];

/** A four-pointed sparkle drawn as shapes, because the PDF fonts have no ✦ character. */
export function drawSparkle(pdf: JsPdf, cx: number, cy: number, r: number) {
  const t = r * 0.28;
  pdf.setFillColor(...AI_GOLD);
  pdf.triangle(cx, cy - r, cx - t, cy, cx + t, cy, 'F');
  pdf.triangle(cx, cy + r, cx - t, cy, cx + t, cy, 'F');
  pdf.triangle(cx - r, cy, cx, cy - t, cx, cy + t, 'F');
  pdf.triangle(cx + r, cy, cx, cy - t, cx, cy + t, 'F');
}

/**
 * Words the helper wrote, in a PDF: a light gold box with a dark gold bar on the left, the sparkle and a label,
 * then the note "Written by AI". Returns the y below the box. Adds a page first when it would not fit.
 */
export function aiPdfBlock(pdf: JsPdf, y: number, title: string, text: string, note = 'Written by AI from the numbers in this report. Please check it.'): number {
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  const lines = pdf.splitTextToSize(text, w - 36) as string[];
  const boxH = 10 + lines.length * 5 + 8;
  if (y + boxH > h - 18) { pdf.addPage(); y = 20; }
  pdf.setFillColor(...AI_TINT); pdf.rect(14, y, w - 28, boxH, 'F');
  pdf.setFillColor(...AI_GOLD); pdf.rect(14, y, 1.6, boxH, 'F');
  drawSparkle(pdf, 21, y + 5.5, 2.4);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...AI_GOLD);
  pdf.text(title, 25, y + 7);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...INK);
  pdf.text(lines, 19, y + 13);
  pdf.setFontSize(8); pdf.setTextColor(...AI_GOLD);
  pdf.text(note, 19, y + 13 + lines.length * 5 + 1);
  return y + boxH + 6;
}
