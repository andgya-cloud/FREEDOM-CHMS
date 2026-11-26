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
const LABEL: Record<Team, string> = { host: 'SERVICE HOSTS', prayer: 'SUNDAY PRAYER' };
const TITLE = (teams: readonly Team[]) => teams.map((t) => TEAM_INFO[t].title).join(' and ');

const ANSWER: Record<string, string> = { yes: 'Accepted', no: "Can't come", pending: 'Waiting' };

function who(slots: RotaSlot[], plannedTime: string, single: boolean): string {
  const s = slots.find((x) => x.time === plannedTime) ?? (single ? slots[0] : undefined);
  if (!s?.hostId) return '';
  return s.status === 'suggested' ? `${s.hostName} · suggested` : `${s.hostName} · ${ANSWER[s.answer] ?? ''}`;
}

export async function rotaLines(org: Organization, teams: readonly Team[] = TEAMS): Promise<RotaLine[]> {
  const from = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const to = addDays(from, PLAN_WEEKS * 7);
  const byTeam = {} as Record<Team, { settings: HostSettings; slots: RotaSlot[] }>;
  for (const team of teams) {
    const col = TEAM_INFO[team].col;
    const [s, r] = await Promise.all([
      getDoc(doc(db, 'organizations', org.id, col.settings, 'main')),
      getDocs(query(collection(db, 'organizations', org.id, col.rota), where('date', '>=', from), where('date', '<=', to))),
    ]);
    byTeam[team] = { settings: settingsOr(s.data() as Partial<HostSettings> | undefined, org.serviceTimes, team), slots: r.docs.map((d) => ({ id: d.id, ...d.data() }) as RotaSlot) };
  }
  const days = new Map<string, RotaLine>();
  for (const team of teams) {
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

const fileName = (teams: readonly Team[], ext: string) => `${TITLE(teams).replace(/\s+/g, '-')}-${localDateKey()}.${ext}`;

/** Each schedule downloads on its own (Andy, 2026-11-26): Service hosts and Sunday prayer are separate. */
export async function rotaPdf(org: Organization, teams: readonly Team[] = TEAMS): Promise<File> {
  const lines = await rotaLines(org, teams);
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const bottom = pdf.internal.pageSize.getHeight() - 22;
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), TITLE(teams), `${dayLabel(lines[0]?.date ?? localDateKey())} to ${dayLabel(lines.at(-1)?.date ?? localDateKey())}`);
  const span = (w - 64) / teams.length;
  const cols = [14, ...teams.map((_, i) => 50 + i * span)];
  const colW = span - 4;
  const header = () => {
    // Each schedule's heading in its own colour (Andy, 2026-11-17).
    pdf.setFillColor(55, 65, 81); pdf.rect(14, y, cols[1]! - 14, 10, 'F');
    teams.forEach((t, i) => { pdf.setFillColor(...TEAM_INFO[t].rgb); pdf.rect(cols[i + 1]!, y, (cols[i + 2] ?? w - 14) - cols[i + 1]!, 10, 'F'); });
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(255, 255, 255);
    pdf.text('DATE', cols[0]! + 2, y + 6.8);
    teams.forEach((t, i) => pdf.text(LABEL[t], cols[i + 1]! + 2, y + 6.8));
    y += 12;
  };
  header();
  pdf.setFontSize(9);
  lines.forEach((l, i) => {
    pdf.setFont('helvetica', 'normal');
    const parts = teams.map((t) => pdf.splitTextToSize((t === 'host' ? l.host : l.prayer) || '—', colW) as string[]);
    const h = Math.max(...parts.map((x) => x.length)) * 4.4 + 3;
    if (y + h > bottom) { pdf.addPage(); y = 20; header(); }
    if (i % 2 === 0) { pdf.setFillColor(244, 247, 244); pdf.rect(14, y - 1, w - 28, h, 'F'); }
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold'); pdf.text(dayLabel(l.date, false), cols[0]! + 2, y + 3.5);
    pdf.setFont('helvetica', 'normal');
    parts.forEach((lines_, c) => lines_.forEach((t, k) => { pdf.setTextColor(...(/Nobody yet|Can't come/.test(t) ? [200, 40, 40] as [number, number, number] : INK)); pdf.text(t, cols[c + 1]! + 2, y + 3.5 + k * 4.4); }));
    y += h;
  });
  y += 4;
  if (y < bottom) { pdf.setFontSize(8); pdf.setTextColor(...GREY); pdf.text(`Made ${new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}.`, 14, y + 2); }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], fileName(teams, 'pdf'), { type: 'application/pdf' });
}

export async function rotaExcel(org: Organization, teams: readonly Team[] = TEAMS): Promise<File> {
  const writeXlsxFile = (await import('write-excel-file')).default;
  const lines = await rotaLines(org, teams);
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const band = (value: string, backgroundColor: string) => ({ value, fontWeight: 'bold' as const, color: '#FFFFFF', backgroundColor, height: 24 });
  const rows = [
    [bold(`${org.name} · ${TITLE(teams)}`)],
    [],
    [band('DATE', '#374151'), ...teams.map((t) => band(LABEL[t], TEAM_INFO[t].colour))],
    ...lines.map((l) => [
      { value: new Date(`${l.date}T12:00:00Z`), type: Date, format: 'ddd dd mmm yyyy' },
      ...teams.map((t) => ({ value: t === 'host' ? l.host : l.prayer, type: String, wrap: true })),
    ]),
    [],
    [{ value: POWERED_BY, type: String }],
  ];
  const blob = await writeXlsxFile(rows as never, { columns: [{ width: 18 }, ...teams.map(() => ({ width: 50 }))] }) as unknown as Blob;
  return new File([blob], fileName(teams, 'xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadRota(org: Organization, kind: 'pdf' | 'xlsx', teams: readonly Team[] = TEAMS): Promise<void> {
  downloadFile(kind === 'pdf' ? await rotaPdf(org, teams) : await rotaExcel(org, teams));
}
