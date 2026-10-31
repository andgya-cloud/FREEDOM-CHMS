import { normalizePhone, phoneDigits } from './phone.js';

export const PERSON_STATUSES = ['visitor', 'regular', 'member', 'student', 'child', 'inactive'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** The statuses offered at a place: Freedom Church has no students or children (Andy, 2026-10-31, 3A). */
export function statusesFor(orgType?: string): readonly PersonStatus[] {
  return orgType === 'church_campus' ? PERSON_STATUSES.filter((s) => s !== 'student' && s !== 'child') : PERSON_STATUSES;
}

export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  visitor: 'Visitor',
  regular: 'Regular',
  member: 'Member',
  student: 'Student',
  child: 'Child',
  inactive: 'Inactive',
};

export const HOW_HEARD_OPTIONS = ['Invited by someone', 'Walked in', 'Social media', 'Online service', 'Event or outreach', 'Other'];

export interface PipelineStage {
  id: string;
  name: string;
  /** Salvation and baptism reveal religious belief: only staff with pastoral access see them. */
  sensitive: boolean;
  active: boolean;
}

export const DEFAULT_PIPELINE: PipelineStage[] = [
  { id: 'visitor', name: 'Visitor', sensitive: false, active: true },
  { id: 'salvation', name: 'Salvation', sensitive: true, active: true },
  { id: 'baptism', name: 'Baptism', sensitive: true, active: true },
  { id: 'growth_track', name: 'Growth Track', sensitive: false, active: true },
  { id: 'dream_team', name: 'Dream Team', sensitive: false, active: true },
  { id: 'freedom_252', name: 'Freedom 252', sensitive: false, active: true },
  { id: 'freedom_groups', name: 'Freedom Groups', sensitive: false, active: true },
  { id: 'communication_master_class', name: 'Communication Master Class', sensitive: false, active: true },
];

export const STAGE_STATUSES = ['not_started', 'in_progress', 'completed', 'dropped'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  dropped: 'Dropped',
};

/** Pipeline entries are stored one per person per stage, under this id. */
export function pipelineEntryId(personId: string, stageId: string): string {
  return `${personId}_${stageId}`;
}

/** A stage id from a name: "Freedom 252" -> "freedom_252". */
export function stageIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/** Tidies spacing and capitalises each word: "  grace   wanjiku " -> "Grace Wanjiku". */
export function tidyName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export interface Searchable {
  fullName: string;
  phone: string | null;
}

/**
 * Whether a person matches what staff typed: every word must start a word of
 * the name, or the typed digits must appear in the phone number (in either
 * 07... or +2547... form).
 */
export function matchesSearch(person: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === q.replace(/[\s+()-]/g, '').length) {
    const full = phoneDigits(person.phone);
    const local = full.startsWith('254') ? `0${full.slice(3)}` : full;
    return full.includes(digits) || local.includes(digits);
  }
  const words = person.fullName.toLowerCase().split(/\s+/);
  return q.split(/\s+/).every((part) => words.some((w) => w.startsWith(part)));
}

/** Other people (not deleted) sharing this person's phone number. */
export function findDuplicatesByPhone<T extends { id: string; phone: string | null; deletedAt?: unknown }>(
  phone: string | null,
  people: readonly T[],
  excludeId?: string,
): T[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return people.filter((p) => p.id !== excludeId && !p.deletedAt && p.phone === normalized);
}

// ---- Birthdays (Andy, 2026-10-31, 2A) -------------------------------------------
// Day and month only, saved as "MM-DD".

const BIRTHDAY_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "05-14" → "14 May". */
export function birthdayLabel(mmdd: string): string {
  const m = Number(mmdd.slice(0, 2));
  const d = Number(mmdd.slice(3, 5));
  if (!m || !d || m > 12) return mmdd;
  return `${d} ${BIRTHDAY_MONTHS[m - 1]}`;
}

/**
 * Birthdays from today's date key ("YYYY-MM-DD") through the next 6 days, soonest first.
 * `daysAway` is 0 for today. 29 February falls on 28 February in other years.
 */
export function upcomingBirthdays<T extends { birthday?: string | null }>(people: readonly T[], todayKey: string, days = 7): { person: T; daysAway: number }[] {
  const [y, m, d] = todayKey.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const keys = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const t = new Date(start + i * 86_400_000);
    const yy = t.getUTCFullYear();
    const key = `${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    if (!keys.has(key)) keys.set(key, i);
    const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
    if (key === '02-28' && !leap && !keys.has('02-29')) keys.set('02-29', i);
  }
  return people
    .filter((p) => p.birthday && keys.has(p.birthday))
    .map((p) => ({ person: p, daysAway: keys.get(p.birthday!)! }))
    .sort((a, b) => a.daysAway - b.daysAway);
}
