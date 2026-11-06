import type { Organization } from '../state/OrgContext';
import { newPdf, GREY, INK } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { chatTime } from '../../functions/src/shared/hopeChats';
import { formatDateKey, localDateKey } from '../../functions/src/shared/datetime';
import {
  APPROVAL_LABELS, faceKey, incidentRows, PHOTO_REPORT_LABELS, SEVERITY_LABELS, STORY_STATUS_LABELS, storyChanges, storyTint, storyTimeline, type ApprovalSlot, type PhotoFile,
} from '../../functions/src/shared/hopePhotos';
import { photoFile, photoForPdf, type StoredPhotoReport, type StoredStoryMessage } from './hopePhotos';

const GREEN: [number, number, number] = [3, 130, 65];
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

async function mark(): Promise<string | null> {
  try {
    const blob = await (await fetch('/org/hope-centre-mark.png')).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

export interface StoryPdfInput {
  summary: string; preparedBy: string; preparedRole: string; link: string;
  /** The stakeholders' photos by plain name, and the children's by id (data URLs). */
  faces?: Record<string, string>; childPhotos?: Record<string, string>;
}
const fmt = (dataUrl: string) => (dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG');

/**
 * The report for the board (5A): a cover (logo, title, kind, dates, sender), the summary (and an incident's details),
 * a dated timeline of the conversation, the photo gallery with captions, the list of files and videos (linked, not
 * printed), "Decisions and next steps", the sign-off, and "Powered by Insight-IQ" on every page.
 */
export async function hopeStoryPdf(org: Organization, report: StoredPhotoReport, replies: StoredStoryMessage[], input: StoryPdfInput): Promise<File> {
  const pdf = await newPdf('a4');
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const tz = org.timeZone || 'Africa/Nairobi';
  const items = storyTimeline(report, replies).filter((m) => !m.deleted && !m.system);
  const faces = input.faces ?? {};
  const kidPhotos = input.childPhotos ?? {};
  const photos: { f: PhotoFile; by: string; at: string; img: { dataUrl: string; w: number; h: number } }[] = [];
  const others: { f: PhotoFile; by: string; at: string }[] = [];
  for (const m of items) {
    for (const f of m.files) {
      const img = f.photo ? await photoFile(org.id, report.id, f).then(photoForPdf).catch(() => null) : null;
      if (img) photos.push({ f, by: m.byName, at: m.at, img }); else others.push({ f, by: m.byName, at: m.at });
    }
  }
  const logo = await mark();
  const label = PHOTO_REPORT_LABELS[report.kind];
  const incident = report.kind === 'incident';
  let y = 0;
  const room = (need: number) => { if (y + need > H - 18) { pdf.addPage(); y = 20; } };
  const heading = (t: string) => {
    room(16);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...GREEN);
    pdf.text(t, 14, y); y += 2;
    pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.4); pdf.line(14, y, W - 14, y); y += 7;
  };
  const para = (t: string, size = 10.5, colour: [number, number, number] = INK) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size); pdf.setTextColor(...colour);
    for (const line of pdf.splitTextToSize(t, W - 28) as string[]) { room(6); pdf.text(line, 14, y); y += size * 0.45; }
  };

  // 1. The cover.
  pdf.setFillColor(...(incident ? [176, 48, 31] as [number, number, number] : GREEN)); pdf.rect(0, 0, W, 64, 'F');
  if (logo) { try { pdf.addImage(logo, 'PNG', 14, 12, 26, 26); } catch { /* no logo */ } }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(`${org.name} · Report to the board${report.ref ? ` · ${report.ref}` : ''}`, logo ? 46 : 14, 20);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(21);
  const titleLines = (pdf.splitTextToSize(report.title, W - (logo ? 60 : 28)) as string[]).slice(0, 2);
  pdf.text(titleLines, logo ? 46 : 14, 30);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(`${label} · ${formatDateKey(report.day)}`, logo ? 46 : 14, 30 + titleLines.length * 8 + 2);
  y = 76;
  const first = items[0]?.at ?? '';
  const last = items[items.length - 1]?.at ?? first;
  const facts: [string, string][] = [
    ['Reference', report.ref ?? ''],
    ['Kind', label],
    ['Status', STORY_STATUS_LABELS[report.status ?? 'open']],
    ['Date it happened', formatDateKey(report.day)],
    ['Sent by', `${report.senderName}${report.senderRole ? `, ${report.senderRole}` : ''}`],
    ['Conversation', first ? `${chatTime(first, tz)} to ${chatTime(last, tz)}` : ''],
    ['Messages', `${items.length} · ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · ${others.length} other ${others.length === 1 ? 'file' : 'files'}`],
    ...(report.reportLabel ? [['For the report', report.reportLabel] as [string, string]] : []),
  ].filter(([, v]) => v) as [string, string][];
  for (const [k, v] of facts) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...GREY); pdf.text(k, 14, y);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(pdf.splitTextToSize(v, W - 70) as string[], 60, y);
    y += 7;
  }
  const hero = photos[0];
  if (hero) {
    const maxW = W - 28; const maxH = H - y - 30;
    const s = Math.min(maxW / hero.img.w, maxH / hero.img.h);
    if (s > 0 && hero.img.h * s > 40) {
      y += 4;
      pdf.addImage(hero.img.dataUrl, 'JPEG', (W - hero.img.w * s) / 2, y, hero.img.w * s, hero.img.h * s);
    }
  }

  // 2. The summary, and an incident's details.
  pdf.addPage(); y = 22;
  heading('Summary');
  para(input.summary.trim() || report.text || 'No summary was written.');
  y += 4;
  const rows = [
    ...(report.incident?.severity ? [['Severity', SEVERITY_LABELS[report.incident.severity]] as [string, string]] : []),
    ...incidentRows(report.incident),
    ...(report.kind === 'incident' ? [['Follow-up done', report.followUpDoneAt ? `Yes, ${report.followUpDoneByName ?? ''}, ${chatTime(report.followUpDoneAt, tz)}` : 'Not yet'] as [string, string]] : []),
  ];
  if (incident && rows.length) {
    heading('Incident details');
    for (const [k, v] of rows) {
      const lines = pdf.splitTextToSize(v, W - 74) as string[];
      room(lines.length * 5 + 3);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...GREY); pdf.text(k, 14, y);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(lines, 60, y);
      y += lines.length * 5 + 2;
    }
    y += 4;
  }

  // 3. The timeline, each person in their colour.
  heading('Timeline');
  for (const m of items) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    const lines = (m.text ? pdf.splitTextToSize(m.text, W - 46) : []) as string[];
    const fileLine = m.files.length ? `📎 ${m.files.map((f) => f.name).join(', ')}` : '';
    const fileLines = fileLine ? (pdf.splitTextToSize(fileLine.replace('📎 ', 'Files: '), W - 46) as string[]) : [];
    const kids = m.children ?? [];
    const need = Math.max(7 + lines.length * 4.6 + fileLines.length * 4.2 + kids.length * 11 + 4, 14);
    room(need);
    const tint = rgb(storyTint(m.byName, m.byUid));
    const top = y - 4;
    pdf.setFillColor(...tint); pdf.rect(14, top, 1.6, need - 3, 'F');
    // The speaker's photo beside their words (3A), or their initials in their colour.
    const face = faces[faceKey(m.byName)];
    let drawn = false;
    if (face) { try { pdf.addImage(face, fmt(face), 18, top, 9, 9); drawn = true; } catch { /* no photo */ } }
    if (!drawn) {
      pdf.setFillColor(...tint); pdf.circle(22.5, top + 4.5, 4.5, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(255, 255, 255);
      pdf.text(m.byName.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase(), 22.5, top + 5.6, { align: 'center' });
    }
    const x = 30;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...tint);
    pdf.text(`${chatTime(m.at, tz)} · ${m.byName}${m.byRole ? ` · ${m.byRole}` : ''}${m.decision ? ' · Decision' : ''}${m.editedAt ? ' · edited' : ''}`, x, y);
    y += 5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...INK);
    if (lines.length) { pdf.text(lines, x, y); y += lines.length * 4.6; }
    // The children named (2A): photo, name, HC code and class.
    for (const c of kids) {
      const p = kidPhotos[c.id];
      let shown = false;
      if (p) { try { pdf.addImage(p, fmt(p), x, y - 2, 9, 9); shown = true; } catch { /* no photo */ } }
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...INK);
      pdf.text(c.name, shown ? x + 11 : x, y + 2);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GREY);
      pdf.text([c.code, c.className].filter(Boolean).join(' · '), shown ? x + 11 : x, y + 6);
      y += 11;
    }
    if (fileLines.length) { pdf.setFontSize(8.5); pdf.setTextColor(...GREY); pdf.text(fileLines, x, y); y += fileLines.length * 4.2; }
    y = Math.max(y, top + 12) + 4;
  }

  // 4. The photo gallery, two across, each with its caption.
  if (photos.length) {
    pdf.addPage(); y = 22;
    heading('Photo gallery');
    const colW = (W - 28 - 6) / 2; const boxH = 62;
    photos.forEach((p, i) => {
      const col = i % 2;
      if (col === 0) room(boxH + 10);
      const x = 14 + col * (colW + 6);
      const s = Math.min(colW / p.img.w, boxH / p.img.h);
      pdf.setFillColor(245, 247, 246); pdf.rect(x, y, colW, boxH, 'F');
      pdf.addImage(p.img.dataUrl, 'JPEG', x + (colW - p.img.w * s) / 2, y + (boxH - p.img.h * s) / 2, p.img.w * s, p.img.h * s);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...GREY);
      pdf.text(`Photo ${i + 1} · ${p.by} · ${chatTime(p.at, tz)}`, x, y + boxH + 4);
      if (col === 1 || i === photos.length - 1) y += boxH + 10;
    });
  }

  // 5. Files and videos: listed, opened in Insight-IQ.
  if (others.length) {
    heading('Attachments');
    for (const o of others) {
      room(10);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK);
      pdf.text(`${o.f.video ? 'Video' : 'File'}: ${o.f.name}`, 14, y);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...GREY);
      pdf.text(`${(o.f.size / 1048576).toFixed(1)} MB · from ${o.by} · ${chatTime(o.at, tz)} · ${o.f.video ? 'watch' : 'open'} it in Insight-IQ`, 14, y + 4.5);
      y += 10;
    }
    pdf.setFontSize(9); pdf.setTextColor(...GREEN);
    room(6); pdf.textWithLink(input.link, 14, y, { url: input.link }); y += 8;
  }

  // 6. Decisions and next steps.
  heading('Decisions and next steps');
  const decisions = items.filter((m) => m.decision);
  const steps = [
    ...decisions.map((m) => `${m.text} (${m.byName}, ${chatTime(m.at, tz)})`),
    ...(incident && report.incident?.followUp ? [`Follow-up: ${report.incident.followUp}`] : []),
  ];
  if (!steps.length) para('None were marked in the conversation.', 10, GREY);
  for (const s of steps) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor(...INK);
    const lines = pdf.splitTextToSize(s, W - 34) as string[];
    room(lines.length * 5 + 2);
    pdf.text('•', 15, y); pdf.text(lines, 20, y);
    y += lines.length * 5 + 2;
  }
  y += 6;

  // 7. The sign-off.
  room(46);
  heading('Sign-off');
  para(`Prepared by ${input.preparedBy}${input.preparedRole ? `, ${input.preparedRole}` : ''}, on ${formatDateKey(localDateKey(new Date(), tz))}.`);
  y += 6;
  const half = (W - 28 - 12) / 2;
  (['director', 'board'] as ApprovalSlot[]).forEach((slot, i) => {
    const x = i === 0 ? 14 : 26 + half;
    const a = report.approvals?.[slot];
    if (a) {
      pdf.setFillColor(232, 246, 237); pdf.roundedRect(x, y, half, 20, 2, 2, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...GREEN);
      pdf.text('APPROVED', x + 4, y + 6);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(`${a.name}, ${a.role}`, half - 8) as string[], x + 4, y + 11);
      pdf.setTextColor(...GREY); pdf.text(`${chatTime(a.at, tz)} · confirmed with password`, x + 4, y + 17);
    } else {
      pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.3);
      pdf.line(x, y + 14, x + half, y + 14);
    }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GREY);
    pdf.text(APPROVAL_LABELS[slot], x, y + 25);
  });
  y += 32;

  // 8. The record of changes (9A): edits, deletions and files taken out.
  const changes = storyChanges(report, replies);
  if (changes.length) {
    heading('Record of changes');
    for (const c of changes) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...INK);
      const lines = pdf.splitTextToSize(`${chatTime(c.at, tz)}  ${c.text}`, W - 28) as string[];
      room(lines.length * 4.4 + 2);
      pdf.text(lines, 14, y); y += lines.length * 4.4 + 1.5;
    }
  }

  // An incident is marked Confidential on every page (10A).
  if (incident) {
    const pages = pdf.getNumberOfPages();
    for (let n = 1; n <= pages; n++) {
      pdf.setPage(n);
      const g = pdf as unknown as { GState: new (o: { opacity: number }) => unknown; setGState: (g: unknown) => void; saveGraphicsState: () => void; restoreGraphicsState: () => void };
      g.saveGraphicsState();
      g.setGState(new g.GState({ opacity: 0.08 }));
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(64); pdf.setTextColor(176, 48, 31);
      pdf.text('CONFIDENTIAL', W / 2, H / 2, { align: 'center', angle: 35 });
      g.restoreGraphicsState();
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5);
      if (n === 1) pdf.setTextColor(255, 255, 255); else pdf.setTextColor(176, 48, 31);
      pdf.text('CONFIDENTIAL', W - 14, 8, { align: 'right' });
    }
  }

  stampPoweredBy(pdf);
  const safe = report.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  return new File([pdf.output('blob')], `${incident ? 'Incident report' : 'Report'} - ${safe}.pdf`, { type: 'application/pdf' });
}
