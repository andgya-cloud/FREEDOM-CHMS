import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Organization } from '../state/OrgContext';
import { downloadFile, newPdf } from './givingPdf';
import { logoImage } from './pettyPdf';
import { localDateKey } from '../../functions/src/shared/datetime';
import { drawLetterhead, GREY, INK, letterheadFor } from '../../functions/src/shared/pettyVoucher';
import { POWERED_BY, stampPoweredBy } from '../../functions/src/shared/poweredBy';
import {
  addDays, clock, dayLabel, PLAN_WEEKS, plannedDates, settingsOr, TEAM_INFO, TEAMS, type HostSettings, type RotaSlot, type Team,
} from '../../functions/src/shared/serviceHosts';

/**
 * The Service host and Sunday prayer calendar to download (Andy, 2026-11-17): one line per date for the next
 * three months, with who hosts the service and who leads prayer, and whether they said yes.
 */
export interface RotaLine { date: string; host: string; prayer: string }

const ANSWER: Record<string, string> = { yes: 'Accepted', no: "Can't come", pending: 'Waiting' };

function who(slots: RotaSlot[], plannedTime: string, single: boolean): string {
  const s = slots.find((x) => x.time === plannedTime) ?? (single ? slots[0] : undefined);
  if (!s?.hostId) return '';
  return s.status === 'suggested' ? `${s.hostName} · suggested` : `${s.hostName} · ${ANSWER[s.answer] ?? ''}`;
}

export async function rotaLines(org: Organization): Promise<RotaLine[]> {
  const from = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const to = addDays(from, PLAN_WEEKS * 7);
  const byTeam = {} as Record<Team, { settings: HostSettings; slots: RotaSlot[] }>;
  for (const team of TEAMS) {
    const col = TEAM_INFO[team].col;
    const [s, r] = await Promise.all([
      getDoc(doc(db, 'organizations', org.id, col.settings, 'main')),
      getDocs(query(collection(db, 'organizations', org.id, col.rota), where('date', '>=', from), where('date', '<=', to))),
    ]);
    byTeam[team] = { settings: settingsOr(s.data() as Partial<HostSettings> | undefined, org.serviceTimes, team), slots: r.docs.map((d) => ({ id: d.id, ...d.data() }) as RotaSlot) };
  }
  const days = new Map<string, RotaLine>();
  for (const team of TEAMS) {
    const { settings, slots } = byTeam[team];
    const planned = plannedDates(settings, from);
    for (const p of planned) {
      const line = days.get(p.date) ?? { date: p.date, host: '', prayer: '' };
      const sameDay = slots.filter((x) => x.date === p.date);
      const name = who(sameDay.filter((x) => x.id === p.id), p.time, true) || 'Nobody yet';
      // The usual Sunday line shows just the name; another service says which one.
      const usual = p.serviceName === TEAM_INFO[team].serviceName(0);
      const text = usual ? name : `${p.serviceName}${p.time ? ` ${clock(p.time)}` : ''}: ${name}`;
      if (team === 'host') line.host = line.host ? `${line.host}; ${text}` : text;
      else line.prayer = line.prayer ? `${line.prayer}; ${text}` : text;
      days.set(p.date, line);
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const fileName = (ext: string) => `Service-hosts-and-Sunday-prayer-${localDateKey()}.${ext}`;

export async function rotaPdf(org: Organization): Promise<File> {
  const lines = await rotaLines(org);
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const bottom = pdf.internal.pageSize.getHeight() - 22;
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), 'Service hosts and Sunday prayer', `${dayLabel(lines[0]?.date ?? localDateKey())} to ${dayLabel(lines.at(-1)?.date ?? localDateKey())}`);
  const cols = [14, 50, 50 + (w - 64) / 2];
  const colW = (w - 64) / 2 - 4;
  const header = () => {
    pdf.setFillColor(31, 92, 61); pdf.rect(14, y, w - 28, 8, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255);
    pdf.text('Date', cols[0]! + 2, y + 5.5); pdf.text('Service host', cols[1]! + 2, y + 5.5); pdf.text('Sunday prayer', cols[2]! + 2, y + 5.5);
    y += 10;
  };
  header();
  pdf.setFontSize(9);
  lines.forEach((l, i) => {
    pdf.setFont('helvetica', 'normal');
    const a = pdf.splitTextToSize(l.host || '—', colW) as string[];
    const b = pdf.splitTextToSize(l.prayer || '—', colW) as string[];
    const h = Math.max(a.length, b.length) * 4.4 + 3;
    if (y + h > bottom) { pdf.addPage(); y = 20; header(); }
    if (i % 2 === 0) { pdf.setFillColor(244, 247, 244); pdf.rect(14, y - 1, w - 28, h, 'F'); }
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold'); pdf.text(dayLabel(l.date, false), cols[0]! + 2, y + 3.5);
    pdf.setFont('helvetica', 'normal');
    a.forEach((t, k) => { pdf.setTextColor(...(/Nobody yet|Can't come/.test(t) ? [200, 40, 40] as [number, number, number] : INK)); pdf.text(t, cols[1]! + 2, y + 3.5 + k * 4.4); });
    b.forEach((t, k) => { pdf.setTextColor(...(/Nobody yet|Can't come/.test(t) ? [200, 40, 40] as [number, number, number] : INK)); pdf.text(t, cols[2]! + 2, y + 3.5 + k * 4.4); });
    y += h;
  });
  y += 4;
  if (y < bottom) { pdf.setFontSize(8); pdf.setTextColor(...GREY); pdf.text(`Made ${new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}.`, 14, y + 2); }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], fileName('pdf'), { type: 'application/pdf' });
}

export async function rotaExcel(org: Organization): Promise<File> {
  const writeXlsxFile = (await import('write-excel-file')).default;
  const lines = await rotaLines(org);
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const rows = [
    [bold(`${org.name} · Service hosts and Sunday prayer`)],
    [],
    [bold('Date'), bold('Service host'), bold('Sunday prayer')],
    ...lines.map((l) => [
      { value: new Date(`${l.date}T12:00:00Z`), type: Date, format: 'ddd dd mmm yyyy' },
      { value: l.host, type: String, wrap: true },
      { value: l.prayer, type: String, wrap: true },
    ]),
    [],
    [{ value: POWERED_BY, type: String }],
  ];
  const blob = await writeXlsxFile(rows as never, { columns: [{ width: 18 }, { width: 50 }, { width: 50 }] }) as unknown as Blob;
  return new File([blob], fileName('xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadRota(org: Organization, kind: 'pdf' | 'xlsx'): Promise<void> {
  downloadFile(kind === 'pdf' ? await rotaPdf(org) : await rotaExcel(org));
}
