import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { receiptKindLabel } from '../../functions/src/shared/pettyCash';
import { receiptData } from './pettyCashWrites';
import { itemLabel, receiptCode } from './receiptNames';
import { downloadFile } from './givingPdf';

/**
 * Receipt packs (Andy, 2026-10-24): one PDF holding a requisition's receipts, or a whole month's, in
 * order, each page headed with its name such as "ADIA-00012-1 · Item 2: Printer ink". Photos and PDFs go
 * in as they are; Word, Excel and CSV files get a page saying to open them in Insight-IQ.
 */
export interface PackReceipt { id: string; name: string; type: string; itemIndex?: number | null; uploadedByName: string }
export interface PackGroup {
  number: string; requesterName: string; amount: string; category: string; status: string;
  items: { description: string }[]; receipts: PackReceipt[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Photos the PDF can't take directly (WebP, HEIC, GIF…) are redrawn as PNG by the browser. */
async function asPng(dataUrl: string): Promise<Uint8Array | null> {
  const img = new Image();
  img.src = dataUrl;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return bytesOf(c.toDataURL('image/png'));
}

const clip = (font: PDFFont, text: string, size: number, width: number) => {
  let t = text.replace(/[^\x20-\x7E -ÿ]/g, '?');
  while (t.length > 3 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -2);
  return t === text ? t : `${t}…`.replace('…', '...');
};

function heading(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, sub: string) {
  const [w, h] = [page.getWidth(), page.getHeight()];
  page.drawRectangle({ x: 0, y: h - 40, width: w, height: 40, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawText(clip(bold, title, 11, w - 2 * MARGIN), { x: MARGIN, y: h - 20, size: 11, font: bold, color: rgb(0.1, 0.15, 0.3) });
  page.drawText(clip(font, sub, 8, w - 2 * MARGIN), { x: MARGIN, y: h - 33, size: 8, font, color: rgb(0.35, 0.35, 0.4) });
}

export async function buildReceiptPack(orgName: string, title: string, groups: PackGroup[], orgId: string): Promise<{ bytes: Uint8Array; missing: number }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let missing = 0;

  // Contents page.
  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const line = (text: string, size = 10, f = font, gap = 4) => {
    if (y < MARGIN + size) { page = pdf.addPage(A4); y = A4[1] - MARGIN; }
    page.drawText(clip(f, text, size, A4[0] - 2 * MARGIN), { x: MARGIN, y: y - size, size, font: f, color: rgb(0.1, 0.1, 0.15) });
    y -= size + gap;
  };
  line(orgName, 16, bold, 6);
  line(title, 12, bold, 12);
  for (const g of groups) {
    line(`${g.number} · ${g.requesterName} · ${g.amount} · ${g.category} · ${g.status}`, 10, bold, 3);
    if (!g.receipts.length) line('   No receipt yet', 9, font, 3);
    g.receipts.forEach((r, i) => line(`   ${receiptCode(g.number, i + 1)} · ${itemLabel(g.items, r.itemIndex)} · ${r.name}`, 9, font, 3));
    y -= 6;
  }

  for (const g of groups) {
    for (const [i, r] of g.receipts.entries()) {
      const code = receiptCode(g.number, i + 1);
      const sub = `${itemLabel(g.items, r.itemIndex)} · ${r.name} · added by ${r.uploadedByName} · ${g.requesterName}, ${g.amount}`;
      const data = await receiptData(orgId, r.id).catch(() => null);
      if (!data) { missing += 1; continue; }
      try {
        if (r.type === 'application/pdf') {
          const src = await PDFDocument.load(bytesOf(data), { ignoreEncryption: true });
          const pages = await pdf.copyPages(src, src.getPageIndices());
          pages.forEach((p, n) => { pdf.addPage(p); heading(p, font, bold, n ? `${code} (page ${n + 1})` : code, sub); });
          continue;
        }
        if (r.type.startsWith('image/')) {
          const img = r.type === 'image/jpeg' ? await pdf.embedJpg(bytesOf(data))
            : r.type === 'image/png' ? await pdf.embedPng(bytesOf(data))
            : await (async () => { const png = await asPng(data); return png ? pdf.embedPng(png) : null; })();
          if (img) {
            const p = pdf.addPage(A4);
            const box = { w: A4[0] - 2 * MARGIN, h: A4[1] - 2 * MARGIN - 40 };
            const s = Math.min(box.w / img.width, box.h / img.height, 1.5);
            p.drawImage(img, { x: (A4[0] - img.width * s) / 2, y: MARGIN + (box.h - img.height * s) / 2, width: img.width * s, height: img.height * s });
            heading(p, font, bold, code, sub);
            continue;
          }
        }
      } catch { /* falls through to the note page */ }
      const p = pdf.addPage(A4);
      heading(p, font, bold, code, sub);
      p.drawText(clip(font, `This receipt is a ${receiptKindLabel(r.type)} file and cannot be shown here.`, 11, A4[0] - 2 * MARGIN), { x: MARGIN, y: A4[1] / 2, size: 11, font });
      p.drawText(clip(font, `Open ${g.number} in Insight-IQ, Petty Cash, Receipts, to view "${r.name}".`, 10, A4[0] - 2 * MARGIN), { x: MARGIN, y: A4[1] / 2 - 18, size: 10, font });
    }
  }
  return { bytes: await pdf.save(), missing };
}

/** Builds the pack and saves it, e.g. ADIA-00012-receipts.pdf. Returns how many receipt files had not reached this device. */
export async function downloadReceiptPack(orgName: string, title: string, fileName: string, groups: PackGroup[], orgId: string) {
  const { bytes, missing } = await buildReceiptPack(orgName, title, groups, orgId);
  downloadFile(new File([bytes as BlobPart], fileName, { type: 'application/pdf' }));
  return missing;
}
