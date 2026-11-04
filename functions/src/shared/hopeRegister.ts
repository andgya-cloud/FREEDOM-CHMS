/**
 * Freedom Hope Centre weekly registers (Andy, 2026-11-04): the children's register and the Child Champions
 * register. Champions are the people who teach and serve the children. Each day's register is one record
 * (hopeDays/{date} or championDays/{date}) holding a mark for each person, so a tablet can mark it offline.
 * Pure functions, shared by the app and the tests.
 */
import { addDays } from './metrics.js';
import { normalizeCode, readPayBy, type ChildPayment } from './hope.js';

// ---- The children's register --------------------------------------------------------------------

export const KID_MARKS = ['present', 'absent', 'excused', 'departing', 'departed'] as const;
export type KidMark = (typeof KID_MARKS)[number];
export const KID_MARK_LABELS: Record<KidMark, string> = { present: 'Present', absent: 'Absent', excused: 'Excused', departing: 'Departing', departed: 'Departed' };

export interface KidEntry {
  s: KidMark;
  /** Check-in time, "HH:MM". */
  t?: string | null;
  /** The reason, for Excused (and the note for Departing or Departed). */
  r?: string | null;
}
export interface HopeDay { id?: string; date: string; marks: Record<string, KidEntry>; deletedAt?: unknown }

/** A departing child still comes (Andy 1B), so Departing counts as there. */
export const kidCame = (s: KidMark | undefined) => s === 'present' || s === 'departing';

export interface Rate { present: number; absent: number; excused: number; marked: number; pct: number | null }

/**
 * A person's attendance from the days they were marked. Excused days are not held against them:
 * percentage = present ÷ (present + absent).
 */
export function rateFrom(entries: readonly { s: string }[]): Rate {
  let present = 0, absent = 0, excused = 0;
  for (const e of entries) {
    if (e.s === 'present' || e.s === 'departing' || e.s === 'late') present += 1;
    else if (e.s === 'absent') absent += 1;
    else if (e.s === 'excused') excused += 1;
  }
  const counted = present + absent;
  return { present, absent, excused, marked: present + absent + excused, pct: counted ? Math.round((present / counted) * 100) : null };
}

/** One child's marks, newest first. */
export function kidHistory(id: string, days: readonly HopeDay[]): { date: string; entry: KidEntry }[] {
  return days.filter((d) => !d.deletedAt && d.marks?.[id]).map((d) => ({ date: d.date, entry: d.marks[id]! })).sort((a, b) => b.date.localeCompare(a.date));
}

export const kidRate = (id: string, days: readonly HopeDay[]) => rateFrom(kidHistory(id, days).map((h) => h.entry));

/** The centre's percentage on each register day, oldest first: "the percentage as time goes". */
export function dayTrend<T extends { date: string; marks: Record<string, { s: string }>; deletedAt?: unknown }>(days: readonly T[], last = 12): { date: string; pct: number | null; came: number }[] {
  return days.filter((d) => !d.deletedAt && Object.keys(d.marks ?? {}).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-last)
    .map((d) => { const r = rateFrom(Object.values(d.marks)); return { date: d.date, pct: r.pct, came: r.present }; });
}

/** Saturday on or before the day (Andy 5A: Saturday by default). */
export function saturdayOnOrBefore(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 1) % 7));
}

/** The weeks of a month for the calendar: each week is seven "YYYY-MM-DD" days (Monday first), or null outside the month. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ---- Child Champions -----------------------------------------------------------------------------

export interface Champion {
  id: string;
  name: string;
  phone: string;
  email: string;
  /** Their usual duty, for example "Football coach" or "Kitchen". */
  duty: string;
  status: 'active' | 'left';
  joinedOn: string | null;
  deletedAt?: unknown;
}

export const CHAMPION_MARKS = ['present', 'late', 'absent', 'excused'] as const;
export type ChampionMark = (typeof CHAMPION_MARKS)[number];
export const CHAMPION_MARK_LABELS: Record<ChampionMark, string> = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };

