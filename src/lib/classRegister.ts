import { deleteField, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import writeXlsxFile from 'write-excel-file';
import { db, functions } from '../firebase';
import { updateRecord, softDelete } from './records';
import { saveProgram } from './programWrites';
import { createEvent } from './attendanceWrites';
import type { Organization } from '../state/OrgContext';
import type { Program } from '../state/usePrograms';
import { programSessionIdFor, type PlanEntry } from '../../functions/src/shared/programs';
import { F252_ID, F252_SETUP, percentOf, QR_SLOT_SECONDS, slotNow } from '../../functions/src/shared/classRegister';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { POWERED_BY, stampPoweredBy } from '../../functions/src/shared/poweredBy';

/**
 * Freedom 252 class register (Andy, 2026-11-09, 1A-7A): the QR check-in, the register grid, ticks by hand and the
 * downloads. The server side is the classRegister callable.
 */

export const APP_URL = typeof window !== 'undefined' ? window.location.origin : 'https://freedom-chms.web.app';
const call = <T,>(data: Record<string, unknown>) => httpsCallable<Record<string, unknown>, T>(functions, 'classRegister')(data).then((r) => r.data);

/** Puts the 24 real topics and class dates from the 2027 calendar on Freedom 252 (adds the programme if missing). */
export function setUpFreedom252(orgId: string, exists: boolean) {
  return saveProgram(orgId, F252_ID, F252_SETUP, exists);
}

/**
 * Opens tonight's class (or a make-up class) so it can be scanned: one class per programme per day.
 * Returns the class id; if it is already open nothing changes.
 */
export function openClass(org: Organization, program: Program, date: string, topicId: string, plan: PlanEntry | null, alreadyOpen: boolean) {
  const id = programSessionIdFor(date, program.id, null);
  if (alreadyOpen) return { id, synced: Promise.resolve() };
  const topic = program.topics.find((t) => t.id === topicId)?.name ?? '';
  const name = `${program.name} · ${plan ? `${plan.label.replace(/^Semester (\d) · /, 'Sem $1 ')}: ` : 'Make-up: '}${topic}`.slice(0, 120);
  return createEvent(org.id, { date, type: 'class', name, activity: program.name }, {
    id, programId: program.id, cohortId: null, topicIds: [topicId], mentor: null, mentorId: null,
  });
}

/** The class's secret, so this screen can draw a code that changes every minute (1A). */
export const classKey = (orgId: string, eventId: string) => call<{ key: string }>({ action: 'key', orgId, eventId }).then((r) => r.key);

/** The code for this minute: the same sum the server checks. */
export async function codeFor(key: string, slot = slotNow()): Promise<string> {
  const bytes = new Uint8Array(key.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const k = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(String(slot))));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
export const secondsLeft = () => QR_SLOT_SECONDS - (Math.floor(Date.now() / 1000) % QR_SLOT_SECONDS);

/** Each student's progress link (5A, for the reminders). */
export const progressLinks = (orgId: string, programId: string) =>
  call<{ links: Record<string, string> }>({ action: 'links', orgId, programId }).then((r) => r.links);

export interface StudentImportRow { name: string; phone: string; email: string; whatsapp: boolean; note: string }
export const importStudents = (orgId: string, programId: string, rows: StudentImportRow[]) =>
  call<{ added: number; enrolled: number; already: number; problems: string[] }>({ action: 'import', orgId, programId, rows });

/** Reads a students list: a column with "name", and optionally phone, email, preferred contact and message. */
export async function readStudentsFile(file: File): Promise<StudentImportRow[]> {
  let table: string[][];
  if (/\.csv$/i.test(file.name)) {
    table = (await file.text()).split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
  } else {
    const { default: readXlsxFile } = await import('read-excel-file');
    table = (await readXlsxFile(file)).map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
  }
  const headAt = table.findIndex((r) => r.some((c) => /name/i.test(c)));
  if (headAt < 0) throw new Error('The file needs a column called Name.');
  const head = table[headAt]!.map((c) => c.toLowerCase());
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const n = col(/name/), p = col(/phone|mobile|number/), e = col(/mail/), c = col(/contact|prefer/), m = col(/message|note/);
  return table.slice(headAt + 1).map((r) => ({
    name: r[n] ?? '', phone: p >= 0 ? r[p] ?? '' : '', email: e >= 0 ? r[e] ?? '' : '',
    whatsapp: c >= 0 ? !/phone call|email/i.test(r[c] ?? '') || /whatsapp/i.test(r[c] ?? '') : true,
    note: m >= 0 && r[m] && r[m] !== '-' ? r[m]! : '',
  })).filter((r) => r.name.trim());
}

const enrolRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'enrollments', id);

/** Ticks a topic as done by hand, for a special case (4A), or takes the tick back. */
export function tickTopic(orgId: string, enrollmentId: string, topicId: string, date: string | null) {
  return updateRecord(enrolRef(orgId, enrollmentId), { [`manualTopics.${topicId}`]: date ?? deleteField() });
}

