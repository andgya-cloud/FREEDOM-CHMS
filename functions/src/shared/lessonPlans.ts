/**
 * ADIA weekly lesson plans (Andy, 2026-11-17, 1A-9A). Every teacher, including those who teach the common courses,
 * picks one of their own courses and a week and uploads that week's plan: PDF, Word, PowerPoint, Excel, OpenOffice,
 * text or photos, up to 20 MB each, several at once. The teacher can replace or remove files until the principal
 * approves; then the plan locks ("Ask to change" opens it again). The principal sees teachers down the side and weeks
 * across. Each Friday ADIA's Gmail reminds teachers who have not uploaded next week's plan.
 *
 * Plans are tutorFiles documents of kind "week", so the principal's Approve / Send back / Open again work as before.
 */
import { addDays, mondayOf } from './metrics.js';
import { cohortKey } from './examCohorts.js';

export const LESSON_MAX_BYTES = 20 * 1024 * 1024;
export const LESSON_MAX_FILES = 10;
/** Files travel in pieces of this size (a callable carries about 10 MB at most). */
export const LESSON_CHUNK_BYTES = 4 * 1024 * 1024;
export const LESSON_MAX_PARTS = Math.ceil(LESSON_MAX_BYTES / LESSON_CHUNK_BYTES);
/** How far back and forward a teacher may upload. */
export const WEEKS_BACK = 8;
export const WEEKS_AHEAD = 4;

/** One of a teacher's courses in the dropdown. */
export interface TeachingCourse { key: string; label: string }