export interface ChampionEntry {
  s: ChampionMark;
  /** Time in and time out, "HH:MM". */
  in?: string | null;
  out?: string | null;
  /** The duty served that day. */
  duty?: string | null;
  /** The reason for Excused, or a note. */
  r?: string | null;
}
export interface ChampionDay { id?: string; date: string; marks: Record<string, ChampionEntry>; deletedAt?: unknown }

/** Minutes between two "HH:MM" times, or null. */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const p = (t: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = p(from), b = p(to);
  return a != null && b != null && b > a ? b - a : null;
}

export function championSummary(id: string, days: readonly ChampionDay[]) {
  const history = days.filter((d) => !d.deletedAt && d.marks?.[id]).map((d) => ({ date: d.date, entry: d.marks[id]! })).sort((a, b) => b.date.localeCompare(a.date));
  const minutes = history.reduce((n, h) => n + (minutesBetween(h.entry.in, h.entry.out) ?? 0), 0);
  return { history, rate: rateFrom(history.map((h) => h.entry)), late: history.filter((h) => h.entry.s === 'late').length, hours: Math.round(minutes / 6) / 10 };
}

/** "1h 30m" */
export function hoursText(minutes: number | null): string {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

// ---- Upload from Excel or CSV (Andy 11A) ----------------------------------------------------------

type Cell = string | number | Date | null | undefined;

export const CHILD_TEMPLATE_HEAD = ['Name', 'Gender', 'Date of birth', 'School', 'Class', 'Sponsor name', 'Sponsor phone', 'Sponsor email', 'Parent name', 'Parent phone', 'Joined on', 'Photo consent', 'Guardian consent', 'Pay by', 'Pay number', 'Account', 'Pay to', 'Amount', 'Payment note'];
export const CHILD_TEMPLATE_EXAMPLE = ['Faith Akinyi', 'Female', '2016-05-14', 'Kibera Primary', 'Grade 4', 'John Smith', '', 'john@example.org', 'Mary Atieno', '0712345678', '2025-01-11', 'Yes', 'Yes', 'Paybill', '247247', '804212#Faith', 'Kibera Primary', 'KES 1,500', ''];
export const CHAMPION_TEMPLATE_HEAD = ['Name', 'Phone', 'Email', 'Duty', 'Joined on'];
export const CHAMPION_TEMPLATE_EXAMPLE = ['Peter Otieno', '0722345678', 'peter@example.org', 'Football coach', '2025-03-01'];

const clean = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const key = (v: Cell) => clean(v).toLowerCase().replace(/[^a-z]/g, '');

/** A date typed in a cell: 2016-05-14, 14/05/2016, 14-05-2016, an Excel date, or an Excel day number. */
export function cellDate(v: Cell): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const t = clean(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  return null;
}
function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const yes = (v: Cell): boolean | null => { const k = key(v); return ['yes', 'y', 'true', 'agreed', '1'].includes(k) ? true : ['no', 'n', 'false', 'declined', '0'].includes(k) ? false : null; };
const emailOk = (e: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Finds the header row (the first with a "Name" column) and maps each column by its heading. */
function columns(rows: readonly (readonly Cell[])[], head: readonly string[]) {
  const wanted = head.map(key);
  const at = rows.findIndex((r) => r.some((c) => key(c) === 'name' || key(c) === 'fullname' || key(c) === 'childsname'));
  if (at < 0) return null;
  const map: Record<string, number> = {};
  rows[at]!.forEach((c, i) => {
    let k = key(c);
    if (k === 'fullname' || k === 'childsname' || k === 'childname') k = 'name';
    if (k === 'dob' || k === 'birthday') k = 'dateofbirth';
    if (k === 'sponsor' || k === 'sponsorsname') k = 'sponsorname';
    if (k === 'parent' || k === 'parentsname' || k === 'guardianname' || k === 'guardian') k = 'parentname';
    if (k === 'parentscontact' || k === 'parentcontact' || k === 'guardianphone' || k === 'parentsphone') k = 'parentphone';
    if (k === 'joined' || k === 'enrolledon' || k === 'datejoined') k = 'joinedon';
    if (k === 'role') k = 'duty';
    if (k === 'grade' || k === 'schoolclass') k = 'class';
    if (k === 'paybillnumber' || k === 'paybilltillphone' || k === 'paynumber' || k === 'number') k = 'paynumber';
    if (k === 'accountnumber' || k === 'acc') k = 'account';
    if (wanted.includes(k) && map[k] == null) map[k] = i;
  });
  return { at, get: (r: readonly Cell[], name: string) => (map[key(name)] != null ? r[map[key(name)]!] : undefined) };
}

export interface ChildImportRow {
  line: number;
  /** A code from the sheet (HC-0042), kept when the child is added. */
  code: string | null;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  school: string;
  sponsorName: string;
  sponsorPhone: string;
  sponsorEmail: string;
  parentName: string;
  parentPhone: string;
  enrolledOn: string | null;
  photoConsent: boolean | null;
  guardianConsent: boolean | null;
  schoolClass: string;
  /** How fees are paid, or null when the sheet says nothing about it. */
  payment: ChildPayment | null;
  /** Why the row will not be added. */
  skip: string | null;
  /** A note that doesn't stop it, such as a date that couldn't be read. */
  warn: string | null;
}

/** Reads the children from a spreadsheet. Children already on the register (same name) are skipped. */
export function planChildImport(rows: readonly (readonly Cell[])[], existingNames: readonly string[], today: string, existingCodes: readonly string[] = []): ChildImportRow[] | null {
  const cols = columns(rows, [...CHILD_TEMPLATE_HEAD, 'Code']);
  const takenCodes = new Set(existingCodes);
  const seenCodes = new Set<string>();
  if (!cols) return null;
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase().replace(/\s+/g, ' ')));
  const seen = new Set<string>();
  const out: ChildImportRow[] = [];
  rows.slice(cols.at + 1).forEach((r, i) => {
    const name = clean(cols.get(r, 'Name'));
    if (!name && r.every((c) => !clean(c))) return;
    const dobText = clean(cols.get(r, 'Date of birth'));
    const joinText = clean(cols.get(r, 'Joined on'));
    const dateOfBirth = cellDate(cols.get(r, 'Date of birth'));
    const enrolledOn = cellDate(cols.get(r, 'Joined on'));
    const g = key(cols.get(r, 'Gender'));
    const sponsorEmail = clean(cols.get(r, 'Sponsor email'));
    const k = name.toLowerCase();
    const codeText = clean(cols.get(r, 'Code'));
    let code = codeText ? normalizeCode(codeText) : null;
    const codeWarn = codeText && !code ? `code "${codeText}" not read` : code && (takenCodes.has(code) || seenCodes.has(code)) ? `code ${code} is already used, a new one will be given` : '';
    if (codeWarn) code = null;
    if (code) seenCodes.add(code);
    const payText = clean(cols.get(r, 'Pay by'));
    const payment: ChildPayment = {
      by: readPayBy(payText), number: clean(cols.get(r, 'Pay number')).slice(0, 40), account: clean(cols.get(r, 'Account')).slice(0, 80),
      payTo: clean(cols.get(r, 'Pay to')).slice(0, 120), amount: clean(cols.get(r, 'Amount')).slice(0, 80), note: clean(cols.get(r, 'Payment note')).slice(0, 300),
    };
    const anyPay = payText || payment.number || payment.account || payment.payTo || payment.amount || payment.note;
    // "Birth date missing" or "not known" in the date column just means no date yet.
    const dobBlank = /missing|not known|unknown/i.test(dobText);
    const warns = [
      codeWarn,
      dobText && !dateOfBirth && !dobBlank ? `date of birth "${dobText}" not read` : '',
      payText && !payment.by ? `pay by "${payText}" not read` : '',
      joinText && !enrolledOn ? `joined on "${joinText}" not read` : '',
      sponsorEmail && !emailOk(sponsorEmail) ? 'sponsor email not saved' : '',
    ].filter(Boolean);
    out.push({
      line: cols.at + 2 + i,
      code,
      name: name.slice(0, 120),
      gender: g.startsWith('f') || g === 'girl' ? 'Female' : g.startsWith('m') || g === 'boy' ? 'Male' : null,
      dateOfBirth: dateOfBirth && dateOfBirth <= today ? dateOfBirth : null,
      school: clean(cols.get(r, 'School')).slice(0, 120),
      sponsorName: clean(cols.get(r, 'Sponsor name')).slice(0, 120),
      sponsorPhone: clean(cols.get(r, 'Sponsor phone')).slice(0, 30),
      sponsorEmail: emailOk(sponsorEmail) ? sponsorEmail.slice(0, 120) : '',
      parentName: clean(cols.get(r, 'Parent name')).slice(0, 120),
      parentPhone: clean(cols.get(r, 'Parent phone')).slice(0, 30),
      enrolledOn: enrolledOn && enrolledOn <= today ? enrolledOn : null,
      photoConsent: yes(cols.get(r, 'Photo consent')),
      guardianConsent: yes(cols.get(r, 'Guardian consent')),
      schoolClass: clean(cols.get(r, 'Class')).slice(0, 40),
      payment: anyPay ? payment : null,
      skip: name.length < 2 ? 'no name' : have.has(k) ? 'already on the register' : seen.has(k) ? 'listed twice' : null,
      warn: warns.join('; ') || null,
    });
    seen.add(k);
  });
  return out;
}

