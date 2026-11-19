/**
 * ADIA's exam register and transcripts (Andy, 2026-11-19, 1B 2A 3A 4A 5A+B 6A-11A).
 *
 * Exam register: one register for each cohort and each exam sitting (for example "NITA & college exams ·
 * Dec 2026"), kept for ADIA's own records. Every student of the cohort sits NITA, the internal college
 * exam, or neither. The system suggests NITA for a student who has passed every course so far and has
 * the minimum attendance; the principal confirms or changes each one, then locks the register. Each new
 * cohort simply gets its own registers, so future cohorts work the same way.
 *
 * Transcripts: each one printed gets a serial number (ADIA/TR/2026/0001) and a QR code that opens the
 * public check page, so an employer can see it is genuine.
 */
import { cohortKey } from './examCohorts.js';
import type { CourseLine } from './examResults.js';

export type RegisterSits = 'nita' | 'internal' | 'none';
export const SITS_LABELS: Record<RegisterSits, string> = { nita: 'NITA', internal: 'Internal college exam', none: 'Not sitting' };
export const NITA_GRADES = ['Grade III', 'Grade II', 'Grade I'] as const;
export type NitaResult = 'pending' | 'pass' | 'fail';
export const NITA_RESULT_LABELS: Record<NitaResult, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail' };

/** One student's line in a register. NITA details only matter when they sit NITA. */
export interface RegisterEntry {
  sits: RegisterSits | null;
  trade?: string | null;
  grade?: string | null;
  indexNo?: string | null;
  feePaid?: boolean;
  nitaResult?: NitaResult;
  /** An internal result typed in where there is no marks sheet (Andy, 5B). */
  typedPoints?: number | null;
}