/** One uploaded file in a week's plan. */
export interface LessonItem { id: string; name: string; contentType: string; size: number; uploadedOn: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'course';

export const weekFileId = (courseKey: string, monday: string, uid: string) => `week_${courseKey}_${monday}_${uid}`.slice(0, 300);
export const lessonItemPath = (orgId: string, fileId: string, itemId: string) => `lessonPlans/${orgId}/${fileId}/${itemId}`;
export const lessonPartPath = (orgId: string, uid: string, uploadId: string, n: number) => `lessonParts/${orgId}/${uid}/${uploadId}/${n}`;

interface SheetLike { id: string; courseName?: string; cohort?: string; ownerUid?: string; deletedAt?: unknown }

/**
 * The courses a teacher teaches (2A): their marks sheets in cohorts that are still open, one entry per course and
 * cohort (a common course's Semester 1 and 2 sheets are one course). A teacher with no sheets yet gets their
 * class registers instead, so nobody is left with an empty dropdown.
 */
export function teachingCourses(uid: string, sheets: readonly SheetLike[], closedCohortKeys: ReadonlySet<string>, registerClasses: readonly string[] = []): TeachingCourse[] {
  const out = new Map<string, TeachingCourse>();
  for (const s of sheets) {
    if (s.ownerUid !== uid || s.deletedAt || !s.courseName?.trim()) continue;
    const cohort = (s.cohort ?? '').trim();
    if (cohort && closedCohortKeys.has(cohortKey(cohort))) continue;
    const key = `c-${slug(s.courseName)}-${slug(cohort || 'none')}`;
    if (!out.has(key)) out.set(key, { key, label: cohort ? `${s.courseName.trim()} · ${cohort}` : s.courseName.trim() });
  }
  if (!out.size) {
    for (const name of registerClasses) {
      if (!name?.trim()) continue;
      const key = `r-${slug(name)}`;
      if (!out.has(key)) out.set(key, { key, label: name.trim() });
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** The Mondays a teacher may pick, newest first, with plain names. */
export function weekChoices(today: string): { monday: string; label: string }[] {
  const now = mondayOf(today);
  const out: { monday: string; label: string }[] = [];
  for (let i = WEEKS_AHEAD; i >= -WEEKS_BACK; i--) {
    const monday = addDays(now, 7 * i);
    const name = i === 0 ? 'This week' : i === 1 ? 'Next week' : i === -1 ? 'Last week' : '';
    out.push({ monday, label: `${name ? `${name} · ` : ''}${weekRange(monday)}` });
  }
  return out;
}

export function isAllowedWeek(monday: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(monday) && mondayOf(monday) === monday && weekChoices(today).some((w) => w.monday === monday);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
/** "17 to 23 Nov" or "29 Dec to 4 Jan". */
export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  return monday.slice(5, 7) === sunday.slice(5, 7) ? `${Number(monday.slice(8, 10))} to ${short(sunday)}` : `${short(monday)} to ${short(sunday)}`;
}

/** The kinds of file accepted (4A), by extension. */
export const LESSON_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
};
export const LESSON_ACCEPT = Object.keys(LESSON_TYPES).map((e) => `.${e}`).join(',') + ',image/*';
export const LESSON_TYPES_TEXT = 'PDF, Word, PowerPoint, Excel, OpenOffice, text or photos';

export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? '').toLowerCase();

const ZIP = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'];
const OLE = ['doc', 'xls', 'ppt'];

/**
 * Is this really the kind of file its name says? Checked on the first bytes, so a renamed program can't get in.
 * Text files (txt, csv) have no signature: they must hold no zero bytes. Returns the type to store, or null.
 */
export function lessonFileType(name: string, head: Uint8Array): { ext: string; contentType: string } | null {
  const ext = extOf(name);
  const contentType = LESSON_TYPES[ext];
  if (!contentType) return null;
  const b = head;
  const starts = (...sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
  const ascii = (from: number, text: string) => b.length >= from + text.length && [...text].every((c, i) => b[from + i] === c.charCodeAt(0));
  let ok = false;
  if (ext === 'pdf') ok = ascii(0, '%PDF-');
  else if (ZIP.includes(ext)) ok = starts(0x50, 0x4b, 0x03, 0x04);
  else if (OLE.includes(ext)) ok = starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  else if (ext === 'rtf') ok = ascii(0, '{\\rtf');
  else if (ext === 'jpg' || ext === 'jpeg') ok = starts(0xff, 0xd8, 0xff);
  else if (ext === 'png') ok = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  else if (ext === 'webp') ok = ascii(0, 'RIFF') && ascii(8, 'WEBP');
  else if (ext === 'heic' || ext === 'heif') ok = ascii(4, 'ftyp') && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].some((brand) => ascii(8, brand));
  else if (ext === 'txt' || ext === 'csv') ok = b.length > 0 && !b.includes(0);
  return ok ? { ext, contentType } : null;
}

/** A safe file name, keeping the teacher's own name for it. */
export function cleanFileName(name: string): string {
  const ext = extOf(name);
  const base = name.slice(0, ext ? -(ext.length + 1) : undefined).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Lesson plan';
  return ext ? `${base}.${ext}` : base;
}

export type WeekStatus = 'sent' | 'approved' | 'returned';
interface WeekLike { status: WeekStatus; reopenUntil?: string | null; files?: unknown[] }

/** 7A: the teacher may add, replace or remove files until the plan is approved (or while the principal reopened it). */
export function canChangeWeek(f: WeekLike | null | undefined, today: string): boolean {
  if (!f) return true;
  if (f.status !== 'approved') return true;
  return !!f.reopenUntil && today <= f.reopenUntil;
}

export const hasPlan = (f: WeekLike | null | undefined) => !!f && (f.files?.length ?? 0) > 0;

/** One cell of the principal's grid (9A): every course has a plan, some do, or none. */
export function cellState(courseKeys: readonly string[], plans: readonly (WeekLike & { courseKey: string })[]): { done: number; of: number; state: 'all' | 'some' | 'none' } {
  const done = courseKeys.filter((k) => plans.some((p) => p.courseKey === k && hasPlan(p))).length;
  return { done, of: courseKeys.length, state: courseKeys.length && done === courseKeys.length ? 'all' : done ? 'some' : 'none' };
}

/** The courses still without next week's plan, for the Friday email (6A). */
export function missingCourses(courses: readonly TeachingCourse[], plans: readonly (WeekLike & { courseKey: string })[]): TeachingCourse[] {
  return courses.filter((c) => !plans.some((p) => p.courseKey === c.key && hasPlan(p)));
}

export function reminderEmail(firstName: string, monday: string, missing: readonly TeachingCourse[], link: string): { subject: string; text: string } {
  return {
    subject: `Reminder: lesson plan${missing.length === 1 ? '' : 's'} for next week (${weekRange(monday)})`,
    text: [
      `Dear ${firstName},`,
      '',
      `Please upload your lesson plan for next week (${weekRange(monday)}) for:`,
      ...missing.map((c) => `  • ${c.label}`),
      '',
      `Open this link, pick the course and choose your file (${LESSON_TYPES_TEXT}): ${link}`,
      '',
      'Thank you.',
      'ADIA Training Centre',
    ].join('\n'),
  };
}

/** Folder and file names inside "Download all" (9A): "Jane Achieng/Electrical · Cohort 4/plan.pdf". */
export function zipPath(tutorName: string, courseLabel: string, fileName: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'File';
  const base = `${clean(tutorName)}/${clean(courseLabel)}/${clean(fileName)}`;
  let path = base; let n = 2;
  while (taken.has(path)) { const ext = extOf(base); path = ext ? `${base.slice(0, -(ext.length + 1))} (${n++}).${ext}` : `${base} (${n++})`; }
  taken.add(path);
  return path;
}