export interface ChampionImportRow { line: number; name: string; phone: string; email: string; duty: string; joinedOn: string | null; skip: string | null }

export function planChampionImport(rows: readonly (readonly Cell[])[], existingNames: readonly string[], today: string): ChampionImportRow[] | null {
  const cols = columns(rows, CHAMPION_TEMPLATE_HEAD);
  if (!cols) return null;
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: ChampionImportRow[] = [];
  rows.slice(cols.at + 1).forEach((r, i) => {
    const name = clean(cols.get(r, 'Name'));
    if (!name && r.every((c) => !clean(c))) return;
    const email = clean(cols.get(r, 'Email'));
    const joined = cellDate(cols.get(r, 'Joined on'));
    const k = name.toLowerCase();
    out.push({
      line: cols.at + 2 + i, name: name.slice(0, 120), phone: clean(cols.get(r, 'Phone')).slice(0, 30), email: emailOk(email) ? email.slice(0, 120) : '',
      duty: clean(cols.get(r, 'Duty')).slice(0, 80), joinedOn: joined && joined <= today ? joined : null,
      skip: name.length < 2 ? 'no name' : have.has(k) ? 'already a champion' : seen.has(k) ? 'listed twice' : null,
    });
    seen.add(k);
  });
  return out;
}

// ---- Little delights (Andy, 2026-11-04, 8A) ------------------------------------------------------

