/**
 * Freedom Church Sunday school teaching timetable (Andy, 2026-11-24, 1A-10A). The whole year as one list of Sundays,
 * with special days in between for the staff (Vacation Bible School and the like) (1A). It starts now: the rest of
 * December 2026, then 2027 (2A). Each Sunday has a theme typed in its own box, and each class its own lesson under
 * it (3A): title, Bible passage, memory verse, main point, activity, the teacher that day (6A) and a Google Drive
 * link, with files kept in the app (4A, 5A). Every teacher sees it; only Dorothy, Andy and Doreen change it. Dorothy
 * fills a series in one go and copies last year (7A). On Thursday the reminders for Sunday are ready to send on
 * WhatsApp by hand (8A, 9A). The year downloads as PDF and Excel (10A).
 */
import { extOf, lessonFileType, LESSON_TYPES } from './lessonPlans.js';

export const SS_FIRST_DAY = '2026-12-01';
/** Andy's Sunday school folder on Google Drive (2026-11-24); Dorothy can change it. */
export const SS_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/10uMzd5d8kOzlEUPOl_3gmj0DWvWAQ936';
export const SS_MAX_FILES = 12;

export interface SsLesson { title: string; passage: string; verse: string; point: string; activity: string; teacher: string; link: string }
export interface SsFile { id: string; name: string; contentType: string; size: number; classId: string; uploadedOn: string }
export interface SsDay {
  date: string;
  /** A Sunday, or a special day in between for the staff (1A). */
  kind: 'sunday' | 'special';
  /** "Easter Sunday", "Vacation Bible School". */
  title: string;
  /** No Sunday school that Sunday (a combined service, a holiday). */
  noClass: boolean;
  theme: string;
  series: string;
  /** What the special day is about: times, place, who comes. */
  note: string;
  link: string;
  lessons: Record<string, SsLesson>;
  files: SsFile[];
}

export const LESSON_FIELDS: { key: keyof SsLesson; label: string; hint: string; long?: boolean }[] = [
  { key: 'title', label: 'Lesson', hint: 'e.g. Joseph forgives his brothers' },
  { key: 'passage', label: 'Bible passage', hint: 'e.g. Genesis 45:1-15' },
  { key: 'verse', label: 'Memory verse', hint: 'e.g. Ephesians 4:32' },
  { key: 'point', label: 'Main point', hint: 'One sentence the children take home', long: true },
  { key: 'activity', label: 'Activity or craft', hint: 'e.g. Paper chain of kind words', long: true },
  { key: 'teacher', label: 'Teacher that day', hint: 'Leave empty for the class leader' },
  { key: 'link', label: 'Google Drive link', hint: 'Paste the lesson file link' },
];

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateKey = (d: unknown): d is string => typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
export const isSunday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** The Sunday on or after this day. */
export const sundayFrom = (d: string) => addDays(d, (7 - new Date(`${d}T12:00:00Z`).getUTCDay()) % 7);

/** Only links that open in a browser: Google Drive, Docs, YouTube or any https page. */
export function cleanLink(v: unknown): string {
  const s = clean(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch { return ''; }
}

export function cleanLesson(v: unknown): SsLesson {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: clean(o.title, 120), passage: clean(o.passage, 80), verse: clean(o.verse, 200), point: clean(o.point, 400),
    activity: clean(o.activity, 400), teacher: clean(o.teacher, 60), link: cleanLink(o.link),
  };
}
export const lessonEmpty = (l: SsLesson | undefined) => !l || Object.values(l).every((x) => !x);

/** A day as typed, ready to keep. Lessons only for classes on the list; empty ones dropped. */
export function cleanDay(v: unknown, classIds: string[]): Omit<SsDay, 'files'> {
  const o = (v ?? {}) as Record<string, unknown>;
  const date = isDateKey(o.date) ? o.date : '';
  const kind = date && !isSunday(date) ? 'special' : o.kind === 'special' ? 'special' : 'sunday';
  const lessons: Record<string, SsLesson> = {};
  const raw = (o.lessons ?? {}) as Record<string, unknown>;
  for (const id of classIds) {
    const l = cleanLesson(raw[id]);
    if (!lessonEmpty(l)) lessons[id] = l;
  }
  return {
    date, kind, title: clean(o.title, 80), noClass: kind === 'sunday' && o.noClass === true, theme: clean(o.theme, 120), series: clean(o.series, 80),
    note: clean(o.note, 600), link: cleanLink(o.link), lessons,
  };
}

/** Has anything been planned for this day? */
export const dayPlanned = (d: Partial<SsDay> | undefined) => !!d && !!(d.title || d.noClass || d.theme || d.series || d.note || d.link || Object.keys(d.lessons ?? {}).length || d.files?.length);