/** "Check these" (3A): OK keeps the self-added student; Remove takes the enrolment out. */
export const keepStudent = (orgId: string, enrollmentId: string) => updateRecord(enrolRef(orgId, enrollmentId), { selfAdded: false });
export const removeStudent = (orgId: string, enrollmentId: string) => softDelete(enrolRef(orgId, enrollmentId));

// ---- Downloads (7A) ------------------------------------------------------------

export interface GridRow { name: string; phone: string; cells: ('class' | 'hand' | null)[]; done: number }
const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The register as one A4 landscape grid: a row per student, a column per topic, then %; topic names below. */
export async function registerPdf(org: Organization, program: Program, rows: GridRow[], today: string, graduation: string | null): Promise<File> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const topics = program.topics;
  const nameW = 58, pctW = 16, x0 = 10;
  const cw = Math.min(9, (W - x0 * 2 - nameW - pctW) / Math.max(1, topics.length));
  const head = () => {
    pdf.setFillColor(176, 137, 52); pdf.rect(0, 0, W, 3.5, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(30, 30, 30);
    pdf.text(`${program.name} class register`, x0, 14);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(110, 110, 110);
    pdf.text(`${org.name} · ${formatDateKey(today)} · ${rows.length} students${graduation ? ` · Graduation ${formatDateKey(graduation)}` : ''} · dot = at class, H = ticked by hand`, x0, 20);
    let y = 28;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(30, 30, 30);
    pdf.text('Student', x0 + 1, y);
    topics.forEach((_, i) => pdf.text(String(i + 1), x0 + nameW + cw * i + cw / 2, y, { align: 'center' }));
    pdf.text('%', x0 + nameW + cw * topics.length + pctW / 2, y, { align: 'center' });
    y += 2;
    pdf.setDrawColor(200, 200, 200); pdf.line(x0, y, W - x0, y);
    return y + 4.5;
  };
  let y = head();
  rows.forEach((r, n) => {
    if (y > H - 18) { pdf.addPage(); y = head(); }
    if (n % 2 === 0) { pdf.setFillColor(246, 244, 238); pdf.rect(x0, y - 3.6, W - x0 * 2, 5.4, 'F'); }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(30, 30, 30);
    pdf.text((pdf.splitTextToSize(r.name, nameW - 2) as string[])[0] ?? '', x0 + 1, y);
    r.cells.forEach((c, i) => {
      if (!c) return;
      const cx = x0 + nameW + cw * i + cw / 2;
      if (c === 'class') { pdf.setFillColor(31, 122, 77); pdf.circle(cx, y - 1.1, 1.6, 'F'); }
      else { pdf.setTextColor(176, 137, 52); pdf.setFont('helvetica', 'bold'); pdf.text('H', cx, y, { align: 'center' }); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30, 30, 30); }
    });
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${percentOf(r.done, topics.length)}%`, x0 + nameW + cw * topics.length + pctW / 2, y, { align: 'center' });
    y += 5.4;
  });
  // Topic names, two columns.
  y += 4;
  if (y > H - 40) { pdf.addPage(); y = 16; }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(30, 30, 30);
  pdf.text('Topics', x0, y); y += 5;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.8); pdf.setTextColor(80, 80, 80);
  const half = Math.ceil(topics.length / 2);
  const plan = program.plan ?? [];
  topics.forEach((t, i) => {
    const col = i < half ? 0 : 1, row = i < half ? i : i - half;
    const p = plan.find((x) => x.topicId === t.id);
    pdf.text(`${i + 1}. ${t.name}${p ? ` (${formatDateKey(p.date)})` : ''}`, x0 + col * ((W - x0 * 2) / 2), y + row * 4);
  });
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `${safe(program.name)}-register-${today}.pdf`, { type: 'application/pdf' });
}

type Cell = { value: string | number | null; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold' } | null;
const t = (value: string): Cell => ({ value, type: String });
const b = (value: string): Cell => ({ value, type: String, fontWeight: 'bold' });

/** The register as Excel: the grid, then who still needs which topics. */
export async function registerExcel(org: Organization, program: Program, rows: GridRow[], today: string): Promise<File> {
  const topics = program.topics;
  const sheet: Cell[][] = [[b(`${org.name} · ${program.name} class register · ${formatDateKey(today)}`)], [t('X = at class, H = ticked by hand')], [],
    [b('Student'), b('Phone'), ...topics.map((tp, i) => b(`${i + 1}. ${tp.name}`)), b('Done'), b('%')],
    ...rows.map((r) => [t(r.name), t(r.phone), ...r.cells.map((c) => t(c === 'class' ? 'X' : c === 'hand' ? 'H' : '')),
      { value: r.done, type: Number }, { value: percentOf(r.done, topics.length), type: Number }] as Cell[]),
    [], [b('Still to do before graduation')],
    ...rows.filter((r) => r.done < topics.length).map((r) => [t(r.name), t(''), t(topics.filter((_, i) => !r.cells[i]).map((tp) => tp.name).join('; '))]),
    [], [t(POWERED_BY)]];
  const blob = await writeXlsxFile(sheet as never, { columns: [30, 15, ...topics.map(() => 14), 7, 7].map((width) => ({ width })) } as never) as unknown as Blob;
  return new File([blob], `${safe(program.name)}-register-${today}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