/**
 * How many register days in a row, up to the latest, the child came. Excused days are skipped (they don't
 * break a streak); an absence, or a register day the child was not marked, ends it.
 */
export function streak(id: string, days: readonly HopeDay[]): number {
  let n = 0;
  for (const d of [...days].filter((x) => !x.deletedAt && Object.keys(x.marks ?? {}).length).sort((a, b) => b.date.localeCompare(a.date))) {
    const s = d.marks[id]?.s;
    if (s === 'excused') continue;
    if (!kidCame(s)) break;
    n += 1;
  }
  return n;
}
export const STREAK_SHOWN = 4;

/** Days from the day to the child's next birthday (0 on the day), or null when the date of birth is not known. */
export function daysToBirthday(dateOfBirth: string | null | undefined, today: string): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const y = Number(today.slice(0, 4));
  const at = (year: number) => {
    const md = dateOfBirth.slice(5) === '02-29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? '02-28' : dateOfBirth.slice(5);
    return Date.parse(`${year}-${md}T12:00:00Z`);
  };
  const now = Date.parse(`${today}T12:00:00Z`);
  const days = (t: number) => Math.round((t - now) / 86_400_000);
  const next = days(at(y)) >= 0 ? days(at(y)) : days(at(y + 1));
  return next;
}
/** A birthday this week: from three days before to three days after. */
export function birthdayThisWeek(dateOfBirth: string | null | undefined, today: string): boolean {
  const ahead = daysToBirthday(dateOfBirth, today);
  if (ahead == null) return false;
  const behind = daysToBirthday(dateOfBirth, addDays(today, -3));
  return ahead <= 3 || (behind != null && behind <= 3);
}
