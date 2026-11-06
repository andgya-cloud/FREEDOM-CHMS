/**
 * Freedom Hope Centre weekly registers (Andy, 2026-11-04): the children's register and the Child Champions
 * register. Champions are the people who teach and serve the children. Each day's register is one record
 * (hopeDays/{date} or championDays/{date}) holding a mark for each person, so a tablet can mark it offline.
 * Pure functions, shared by the app and the tests.
 */
import { addDays } from './metrics.js';
import { normalizeCode, readPayBy, type ChildPayment } from './hope.js';
import { formatPhone, normalizePhone } from './phone.js';

// ---- The children's register --------------------------------------------------------------------

export const KID_MARKS = ['present', 'late', 'absent', 'excused', 'departing', 'departed'] as const;
export type KidMark = (typeof KID_MARKS)[number];
export const KID_MARK_LABELS: Record<KidMark, string> = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused', departing: 'Departing', departed: 'Departed' };

export interface KidEntry {
  s: KidMark;
  /** Check-in time, "HH:MM". */
  t?: string | null;
  /** The reason, for Excused (and the note for Departing or Departed). */
  r?: string | null;
}
export interface HopeDay { id?: string; date: string; marks: Record<string, KidEntry>; deletedAt?: unknown }

/** A departing child still comes (Andy 1B), so Departing counts as there; Late counts as came (Registers brief, 2026-11-06). */
export const kidCame = (s: KidMark | undefined) => s === 'present' || s === 'late' || s === 'departing';

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
  /** What they earn for each week they come, in KES (Andy, 2026-11-05, 8A). */
  weeklyPay?: number | null;
  /** Their QR card code, CC-0001 (11A). */
  code?: string | null;
  /** A fixed amount for the month whatever the weeks, in KES ("9000 - fixed" on Andy's list, 2026-11-05). */
  monthlyPay?: number | null;
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
export const CHAMPION_TEMPLATE_HEAD = ['Name', 'Phone', 'Email', 'Duty', 'Joined on', 'Weekly amount'];
export const CHAMPION_TEMPLATE_EXAMPLE = ['Peter Otieno', '0722345678', 'peter@example.org', 'Football coach', '2025-03-01', '1200'];

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
  // "6 Jun 2026" or "Sat 6 June 2026"
  m = /^(?:[a-z]{3,9},? )?(\d{1,2}) ([a-z]{3,9}) (\d{4})$/i.exec(t);
  if (m) { const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()); if (mo >= 0) return valid(+m[3]!, mo + 1, +m[1]!); }
  return null;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const yes = (v: Cell): boolean | null => { const k = key(v); return ['yes', 'y', 'true', 'agreed', '1'].includes(k) ? true : ['no', 'n', 'false', 'declined', '0'].includes(k) ? false : null; };