/** Every Sunday from `from` to `to`, both included. */
export function sundaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = sundayFrom(from); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** The years to show: from December 2026 (2A) to next year. */
export function timetableYears(today: string): number[] {
  const last = Math.max(2027, Number(today.slice(0, 4)) + 1);
  const out: number[] = [];
  for (let y = 2026; y <= last; y++) out.push(y);
  return out;
}
/** The year that opens first: this year while it has Sundays left after SS_FIRST_DAY, else next year. */
export function openingYear(today: string): number {
  const y = Number(today.slice(0, 4));
  return sundayFrom(today > SS_FIRST_DAY ? today : SS_FIRST_DAY) > `${y}-12-31` ? y + 1 : Math.max(2026, y);
}
/** One list for the year: every Sunday and each special day, in date order. */
export function yearRows(year: number, days: SsDay[]): { date: string; day: SsDay | null }[] {
  const from = year === 2026 ? SS_FIRST_DAY : `${year}-01-01`;
  const to = `${year}-12-31`;
  const byDate = new Map(days.filter((d) => d.date >= from && d.date <= to).map((d) => [d.date, d]));
  const dates = new Set([...sundaysBetween(from, to), ...byDate.keys()]);
  return [...dates].sort().map((date) => ({ date, day: byDate.get(date) ?? null }));
}

/**
 * A series filled in one go (7A): `weeks` Sundays from the first one, skipping Sundays with no Sunday school.
 * Each gets the series name and "Week n" if it has no theme of its own yet.
 */
export function seriesDates(start: string, weeks: number, noClass: Set<string>): string[] {
  const out: string[] = [];
  let d = sundayFrom(start);
  for (let guard = 0; out.length < Math.min(Math.max(1, Math.floor(weeks)), 52) && guard < 80; guard++, d = addDays(d, 7)) {
    if (!noClass.has(d)) out.push(d);
  }
  return out;
}

/** The same Sunday a year on: the Sunday nearest 364 days later keeps the weekday and the season. */
export const nextYearDate = (d: string) => addDays(d, 364);

/** "Sun 29 Nov 2026". */
export function ssDayLabel(d: string, year = true): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
}

/** The class's lesson in one line for the year list: "Joseph forgives · Gen 45:1-15". */
export const lessonLine = (l: SsLesson | undefined) => (l ? [l.title, l.passage].filter(Boolean).join(' · ') : '');

/** The Thursday reminder to one teacher (8A), to send by hand on WhatsApp (9A). */
export function reminderText(o: { first: string; day: SsDay | null; date: string; className: string; classId: string; leader: string; app: string; drive: string }): string {
  const d = o.day;
  const l = d?.lessons[o.classId];
  const when = ssDayLabel(o.date, false);
  const lines = [`Hello ${o.first || 'teacher'} 👋`, '', `Sunday school this Sunday, ${when}:`];
  if (d?.noClass) {
    lines.push(`No Sunday school this Sunday${d.title ? ` (${d.title})` : ''}.`);
  } else {
    if (d?.theme) lines.push(`Theme: ${d.theme}`);
    lines.push('', `Your class: ${o.className}`);
    const teacher = l?.teacher || o.leader;
    if (teacher) lines.push(`Teacher: ${teacher}`);
    if (l?.title) lines.push(`Lesson: ${l.title}`);
    if (l?.passage) lines.push(`Bible passage: ${l.passage}`);
    if (l?.verse) lines.push(`Memory verse: ${l.verse}`);
    if (l?.point) lines.push(`Main point: ${l.point}`);
    if (l?.activity) lines.push(`Activity: ${l.activity}`);
    if (l?.link) lines.push(`Lesson file: ${l.link}`);
    if (!l?.title) lines.push('The lesson is not on the timetable yet. Dorothy will share it.');
  }
  lines.push('', `Timetable and files: ${o.app}/sunday-school`, `Lessons folder: ${o.drive}`, '', 'God bless you. Freedom Church Sunday School');
  return lines.join('\n');
}

/** One message for the teachers' WhatsApp group: the theme and every class's lesson. */
export function groupReminderText(o: { day: SsDay | null; date: string; classes: { id: string; name: string; leader: string }[]; app: string; drive: string }): string {
  const d = o.day;
  const lines = [`Sunday school this Sunday, ${ssDayLabel(o.date, false)} 🙏`];
  if (d?.noClass) lines.push(`No Sunday school this Sunday${d.title ? ` (${d.title})` : ''}.`);
  else {
    if (d?.theme) lines.push(`Theme: ${d.theme}`);
    for (const c of o.classes) {
      const l = d?.lessons[c.id];
      const teacher = l?.teacher || c.leader;
      lines.push('', `${c.name}${teacher ? ` · ${teacher}` : ''}`, l?.title ? `  ${lessonLine(l)}${l.verse ? `\n  Memory verse: ${l.verse}` : ''}` : '  Lesson to come');
    }
  }
  lines.push('', `Timetable and files: ${o.app}/sunday-school`, `Lessons folder: ${o.drive}`);
  return lines.join('\n');
}

/** Files Dorothy can keep with a lesson (5A): the lesson plan types, and short videos. */
export const SS_TYPES: Record<string, string> = { ...LESSON_TYPES, mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4' };
export const SS_TYPES_TEXT = 'PDF, Word, PowerPoint, Excel, photos, short videos or songs';
export function ssFileType(name: string, head: Uint8Array): { ext: string; contentType: string } | null {
  const ext = extOf(name);
  const ascii = (from: number, t: string) => head.length >= from + t.length && [...t].every((c, i) => head[from + i] === c.charCodeAt(0));
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov' || ext === 'm4a') return ascii(4, 'ftyp') || ascii(4, 'moov') || ascii(4, 'wide') ? { ext, contentType: SS_TYPES[ext]! } : null;
  if (ext === 'mp3') return ascii(0, 'ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) ? { ext, contentType: SS_TYPES.mp3! } : null;
  return lessonFileType(name, head);
}