/** organizations/{org}/examRegisters/{registerId}. */
export interface ExamRegister {
  orgId: string;
  cohort: string;
  sitting: string;
  entries: Record<string, RegisterEntry>;
  locked: boolean;
  lockedOn: string | null;
  lockedByName: string | null;
  /** The rules the suggestions used, kept with the register so later changes in Setup never rewrite it. */
  rules: { passMark: number; minAttendance: number | null };
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sitting';
export const registerId = (cohort: string, sitting: string) => `${cohortKey(cohort)}__${slug(sitting)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "NITA & college exams · Dec 2026": a sitting named after a month. */
export const sittingName = (month: number, year: number) => `NITA & college exams · ${MONTHS[Math.min(11, Math.max(0, month - 1))]} ${year}`;
/** Sittings newest first, by the month and year in their names; others after, by name. */
export function orderSittings(names: string[]): string[] {
  const when = (n: string) => { const m = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i.exec(n); return m ? Number(m[2]) * 12 + MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.slice(0, 3).toLowerCase()) : -1; };
  return [...names].sort((a, b) => when(b) - when(a) || a.localeCompare(b));
}

export interface SuggestInput {
  /** Each semester's courses from the marks sheets, or its points from past results. */
  semesters: { points: number | null; courses: CourseLine[] }[];
  attendance: number | null;
  passMark: number;
  minAttendance: number | null;
}
export interface Suggestion { nita: boolean; why: string }

/** NITA for a student who has passed every course so far and has the minimum attendance (Andy, 2A). */
export function suggestSitting(x: SuggestInput): Suggestion {
  const marked = x.semesters.flatMap((s) => s.courses.filter((c) => c.total != null).map((c) => ({ name: c.courseName, total: c.total as number })));
  const pastOnly = x.semesters.filter((s) => !s.courses.length && s.points != null).map((s) => s.points as number);
  const failed = marked.filter((c) => c.total < x.passMark);
  const pastFailed = pastOnly.filter((p) => p < x.passMark);
  const counted = marked.length + pastOnly.length;
  const att = x.attendance == null ? '' : `attendance ${Math.round(x.attendance)}%`;
  if (!counted) return { nita: false, why: 'No results yet' };
  if (failed.length) {
    const worst = [...failed].sort((a, b) => a.total - b.total)[0]!;
    return { nita: false, why: failed.length === 1 ? `Failed ${worst.name} (${round(worst.total)})` : `Failed ${failed.length} courses, e.g. ${worst.name} (${round(worst.total)})` };
  }
  if (pastFailed.length) return { nita: false, why: `A semester below the pass mark (${round(pastFailed[0]!)})` };
  if (x.minAttendance != null && x.attendance != null && x.attendance < x.minAttendance) return { nita: false, why: `Attendance ${Math.round(x.attendance)}% (minimum ${x.minAttendance}%)` };
  const passed = marked.length ? `Passed ${marked.length} of ${marked.length}` : 'Passed every semester so far';
  return { nita: true, why: [passed, att].filter(Boolean).join(' · ') };
}
const round = (n: number) => Math.round(n * 100) / 100;

export interface RegisterCounts { nita: number; internal: number; none: number; notPicked: number }
export function registerCounts(studentIds: string[], entries: Record<string, RegisterEntry>): RegisterCounts {
  const c: RegisterCounts = { nita: 0, internal: 0, none: 0, notPicked: 0 };
  for (const id of studentIds) {
    const s = entries[id]?.sits;
    if (s === 'nita') c.nita++; else if (s === 'internal') c.internal++; else if (s === 'none') c.none++; else c.notPicked++;
  }
  return c;
}

/** A typed internal result: a number from 0 to 100 (2 decimals), or blank. Returns an error message or null. */
export function typedPointsProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Type a mark from 0 to 100';
  return null;
}

/** A NITA index number as typed: letters, numbers, slashes and dashes, at most 40. */
export const cleanIndexNo = (s: string) => s.replace(/[^A-Za-z0-9/\- ]/g, '').trim().slice(0, 40);

/** The NITA line on a transcript: the latest sitting in which the student sat NITA. */
export function nitaLineFor(studentId: string, registers: Pick<ExamRegister, 'sitting' | 'entries'>[]): string {
  const sat = orderSittings(registers.filter((r) => r.entries[studentId]?.sits === 'nita').map((r) => r.sitting));
  if (!sat.length) return '';
  const r = registers.find((x) => x.sitting === sat[0])!;
  const e = r.entries[studentId]!;
  const what = [e.trade, e.grade].filter(Boolean).join(' ');
  const month = /·\s*(.+)$/.exec(r.sitting)?.[1] ?? r.sitting;
  return `${what ? `${what}: ` : ''}${NITA_RESULT_LABELS[e.nitaResult ?? 'pending']} (${month})`;
}

// ---- Transcript serial numbers -----------------------------------------------------------------

export const TRANSCRIPT_PREFIX = 'ADIA/TR';
export const transcriptSerial = (year: number, n: number) => `${TRANSCRIPT_PREFIX}/${year}/${String(n).padStart(4, '0')}`;
/** Reads a typed serial ("adia/tr/2026/12", "ADIA TR 2026 0012") back to its standard form, or null. */
export function readTranscriptSerial(text: string): string | null {
  const m = /^\s*ADIA\W*TR\W*(\d{4})\W*(\d{1,6})\s*$/i.exec(text);
  return m ? transcriptSerial(Number(m[1]), Number(m[2])) : null;
}

/** organizations/{org}/examTranscripts/{token}: what was printed, so the check page can confirm it. */
export interface TranscriptRecord {
  orgId: string;
  serial: string;
  year: number;
  n: number;
  studentId: string;
  cohort: string;
  name: string;
  admissionNo: string;
  programme: string;
  finalPoints: number | null;
  finalGrade: string;
  provisional: boolean;
  fingerprint: string;
  issuedOn: string;
  issuedByName: string;
}

/** What a transcript says, in one string: an unchanged result reuses its serial number. */
export function transcriptFingerprint(t: { semesters: { points: number | null; partial: number | null; courses: { courseName: string; total: number | null }[] }[]; finalPoints: number | null; finalGrade: string; provisional: boolean; nita: string; attendance: number | null; attachment?: string }): string {
  // The attachment line joins only when there is one, so earlier transcripts keep their serial numbers.
  return JSON.stringify([t.semesters.map((s) => [s.points, s.partial, s.courses.map((c) => [c.courseName, c.total])]), t.finalPoints, t.finalGrade, t.provisional, t.nita, t.attendance, ...(t.attachment ? [t.attachment] : [])]);
}

/** The check page's web address, which the QR code holds. */
export const verifyUrl = (origin: string, orgId: string, token: string) => `${origin.replace(/\/$/, '')}/verify/${orgId}/${token}`;