const emailOk = (e: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Finds the header row (the first with a "Name" column) and maps each column by its heading. */
function columns(rows: readonly (readonly Cell[])[], head: readonly string[]) {
  const wanted = head.map(key);
  const at = rows.findIndex((r) => r.some((c) => ['name', 'names', 'fullname', 'fullnames', 'childsname', 'championname', 'championsname'].includes(key(c))));
  if (at < 0) return null;
  const map: Record<string, number> = {};
  rows[at]!.forEach((c, i) => {
    let k = key(c);
    if (['fullname', 'fullnames', 'names', 'childsname', 'childname', 'championname', 'championsname'].includes(k)) k = 'name';
    if (wanted.includes('weeklyamount') && /appreciation|weekly|perweek|allowance|amount|pay/.test(k)) k = 'weeklyamount';
    if (wanted.includes('phone') && ['contact', 'contacts', 'phonenumber', 'mobile', 'telephone', 'tel', 'phoneno'].includes(k)) k = 'phone';
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

export interface ChampionImportRow {
  line: number; name: string; phone: string; email: string; duty: string; joinedOn: string | null;
  /** What they earn each week they come, or a fixed amount for the month ("9000 - fixed"); null when the sheet has none. */
  weeklyPay: number | null; monthlyPay: number | null;
  /** An existing champion this row updates (Andy, 2026-11-05: the list updates the champions already here). */
  updateId: string | null;
  /** What the update changes, for the check list. */
  changes: string[];
  skip: string | null;
}
export type ExistingChampion = Pick<Champion, 'id' | 'name' | 'phone' | 'email' | 'duty' | 'weeklyPay' | 'monthlyPay'>;

const nameWords = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, ' ').split(' ').filter(Boolean);
/** The same person: the same words, or the same first and last word. */
export function sameChampion(a: string, b: string): boolean {
  const x = nameWords(a), y = nameWords(b);
  if (!x.length || !y.length) return false;
  return x.join(' ') === y.join(' ') || (x.length > 1 && y.length > 1 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1]);
}
/** "1200" is weekly; "9000 - fixed" (or "a month") is a fixed amount for the month. */
export function readChampionPay(v: Cell): { weekly: number | null; monthly: number | null } {
  const t = clean(v);
  const n = Number(t.replace(/,/g, '').match(/\d+(\.\d+)?/)?.[0] ?? NaN);
  if (!t || !Number.isFinite(n)) return { weekly: null, monthly: null };
  return /fixed|month/i.test(t) ? { weekly: null, monthly: Math.round(n) } : { weekly: Math.round(n), monthly: null };
}
const tidyPhone = (v: Cell) => { const t = clean(v); const p = normalizePhone(t); return p ? formatPhone(p) : t; };

/**
 * Reads the champions sheet. New names are added; a champion already here is updated with the sheet's phone,
 * email, duty and pay (Andy's "contacts and appreciation" list, 2026-11-05).
 */
export function planChampionImport(rows: readonly (readonly Cell[])[], existing: readonly ExistingChampion[], today: string): ChampionImportRow[] | null {
  const cols = columns(rows, CHAMPION_TEMPLATE_HEAD);
  if (!cols) return null;
  const seen = new Set<string>();
  const out: ChampionImportRow[] = [];
  const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
  rows.slice(cols.at + 1).forEach((r, i) => {
    const name = clean(cols.get(r, 'Name'));
    if (!name && r.every((c) => !clean(c))) return;
    const email = clean(cols.get(r, 'Email'));
    const joined = cellDate(cols.get(r, 'Joined on'));
    const pay = readChampionPay(cols.get(r, 'Weekly amount'));
    const k = nameWords(name).join(' ');
    const row: ChampionImportRow = {
      line: cols.at + 2 + i, name: name.slice(0, 120), phone: tidyPhone(cols.get(r, 'Phone')).slice(0, 30), email: emailOk(email) ? email.slice(0, 120) : '',
      duty: clean(cols.get(r, 'Duty')).slice(0, 80), joinedOn: joined && joined <= today ? joined : null,
      weeklyPay: pay.weekly, monthlyPay: pay.monthly, updateId: null, changes: [],
      skip: name.length < 2 ? 'no name' : seen.has(k) ? 'listed twice' : null,
    };
    seen.add(k);
    const was = row.skip ? undefined : existing.find((c) => sameChampion(c.name, name));
    if (was) {
      row.updateId = was.id;
      const samePhone = (normalizePhone(was.phone) ?? was.phone) === (normalizePhone(row.phone) ?? row.phone);
      if (row.phone && !samePhone) row.changes.push(`phone ${row.phone}`);
      if (row.email && row.email.toLowerCase() !== (was.email || '').toLowerCase()) row.changes.push(`email ${row.email}`);
      if (row.duty && row.duty !== was.duty) row.changes.push(`duty ${row.duty}`);
      if (row.weeklyPay != null && (row.weeklyPay !== (was.weeklyPay ?? null) || was.monthlyPay)) row.changes.push(`${kes(row.weeklyPay)} a week`);
      if (row.monthlyPay != null && row.monthlyPay !== (was.monthlyPay ?? null)) row.changes.push(`${kes(row.monthlyPay)} a month, fixed`);
      if (!row.changes.length) row.skip = 'already up to date';
    }
    out.push(row);
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

/**
 * Missed the last `n` Saturdays the register was marked (Andy, 2026-11-05, v173 13A): not checked in on any of
 * them (absent, or not ticked). Saturdays before the child joined, and excused days, do not count.
 */
export function missedSaturdays(childId: string, enrolledOn: string | null | undefined, days: readonly HopeDay[], n = 3): boolean {
  const sats = days.filter((d) => !d.deletedAt && Object.keys(d.marks ?? {}).length > 0 && saturdayOnOrBefore(d.date) === d.date)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  if (sats.length < n) return false;
  if (enrolledOn && sats[n - 1]!.date < enrolledOn) return false;
  return sats.every((d) => { const s = d.marks?.[childId]?.s; return !kidCame(s) && s !== 'excused'; });
}

/**
 * A child to call (v182, 2A): missed the last 3 Saturdays marked, and nobody has called the parent since the
 * latest of them. One list for following up absent children.
 */
export function needsCall(child: { id: string; enrolledOn: string | null; calledOn?: string | null }, days: readonly HopeDay[]): boolean {
  if (!missedSaturdays(child.id, child.enrolledOn, days)) return false;
  const latest = days.filter((d) => !d.deletedAt && Object.keys(d.marks ?? {}).length > 0 && saturdayOnOrBefore(d.date) === d.date)
    .reduce((m, d) => (d.date > m ? d.date : m), '');
  return !(child.calledOn && child.calledOn >= latest);
}

export type HopeFileKind = 'sponsors' | 'champions' | 'children' | 'register';
/**
 * What a spreadsheet is (v182, 7A), from its headings in the first rows: the partner's KE-014 list (Child ID),
 * a champions list (Duty, Appreciation, Weekly amount, Contact), or a children list (Date of birth, Parent, School).
 */
export function whatFile(rows: readonly (readonly Cell[])[]): HopeFileKind | null {
  const key = (c: Cell) => clean(c).toLowerCase().replace(/[^a-z]/g, '');
  // A past register (Andy, 2026-11-06): a Date and a Status column, anywhere in the workbook.
  if (registerHead(rows) >= 0) return 'register';
  for (const r of rows.slice(0, 15)) {
    const k = new Set(r.map(key).filter(Boolean));
    if (k.size < 2) continue;
    if (k.has('childid')) return 'sponsors';
    const has = (...xs: string[]) => xs.some((x) => [...k].some((h) => h.includes(x)));
    if (has('appreciation', 'duty', 'weeklyamount', 'weekly')) return 'champions';
    if (has('dateofbirth', 'birth', 'dob', 'parent', 'guardian', 'school', 'consent')) return 'children';
    if (has('name', 'names') && has('contact', 'phone')) return 'champions';
  }
  return null;
}

/** The row with a Date, a Status and a child (HC code or Name) heading: a past register, one row per child per day. */
function registerHead(rows: readonly (readonly Cell[])[]): number {
  return rows.findIndex((r) => {
    const k = r.map(key);
    return k.includes('date') && (k.includes('status') || k.includes('mark') || k.includes('attendance'))
      && k.some((x) => ['hccode', 'code', 'childcode', 'name', 'nameapp', 'nameonsheet', 'childname', 'childsname', 'fullname'].includes(x));
  });
}

const MARK_WORDS: Record<string, KidMark> = {
  present: 'present', p: 'present', yes: 'present', came: 'present', here: 'present',
  late: 'late', l: 'late', absent: 'absent', a: 'absent', no: 'absent', missed: 'absent',
  excused: 'excused', e: 'excused', departing: 'departing', departed: 'departed',
};
/** A mark typed in a cell: Present, Absent, Late, Excused, P, A, a tick or a cross. */
export function cellMark(v: Cell): KidMark | null {
  const t = clean(v).toLowerCase();
  if (['✓', '✔', '☑', '✅'].includes(t)) return 'present';
  if (['✗', '✘', '×', '❌'].includes(t)) return 'absent';
  return MARK_WORDS[t.replace(/[^a-z]/g, '')] ?? null;
}

export interface RegisterChild { id: string; code: string | null; name: string }
export interface PastRegisterPlan {
  /** date -> childId -> mark */
  days: Record<string, Record<string, KidMark>>;
  /** Rows whose child could not be found, by the name or code on the sheet. */
  unmatched: { name: string; rows: number }[];
  /** Rows skipped for a missing date or mark. */
  skipped: number;
  rows: number;
}
const plainName = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Reads a past register (Andy, 2026-11-06): one row per child per day, with Date, Status and the child's HC code or
 * name ("Name (app)", "Name on sheet" or "Name"). The code is tried first, then each name exactly as the app has it.
 */
export function planPastRegister(rows: readonly (readonly Cell[])[], children: readonly RegisterChild[]): PastRegisterPlan | null {
  const at = registerHead(rows);
  if (at < 0) return null;
  const head = rows[at]!.map(key);
  const col = (...ks: string[]) => { for (const k of ks) { const i = head.indexOf(k); if (i >= 0) return i; } return -1; };
  const cDate = col('date'), cMark = col('status', 'mark', 'attendance'), cCode = col('hccode', 'code', 'childcode');
  const cNames = ['nameapp', 'name', 'fullname', 'childname', 'childsname', 'nameonsheet'].map((k) => head.indexOf(k)).filter((i) => i >= 0);
  const byCode = new Map(children.filter((c) => c.code).map((c) => [c.code!.toUpperCase(), c.id]));
  const byName = new Map<string, string | null>();
  for (const c of children) { const k = plainName(c.name); byName.set(k, byName.has(k) ? null : c.id); }
  const plan: PastRegisterPlan = { days: {}, unmatched: [], skipped: 0, rows: 0 };
  const missing = new Map<string, number>();
  for (const r of rows.slice(at + 1)) {
    if (!r.some((c) => clean(c))) continue;
    // Another table further down the workbook ends this one.
    if (r.map(key).includes('date')) break;
    const date = cellDate(r[cDate] ?? null), mark = cMark >= 0 ? cellMark(r[cMark] ?? null) : null;
    // A row with only one of the two is a mistake worth showing; a row with neither is another table's text.
    if (!date || !mark) { if (date || mark) plan.skipped++; continue; }
    plan.rows++;
    const code = cCode >= 0 ? clean(r[cCode] ?? null).toUpperCase() : '';
    let id: string | null | undefined = code ? byCode.get(code) : undefined;
    for (const i of cNames) { if (id) break; const n = plainName(clean(r[i] ?? null)); if (n) id = byName.get(n) ?? undefined; }
    if (!id) {
      const shown = cNames.map((i) => clean(r[i] ?? null)).find((n) => n && !n.startsWith('(')) || code || 'No name';
      missing.set(shown, (missing.get(shown) ?? 0) + 1);
      continue;
    }
    (plan.days[date] ??= {})[id] = mark;
  }
  plan.unmatched = [...missing].map(([name, n]) => ({ name, rows: n })).sort((a, b) => a.name.localeCompare(b.name));
  return plan;
}
