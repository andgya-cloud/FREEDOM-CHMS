/**
 * Hope Centre records (Andy, 2026-11-05: 1A 2A 3A+B 4A 5A 6A+B 7A 8 9A 10A 11 12A):
 * - welfare and leaving notes, each a dated, signed entry that is never overwritten, kept in Reports → Records;
 *   read by the Director, Andy and Doreen
 * - school fees paid for each child, with the term fee and the balance; kept by the Director, Daniel Ojwang'
 *   (the accountant), Andy and Doreen
 * - meals served each day (breakfast, lunch, fruit), counted by the Director, shown as a chart in See figures
 * Notes and fees are reached only through the hopeRecords Cloud Function.
 */
import { canDeletePhotoReport, isHopeDirector } from './hopePhotos.js';
import { can, canAccessOrg, canKeepAccounts, type AccessProfile } from './permissions.js';

type Profile = (AccessProfile & { displayName?: string; roleId?: string }) | null | undefined;
const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');

// ── Notes ────────────────────────────────────────────────────────────────────────────────────────────────

export type NoteKind = 'welfare' | 'health' | 'home' | 'visit' | 'referral' | 'leaving' | 'call';
export const NOTE_KINDS: NoteKind[] = ['welfare', 'health', 'home', 'visit', 'referral', 'leaving', 'call'];
/** Notes anyone who changes a child's details may write: leaving, and "Called the parent" after missed Saturdays (v182 2A). */
export const STAFF_NOTE_KINDS: NoteKind[] = ['leaving', 'call'];
/** The kinds written from the Care tab (leaving notes come from marking a child departing). */
export const CARE_NOTE_KINDS: NoteKind[] = ['welfare', 'health', 'home', 'visit', 'referral'];
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  welfare: 'Welfare', health: 'Health and diet', home: 'Home circumstances', visit: 'Home visit', referral: 'Referral', leaving: 'Leaving', call: 'Called the parent',
};
export const NOTE_KIND_EMOJI: Record<NoteKind, string> = { welfare: '💛', health: '🩺', home: '🏠', visit: '🚶', referral: '🏥', leaving: '👋', call: '📞' };
export const isNoteKind = (v: unknown): v is NoteKind => typeof v === 'string' && (NOTE_KINDS as string[]).includes(v);
export const NOTE_TEXT_MAX = 4000;

/** organizations/{org}/childNotes/{id}. Never changed once written (only removed to the Bin). */
export interface ChildNote {
  orgId: string;
  childId: string;
  childName: string;
  childCode: string;
  kind: NoteKind;
  text: string;
  /** The day it is about (a visit's date), else the day it was written. */
  day: string;
  byUid: string;
  byName: string;
  byRole: string;
  /** ISO time written. */
  at: string;
  /** Moved in from the old one-box welfare notes or home visits. */
  fromOld?: string;
}

/** Reads and writes notes, and opens Records: the Director, Andy and Doreen (5A). */
export const canReadNotes = (p: Profile, orgId: string) => canDeletePhotoReport(p, orgId);
/** Anyone who can change a child's details may write the leaving note when they mark a child departing. */
export const canAddLeavingNote = (p: Profile, orgId: string) => canReadNotes(p, orgId) || (canAccessOrg(p, orgId) && can(p, 'people.write'));

// ── School fees ─────────────────────────────────────────────────────────────────────────────────────────

/** The Director, Daniel Ojwang' (the accountant), Andy and Doreen (8). */
export function canKeepFees(p: Profile, orgId: string): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  return isHopeDirector(p, orgId) || canKeepAccounts(p) || plain(p?.displayName ?? '') === 'danielojwang';
}

export type FeeMethod = 'mpesa' | 'bank' | 'cash' | 'other';
export const FEE_METHODS: FeeMethod[] = ['mpesa', 'bank', 'cash', 'other'];
export const FEE_METHOD_LABELS: Record<FeeMethod, string> = { mpesa: 'M-Pesa', bank: 'Bank', cash: 'Cash', other: 'Other' };
export const isFeeMethod = (v: unknown): v is FeeMethod => typeof v === 'string' && (FEE_METHODS as string[]).includes(v);

/** organizations/{org}/hopeFees/{id}: one school fees payment. */
export interface FeePayment {
  orgId: string;
  childId: string;
  /** The day it was paid. */
  date: string;
  /** "2026-T3" */
  term: string;
  amount: number;
  method: FeeMethod;
  code: string;
  note: string;
  hasReceipt: boolean;
  byUid: string;
  byName: string;
  at: string;
}

