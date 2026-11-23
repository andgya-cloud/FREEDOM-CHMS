import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { downloadFile, newPdf } from './givingPdf';
import { logoImage } from './pettyPdf';
import { drawLetterhead, GREY, INK, letterheadFor } from '../../functions/src/shared/pettyVoucher';
import { POWERED_BY, stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { extOf, LESSON_CHUNK_BYTES, LESSON_MAX_BYTES } from '../../functions/src/shared/lessonPlans';
import { lessonLine, ssDayLabel, SS_TYPES, SS_TYPES_TEXT, yearRows, type SsDay, type SsFile } from '../../functions/src/shared/ssTimetable';
import type { SsClass } from '../../functions/src/shared/sundaySchool';

/** The Sunday school timetable's changes and files (Andy, 2026-11-24). Reading is straight from the database. */
const call = <R,>(data: Record<string, unknown> & { orgId: string; action: string }) =>
  httpsCallable<typeof data, R>(functions, 'ssTimetable', { timeout: 180_000 })(data).then((r) => r.data);

export const saveSsDay = (orgId: string, day: Partial<SsDay>) => call<{ date: string; removed?: boolean }>({ orgId, action: 'save', day });
export const removeSsDay = (orgId: string, date: string) => call({ orgId, action: 'remove', date });
export const fillSsSeries = (orgId: string, start: string, series: string, weeks: number) => call<{ dates: string[] }>({ orgId, action: 'fill', start, series, weeks });
export const copySsYear = (orgId: string, from: number) => call<{ copied: number }>({ orgId, action: 'copyYear', from });
export const saveSsDrive = (orgId: string, link: string) => call<{ driveFolder: string }>({ orgId, action: 'drive', link });
export const removeSsFile = (orgId: string, date: string, itemId: string) => call({ orgId, action: 'removeFile', date, itemId });
export type SsReminders = { date: string; group: string; list: { classId: string; className: string; teacher: string; phone: string; text: string }[] };
export const ssReminders = (orgId: string, date?: string) => call<SsReminders>({ orgId, action: 'reminders', ...(date ? { date } : {}) });

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function nameFor(file: File): string {
  if (extOf(file.name) in SS_TYPES) return file.name;
  const ext = Object.entries(SS_TYPES).find(([, t]) => t === file.type)?.[0];
  return ext ? `${file.name || 'File'}.${ext}` : file.name;
}
export function checkSsFile(file: File): string | null {
  if (!(extOf(nameFor(file)) in SS_TYPES)) return `${file.name} is not a ${SS_TYPES_TEXT} file.`;
  if (file.size > LESSON_MAX_BYTES) return `${file.name} is larger than 20 MB. Put it in the Google Drive folder and paste its link instead.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

/** One file to a day (and a class, or the whole day), in 4 MB pieces. */
export async function uploadSsFile(orgId: string, date: string, classId: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  const problem = checkSsFile(file);
  if (problem) throw new Error(problem);
  const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
  const parts = Math.max(1, Math.ceil(file.size / LESSON_CHUNK_BYTES));
  for (let n = 0; n < parts; n++) {
    await call({ orgId, action: 'part', uploadId, n, data: await toBase64(file.slice(n * LESSON_CHUNK_BYTES, (n + 1) * LESSON_CHUNK_BYTES)) });
    onProgress?.((n + 1) / (parts + 1));
  }
  await call({ orgId, action: 'addFile', date, classId, uploadId, parts, name: nameFor(file) });
  onProgress?.(1);
}

export async function downloadSsFile(orgId: string, date: string, item: Pick<SsFile, 'id'>): Promise<void> {
  const chunks: Uint8Array[] = [];
  let start = 0; let name = 'Lesson'; let type = 'application/octet-stream'; let size = 1;
  while (start < size) {
    const r = await call<{ name: string; contentType: string; size: number; data: string }>({ orgId, action: 'download', date, itemId: item.id, start });
    name = r.name; type = r.contentType; size = r.size;
    if (!r.data) break;
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    chunks.push(bytes); start += bytes.length;
  }
  downloadFile(new File(chunks as BlobPart[], name, { type }));
}

/* ---------- The year to download (10A) ---------- */
type Row = { date: string; what: string; theme: string; lessons: string[] };
function rowsOf(year: number, days: SsDay[], classes: SsClass[]): Row[] {
  return yearRows(year, days).map(({ date, day }) => ({
    date,
    what: day?.kind === 'special' ? `★ ${day.title}` : day?.noClass ? `No Sunday school${day.title ? ` · ${day.title}` : ''}` : day?.title ?? '',
    theme: [day?.theme, day?.series && !day.theme?.startsWith(day.series) ? `(${day.series})` : ''].filter(Boolean).join(' '),
    lessons: classes.map((c) => {
      const l = day?.lessons[c.id];
      if (!l) return '';
      return [lessonLine(l), l.verse && `Verse: ${l.verse}`, l.teacher && `Teacher: ${l.teacher}`].filter(Boolean).join('\n');
    }),
  }));
}
const fileName = (year: number, ext: string) => `Sunday-School-Timetable-${year}.${ext}`;

export async function ssTimetablePdf(org: { name: string; type?: string }, year: number, days: SsDay[], classes: SsClass[]): Promise<File> {
  const rows = rowsOf(year, days, classes);
  const pdf = await newPdf('a4', 'landscape');
  const w = pdf.internal.pageSize.getWidth();
  const bottom = pdf.internal.pageSize.getHeight() - 22;
  const lh = letterheadFor(org);
  let y = drawLetterhead(pdf, lh, await logoImage(lh.crest), `Sunday School Teaching Timetable ${year}`, 'Freedom Church Sunday School');
  const dateW = 26; const themeW = 52;
  const classW = (w - 28 - dateW - themeW) / Math.max(1, classes.length);
  const xs = [14, 14 + dateW, 14 + dateW + themeW, ...classes.map((_, i) => 14 + dateW + themeW + classW * (i + 1))];
  const header = () => {
    pdf.setFillColor(31, 75, 51); pdf.rect(14, y, w - 28, 10, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(255, 255, 255);
    pdf.text('SUNDAY', xs[0]! + 2, y + 6.5); pdf.text('THEME', xs[1]! + 2, y + 6.5);
    classes.forEach((c, i) => pdf.text((pdf.splitTextToSize(`${c.name}${c.leader ? ` · ${c.leader}` : ''}`.toUpperCase(), classW - 3) as string[])[0]!, xs[2 + i]! + 2, y + 6.5));
    y += 12;
  };
  header();
  rows.forEach((r, i) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    const theme = pdf.splitTextToSize([r.what, r.theme].filter(Boolean).join('\n') || '—', themeW - 3) as string[];
    const cells = r.lessons.map((t) => pdf.splitTextToSize(t || '', classW - 3) as string[]);
    const h = Math.max(theme.length, ...cells.map((c) => c.length), 1) * 3.6 + 3;
    if (y + h > bottom) { pdf.addPage(); y = 18; header(); }
    if (i % 2 === 0) { pdf.setFillColor(244, 247, 244); pdf.rect(14, y - 1, w - 28, h, 'F'); }
    pdf.setTextColor(...INK);
    pdf.setFont('helvetica', 'bold'); pdf.text(ssDayLabel(r.date, false), xs[0]! + 2, y + 3);
    pdf.setFont('helvetica', 'normal');
    theme.forEach((t, k) => { pdf.setTextColor(...(k === 0 && r.what ? [176, 120, 20] as [number, number, number] : INK)); pdf.text(t, xs[1]! + 2, y + 3 + k * 3.6); });
    pdf.setTextColor(...INK);
    cells.forEach((c, ci) => c.forEach((t, k) => pdf.text(t, xs[2 + ci]! + 2, y + 3 + k * 3.6)));
    y += h;
  });
  if (y + 6 < bottom) { pdf.setFontSize(7.5); pdf.setTextColor(...GREY); pdf.text(`Made ${new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}.`, 14, y + 4); }
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], fileName(year, 'pdf'), { type: 'application/pdf' });
}

export async function ssTimetableExcel(org: { name: string }, year: number, days: SsDay[], classes: SsClass[]): Promise<File> {
  const writeXlsxFile = (await import('write-excel-file')).default;
  const rows = rowsOf(year, days, classes);
  const band = (value: string) => ({ value, fontWeight: 'bold' as const, color: '#FFFFFF', backgroundColor: '#1F4B33', height: 24, wrap: true });
  const sheet = [
    [{ value: `${org.name} · Sunday School Teaching Timetable ${year}`, fontWeight: 'bold' as const }],
    [],
    [band('SUNDAY'), band('THEME'), ...classes.map((c) => band(`${c.name}${c.leader ? ` · ${c.leader}` : ''}`))],
    ...rows.map((r) => [
      { value: new Date(`${r.date}T12:00:00Z`), type: Date, format: 'ddd dd mmm yyyy' },
      { value: [r.what, r.theme].filter(Boolean).join('\n'), type: String, wrap: true },
      ...r.lessons.map((t) => ({ value: t, type: String, wrap: true })),
    ]),
    [],
    [{ value: POWERED_BY, type: String }],
  ];
  const blob = await writeXlsxFile(sheet as never, { columns: [{ width: 18 }, { width: 34 }, ...classes.map(() => ({ width: 34 }))] }) as unknown as Blob;
  return new File([blob], fileName(year, 'xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadSsTimetable(org: { name: string; type?: string }, year: number, days: SsDay[], classes: SsClass[], kind: 'pdf' | 'xlsx') {
  downloadFile(kind === 'pdf' ? await ssTimetablePdf(org, year, days, classes) : await ssTimetableExcel(org, year, days, classes));
}

/** wa.me with the message ready (9A: sent by hand). */
export function waLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '254');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
