/**
 * ADIA lesson plans and course files. Round 2 (Andy, 2026-11-17 11:51, 1A-9A with 7B): a lesson plan is for one
 * lesson DATE, picked on a calendar where days with a plan are green and days a class register was marked without a
 * plan are red. A "What is it?" dropdown also takes a scheme of work, course outline, notes, CAT or exam paper or
 * report for the course. Courses come from Exam Records or the principal's "Courses and tutors" list (one tutor
 * each). Emails: 6pm on a register day with no plan, and a Friday summary. Earlier (round 1): ADIA weekly lesson plans (1A-9A). Every teacher, including those who teach the common courses,
 * picks one of their own courses and a week and uploads that week's plan: PDF, Word, PowerPoint, Excel, OpenOffice,
 * text or photos, up to 20 MB each, several at once. The teacher can replace or remove files until the principal
 * approves; then the plan locks ("Ask to change" opens it again). The principal sees teachers down the side and weeks
 * across. Each Friday ADIA's Gmail reminds teachers who have not uploaded next week's plan.
 *
 * Plans are tutorFiles documents of kind "week", so the principal's Approve / Send back / Open again work as before.
 */
import { addDays } from './metrics.js';
import { cohortKey } from './examCohorts.js';
import { commonClassName } from './commonCourses.js';

export const LESSON_MAX_BYTES = 20 * 1024 * 1024;
export const LESSON_MAX_FILES = 10;
/** Files travel in pieces of this size (a callable carries about 10 MB at most). */
export const LESSON_CHUNK_BYTES = 4 * 1024 * 1024;
export const LESSON_MAX_PARTS = Math.ceil(LESSON_MAX_BYTES / LESSON_CHUNK_BYTES);
/** One of a teacher's courses in the dropdown. registerName is the class register its lessons are marked in. */
export interface TeachingCourse { key: string; label: string; registerName?: string }