/** Kenyan school terms: January to April is Term 1, May to August Term 2, September to December Term 3. */
export function termOf(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${y}-T${m! <= 4 ? 1 : m! <= 8 ? 2 : 3}`;
}
export const isTerm = (v: unknown): v is string => typeof v === 'string' && /^20\d\d-T[123]$/.test(v);
/** "2026-T3" → "Term 3 2026" */
export function termLabel(term: string): string {
  const [y, t] = term.split('-T');
  return y && t ? `Term ${t} ${y}` : term;
}
/** This term and the two before it, newest first, for the term dropdown. */
export function recentTerms(today: string, count = 4): string[] {
  const out: string[] = [];
  let [y, t] = termOf(today).split('-T').map(Number) as [number, number];
  t += 1;
  if (t > 3) { t = 1; y += 1; }
  for (let i = 0; i < count; i++) {
    out.push(`${y}-T${t}`);
    t -= 1;
    if (t < 1) { t = 3; y -= 1; }
  }
  return out;
}

/** What was paid in a term and what is left, from the term fee (0 when no fee is set). */
export function termBalance(payments: Pick<FeePayment, 'term' | 'amount'>[], term: string, termFee: number) {
  const paid = payments.filter((p) => p.term === term).reduce((n, p) => n + p.amount, 0);
  return { paid, fee: termFee, left: termFee > 0 ? Math.max(0, termFee - paid) : 0, over: termFee > 0 ? Math.max(0, paid - termFee) : 0 };
}

export const formatKes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`;
/** "KES 1,300 to teacher + KES 700 KCB" → 2000: the amounts in the saved payment line, added up. */
export function feeFromLine(line: string | null | undefined): number {
  if (!line) return 0;
  const nums = [...line.matchAll(/(?:KES|Ksh|Kshs)?\s*([0-9][0-9,]*(?:\.\d+)?)/gi)].map((m) => Number(m[1]!.replace(/,/g, ''))).filter((n) => n >= 50 && n <= 500000);
  return nums.reduce((a, b) => a + b, 0);
}

// ── Meals ───────────────────────────────────────────────────────────────────────────────────────────────

export type Meal = 'breakfast' | 'lunch' | 'fruit';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'fruit'];
export const MEAL_LABELS: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', fruit: 'Fruit' };
export const MEAL_EMOJI: Record<Meal, string> = { breakfast: '🍞', lunch: '🍛', fruit: '🍌' };
export const MEAL_MAX = 2000;

/** organizations/{org}/hopeMeals/{date}: how many children were served each meal that day (9A, counts only). */
export interface MealDay { orgId: string; date: string; breakfast: number; lunch: number; fruit: number }

/** Counts meals: the Director (11), and Andy or Doreen. */
export const canCountMeals = (p: Profile, orgId: string) => isHopeDirector(p, orgId) || (canAccessOrg(p, orgId) && canKeepAccounts(p));

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The Monday of the week a day falls in. */
export function mondayOf(date: string): string {
  const ms = dayMs(date);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return keyOf(ms - dow * 86_400_000);
}

/** Meals in each of the last `weeks` weeks (Monday to Sunday), oldest first, for the See figures chart (12A). */
export function mealWeeks(days: Pick<MealDay, 'date' | Meal>[], today: string, weeks = 8) {
  const thisWeek = mondayOf(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = keyOf(dayMs(thisWeek) - i * 7 * 86_400_000);
    const end = keyOf(dayMs(start) + 6 * 86_400_000);
    const inWeek = days.filter((d) => d.date >= start && d.date <= end);
    out.push({
      start,
      breakfast: inWeek.reduce((n, d) => n + (d.breakfast || 0), 0),
      lunch: inWeek.reduce((n, d) => n + (d.lunch || 0), 0),
      fruit: inWeek.reduce((n, d) => n + (d.fruit || 0), 0),
    });
  }
  return out;
}

/** Meals served this month, and in total. */
export function mealMonth(days: Pick<MealDay, 'date' | Meal>[], today: string) {
  const month = today.slice(0, 7);
  const inMonth = days.filter((d) => d.date.startsWith(month));
  const t = { breakfast: 0, lunch: 0, fruit: 0, days: inMonth.length };
  for (const d of inMonth) { t.breakfast += d.breakfast || 0; t.lunch += d.lunch || 0; t.fruit += d.fruit || 0; }
  return { ...t, total: t.breakfast + t.lunch + t.fruit };
}

export const validMealCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MEAL_MAX;
