import type { Organization } from '../state/OrgContext';
import { newPdf, GREY, INK } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { stonePng } from './stoneImage';
import type { HopeClass } from '../../functions/src/shared/hopeClasses';

/** One child's page in the Sponsor update (v182, 13A). Counts and good news only: no care notes, fees or worries. */
export interface SponsorPage {
  name: string; code: string; childId: string; age: number | null; klass: HopeClass | null; school: string; schoolClass: string;
  photo: string | null; sponsorName: string; registeredOn: string | null;
  came: number; of: number; streak: number; clubs: { name: string; level: string }[]; wins: { date: string; title: string }[];
  note: string;
}

const GREEN: [number, number, number] = [3, 130, 65];

async function logo(): Promise<string | null> {
  try {
    const blob = await (await fetch('/org/hope-centre-mark.png')).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

/** A one-page update per child, for their sponsor and for the OneChild reports. */
export async function sponsorUpdatePdf(org: Organization, pages: SponsorPage[], period: string): Promise<File> {
  const pdf = await newPdf('a4');
  const W = pdf.internal.pageSize.getWidth();
  const mark = await logo();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const c = pages[i]!;
    pdf.setFillColor(...GREEN); pdf.rect(0, 0, W, 30, 'F');
    if (mark) { try { pdf.addImage(mark, 'PNG', 12, 5, 20, 20); } catch { /* no logo */ } }
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
    pdf.text('Sponsor update', mark ? 37 : 14, 15);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
    pdf.text(`${org.name} · ${period}`, mark ? 37 : 14, 22);

    // Photo and name.
    const top = 40, ph = 58;
    if (c.photo) {
      try { pdf.addImage(c.photo, c.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 14, top, ph, ph); } catch { /* no photo */ }
      pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.8); pdf.rect(14, top, ph, ph); pdf.setLineWidth(0.2);
    } else {
      pdf.setFillColor(232, 245, 237); pdf.rect(14, top, ph, ph, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(30); pdf.setTextColor(...GREEN);
      pdf.text(c.name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase(), 14 + ph / 2, top + ph / 2 + 4, { align: 'center' });
    }
    const x = 14 + ph + 10;
    pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22);
    pdf.text(pdf.splitTextToSize(c.name, W - x - 14).slice(0, 2), x, top + 9);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11); pdf.setTextColor(...GREY);
    let y = top + 20;
    const line = (label: string, value: string) => {
      if (!value) return;
      pdf.setTextColor(...GREY); pdf.text(label, x, y);
      pdf.setTextColor(...INK); pdf.text(value, x + 38, y);
      y += 6.5;
    };
    line('Child ID', c.childId || c.code);
    line('Age', c.age != null ? `${c.age} years` : '');
    if (c.klass) {
      try { pdf.addImage(await stonePng(c.klass), 'PNG', x + 38, y - 4, 5, 5); } catch { /* text only */ }
      pdf.setTextColor(...GREY); pdf.text('Class', x, y); pdf.setTextColor(...INK); pdf.text(c.klass.name, x + 45, y); y += 6.5;
    }
    line('School', [c.school, c.schoolClass].filter(Boolean).join(', '));
    line('Sponsor', c.sponsorName);
    line('At the centre since', c.registeredOn ? formatDateKey(c.registeredOn) : '');

    // Attendance, big.
    y = top + ph + 14;
    pdf.setFillColor(232, 245, 237); pdf.roundedRect(14, y, W - 28, 30, 3, 3, 'F');
    pdf.setTextColor(...GREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(26);
    pdf.text(c.of ? `${c.came} of ${c.of}` : '–', 22, y + 14);
    pdf.setFontSize(12); pdf.setTextColor(...INK);
    pdf.text(c.of ? `Saturdays attended in ${period}${c.of ? ` (${Math.round((c.came / c.of) * 100)}%)` : ''}` : 'No Saturdays marked yet', 22, y + 23);
    if (c.streak >= 2) { pdf.setFont('helvetica', 'normal'); pdf.text(`${c.streak} Saturdays in a row`, W - 22, y + 14, { align: 'right' }); }
    y += 42;

    const section = (title: string, rows: string[], empty: string) => {
      pdf.setTextColor(...GREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.text(title, 14, y); y += 7;
      pdf.setTextColor(...INK); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
      for (const r of rows.length ? rows : [empty]) {
        const lines = pdf.splitTextToSize(`•  ${r}`, W - 30) as string[];
        pdf.text(lines, 16, y); y += lines.length * 5.5 + 1;
      }
      y += 5;
    };
    section('Clubs', c.clubs.map((k) => (k.level ? `${k.name} (${k.level})` : k.name)), 'Not in a club yet');
    section('Good news', c.wins.slice(0, 6).map((w) => `${formatDateKey(w.date)}: ${w.title}`), 'Faithful at the centre each Saturday');
    if (c.note.trim()) {
      pdf.setTextColor(...GREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.text('From the Director', 14, y); y += 7;
      pdf.setTextColor(...INK); pdf.setFont('helvetica', 'italic'); pdf.setFontSize(11);
      const lines = (pdf.splitTextToSize(c.note.trim(), W - 28) as string[]).slice(0, 12);
      pdf.text(lines, 14, y);
    }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...GREY);
    pdf.text('Thank you for walking with this child. Freedom Hope Centre, 0794 645 455', W / 2, 282, { align: 'center' });
  }
  stampPoweredBy(pdf);
  const safe = (s: string) => s.replace(/[^\w-]+/g, '-');
  return new File([pdf.output('blob')], `${safe(pages.length === 1 ? pages[0]!.name : org.name)}-sponsor-update.pdf`, { type: 'application/pdf' });
}