/** What a tutor can upload for a course (4A). New kinds go at the end of this list. */
export const DOC_TYPES = ['lesson', 'scheme', 'outline', 'notes', 'paper', 'report'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  lesson: 'Lesson plan', scheme: 'Scheme of work', outline: 'Course outline', notes: 'Notes or handouts', paper: 'CAT or exam paper', report: 'Report',
};
export const isDocType = (v: unknown): v is DocType => typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);
/** Files one upload holds: a lesson plan, or all of a course's files of one kind. */
export const maxFilesFor = (t: DocType) => (t === 'lesson' ? LESSON_MAX_FILES : 30);
/** How far back and forward a lesson date may be picked. */
// Round 3 (Andy, 2026-11-17 12:29, 5): past plans as far back as they want, and the next two weeks ahead.
export const FIRST_DAY = '2020-01-01';
export const DAYS_AHEAD = 14;
/** How far back red days (registers without a plan) are looked for. */
export const DAYS_BACK = 120;
export const isAllowedDay = (day: string, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && day >= FIRST_DAY && day <= addDays(today, DAYS_AHEAD);

/** Lesson plan for a date: lp_{course}_{day}_{uid}. Other kinds: one per course and kind, cf_{course}_{kind}_{uid}. */
export const uploadFileId = (courseKey: string, type: DocType, day: string, uid: string) =>
  (type === 'lesson' ? `lp_${courseKey}_${day}_${uid}` : `cf_${courseKey}_${type}_${uid}`).slice(0, 300);

/** A course the principal adds on the Lesson plans page, without Exam Records (6A). One tutor (7B). */
export interface ManualCourse { id: string; name: string; department: string; cohort?: string; tutorUid: string; tutorName: string; deletedAt?: unknown }

/** One uploaded file in a week's plan. */
export interface LessonItem { id: string; name: string; contentType: string; size: number; uploadedOn: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'course';

export const lessonItemPath = (orgId: string, fileId: string, itemId: string) => `lessonPlans/${orgId}/${fileId}/${itemId}`;
export const lessonPartPath = (orgId: string, uid: string, uploadId: string, n: number) => `lessonParts/${orgId}/${uid}/${uploadId}/${n}`;

interface SheetLike { id: string; courseName?: string; cohort?: string; ownerUid?: string; courseId?: string | null; deletedAt?: unknown }

/**
 * The courses a teacher teaches (2A): their marks sheets in cohorts that are still open, one entry per course and
 * cohort (a common course's Semester 1 and 2 sheets are one course), and the courses the principal gave them on the
 * Lesson plans page. A trainer with neither gets their class registers, so nobody is left with an empty dropdown.
 * programmeNames maps a department id to its name, which is the name of that department's class register.
 */
export function teachingCourses(
  uid: string, sheets: readonly SheetLike[], closedCohortKeys: ReadonlySet<string>, registerClasses: readonly string[] = [],
  programmeNames: Readonly<Record<string, string>> = {}, manual: readonly ManualCourse[] = [],
): TeachingCourse[] {
  const out = new Map<string, TeachingCourse>();
  for (const s of sheets) {
    if (s.ownerUid !== uid || s.deletedAt || !s.courseName?.trim()) continue;
    const cohort = (s.cohort ?? '').trim();
    if (cohort && closedCohortKeys.has(cohortKey(cohort))) continue;
    const key = `c-${slug(s.courseName)}-${slug(cohort || 'none')}`;
    const registerName = s.courseId ? programmeNames[s.courseId] ?? '' : cohort ? commonClassName(s.courseName, cohort) : s.courseName.trim();
    if (!out.has(key)) out.set(key, { key, label: cohort ? `${s.courseName.trim()} · ${cohort}` : s.courseName.trim(), registerName });
  }
  for (const m of manual) {
    if (m.tutorUid !== uid || m.deletedAt || !m.name?.trim()) continue;
    const cohort = (m.cohort ?? '').trim();
    const registerName = m.department && m.department !== 'common' ? programmeNames[m.department] ?? '' : cohort ? commonClassName(m.name, cohort) : m.name.trim();
    out.set(`m-${m.id}`, { key: `m-${m.id}`, label: cohort ? `${m.name.trim()} · ${cohort}` : m.name.trim(), registerName });
  }
  if (!out.size) {
    for (const name of registerClasses) {
      if (!name?.trim()) continue;
      const key = `r-${slug(name)}`;
      if (!out.has(key)) out.set(key, { key, label: name.trim(), registerName: name.trim() });
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** A class held: a register marked on a date (3A). */
export interface LessonDay { date: string; registerName: string }

type EventLike = { name?: string; date?: string; type?: string; deletedAt?: unknown; createdBy?: string; updatedBy?: string };

/**
 * The days a teacher reported for teaching (Andy, 2026-11-17 12:29, 1A): registers of their courses that THEY
 * marked. A register marked by someone else never counts, and no day is assumed. Sending a plan is the other way a
 * day counts, and that day is green anyway.
 */
export function lessonDaysOf(uid: string, courses: readonly TeachingCourse[], events: readonly EventLike[], today: string): LessonDay[] {
  const names = new Set(courses.map((c) => c.registerName).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const out: LessonDay[] = [];
  for (const e of events) {
    if (e.deletedAt || e.type !== 'class' || !e.name || !e.date || e.date > today || !names.has(e.name)) continue;
    if (e.createdBy !== uid && e.updatedBy !== uid) continue;
    const k = `${e.date}|${e.name}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ date: e.date, registerName: e.name });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.registerName.localeCompare(b.registerName));
}

interface PlanLike { status: WeekStatus; courseKey?: string; docType?: string; day: string; files?: unknown[]; reopenUntil?: string | null }

/**
 * Is a lesson covered? A lesson plan on that date for any of the teacher's courses taught in that register counts
 * (a department tutor's units share the department's register).
 */
export function lessonCovered(lesson: LessonDay, courses: readonly TeachingCourse[], plans: readonly PlanLike[]): boolean {
  const keys = new Set(courses.filter((c) => c.registerName === lesson.registerName).map((c) => c.key));
  return plans.some((p) => p.docType === 'lesson' && p.day === lesson.date && keys.has(p.courseKey ?? '') && hasPlan(p));
}

export const missingLessons = (lessons: readonly LessonDay[], courses: readonly TeachingCourse[], plans: readonly PlanLike[]) =>
  lessons.filter((l) => !lessonCovered(l, courses, plans));

/** The calendar's colours for one course (2A): green = plan sent, red = register marked but no plan. */
export function dayColours(course: TeachingCourse, courses: readonly TeachingCourse[], lessons: readonly LessonDay[], plans: readonly PlanLike[]): Record<string, 'done' | 'missing'> {
  const out: Record<string, 'done' | 'missing'> = {};
  for (const l of lessons) if (l.registerName === course.registerName) out[l.date] = lessonCovered(l, courses, plans) ? 'done' : 'missing';
  for (const p of plans) if (p.docType === 'lesson' && p.courseKey === course.key && hasPlan(p)) out[p.day] = 'done';
  return out;
}

/** One box of the principal's table (6A): plans sent that week, and the teacher's own registers with no plan. */
export function weekBox(monday: string, lessons: readonly LessonDay[], courses: readonly TeachingCourse[], plans: readonly PlanLike[]): { sent: number; missing: number } {
  const sunday = addDays(monday, 6);
  const sent = plans.filter((p) => p.docType === 'lesson' && hasPlan(p) && p.day >= monday && p.day <= sunday).length;
  const missing = lessons.filter((l) => l.date >= monday && l.date <= sunday && !lessonCovered(l, courses, plans)).length;
  return { sent, missing };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Tue 17 Nov". */
export const dayLabel = (key: string) => `${DAY_NAMES[new Date(`${key}T12:00:00Z`).getUTCDay()]} ${short(key)}`;

export function sixPmEmail(firstName: string, missing: readonly LessonDay[], link: string): { subject: string; text: string } {
  return {
    subject: 'Reminder: today\'s lesson plan',
    text: [
      `Dear ${firstName},`, '',
      `You marked the register today for ${missing.map((l) => l.registerName).join(', ')}, but the lesson plan has not been uploaded yet.`, '',
      `Open this link, pick the course and today's date, then choose your file (${LESSON_TYPES_TEXT}): ${link}`, '',
      'Thank you.', 'ADIA Training Centre',
    ].join('\n'),
  };
}

export function fridayEmail(firstName: string, missing: readonly LessonDay[], link: string): { subject: string; text: string } {
  return {
    subject: `Lesson plans missing for ${missing.length} ${missing.length === 1 ? 'lesson' : 'lessons'}`,
    text: [
      `Dear ${firstName},`, '',
      'These lessons have a register but no lesson plan yet:',
      ...missing.map((l) => `  • ${dayLabel(l.date)}: ${l.registerName}`), '',
      `Open this link, pick the course, tap the red day on the calendar and choose your file: ${link}`, '',
      'Thank you.', 'ADIA Training Centre',
    ].join('\n'),
  };
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
export function canChange(f: WeekLike | null | undefined, today: string): boolean {
  if (!f) return true;
  if (f.status !== 'approved') return true;
  return !!f.reopenUntil && today <= f.reopenUntil;
}

export const hasPlan = (f: WeekLike | null | undefined) => !!f && (f.files?.length ?? 0) > 0;

/** Folder and file names inside "Download all" (9A): "Jane Achieng/Electrical · Cohort 4/plan.pdf". */
export function zipPath(tutorName: string, courseLabel: string, fileName: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'File';
  const base = `${clean(tutorName)}/${clean(courseLabel)}/${clean(fileName)}`;
  let path = base; let n = 2;
  while (taken.has(path)) { const ext = extOf(base); path = ext ? `${base.slice(0, -(ext.length + 1))} (${n++}).${ext}` : `${base} (${n++})`; }
  taken.add(path);
  return path;
}
