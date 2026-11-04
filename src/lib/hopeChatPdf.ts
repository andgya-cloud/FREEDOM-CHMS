import type { Organization } from '../state/OrgContext';
import { header, newPdf, GREY, INK } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { CHAT_STATUS_LABELS, chatColour, chatSignature } from '../../functions/src/shared/hopeChats';
import { photoForPdf } from './hopePhotos';
import { chatFile, type StoredChat, type StoredMessage } from './hopeChats';

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The whole conversation as a PDF (7A): every message in its person's colour, with their signature, and the photos. */
export async function hopeChatPdf(org: Organization, chat: StoredChat, messages: StoredMessage[]): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const tz = org.timeZone || 'Africa/Nairobi';
  header(pdf, org, `Conversation about ${chat.childName}${chat.childCode ? ` (${chat.childCode})` : ''}`);
  let y = 38;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GREY);
  pdf.text(`${CHAT_STATUS_LABELS[chat.status]} · started by ${chat.startedByName} · ${messages.length} messages · Private: for the Director, the board and the pastor only`, 14, y);
  y += 8;
  const maxW = w - 28 - 24;
  for (const m of messages) {
    if (m.system) {
      const lines = pdf.splitTextToSize(`${m.text}  (${chatSignature(m, tz).split(' · ').pop()})`, w - 40) as string[];
      if (y + lines.length * 4.2 + 6 > h - 20) { pdf.addPage(); y = 20; }
      pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8.5); pdf.setTextColor(...GREY);
      pdf.text(lines, w / 2, y + 3, { align: 'center' });
      y += lines.length * 4.2 + 5;
      continue;
    }
    const [bubble, ink] = chatColour(m.byUid || m.byName);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    const lines = (m.text ? pdf.splitTextToSize(m.text, maxW - 8) : []) as string[];
    const pics: { dataUrl: string; w: number; h: number }[] = [];
    const docs: string[] = [];
    for (const f of m.files ?? []) {
      if (f.photo) { const p = await chatFile(org.id, chat.id, f).then(photoForPdf).catch(() => null); if (p) pics.push(p); else docs.push(f.name); } else docs.push(f.name);
    }
    const picH = pics.length ? 50 : 0;
    const boxH = 9 + lines.length * 4.6 + (docs.length ? docs.length * 4.6 + 1 : 0) + (picH ? picH + 3 : 0) + 6;
    if (y + boxH > h - 20) { pdf.addPage(); y = 20; }
    pdf.setFillColor(...rgb(bubble));
    pdf.roundedRect(14, y, maxW, boxH, 3, 3, 'F');
    pdf.setFillColor(...rgb(ink));
    pdf.rect(14, y + 2, 1.4, boxH - 4, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...rgb(ink));
    pdf.text(chatSignature(m, tz), 19, y + 5.5);
    let ty = y + 11;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...INK);
    if (lines.length) { pdf.text(lines, 19, ty); ty += lines.length * 4.6; }
    for (const d of docs) { pdf.setFontSize(9); pdf.setTextColor(...GREY); pdf.text(`File: ${d}`, 19, ty); ty += 4.6; }
    let px = 19;
    for (const p of pics) {
      const s = Math.min(60 / p.w, picH / p.h);
      if (px + p.w * s > 14 + maxW) break;
      pdf.addImage(p.dataUrl, 'JPEG', px, ty, p.w * s, p.h * s);
      px += p.w * s + 3;
    }
    y += boxH + 4;
  }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `Conversation - ${chat.childName}.pdf`, { type: 'application/pdf' });
}
