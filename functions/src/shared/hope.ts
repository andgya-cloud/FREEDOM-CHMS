import { attended, headcountTotal, type Headcounts } from './attendance.js';
import { addDays } from './metrics.js';

/**
 * Freedom Hope Center: the children register, programmes, absence follow-up and the numbers.
 * Pure functions, shared by the app and the Cloud Functions. Dashboards and donor reports are counts only:
 * the monthly report builder is never given names.
 */

export const CHILD_STATUSES = ['active', 'exited'] as const;
export type ChildStatus = (typeof CHILD_STATUSES)[number];

export const SCHOOL_STATUSES = ['in_school', 'not_in_school', 'unknown'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];
export const SCHOOL_STATUS_LABELS: Record<SchoolStatus, string> = { in_school: 'In school', not_in_school: 'Not in school', unknown: 'Not known' };

/** Yes or no with a date. Null means nothing is on file yet. Saving never waits on it. */
export interface Consent { given: boolean | null; date: string | null }
export const NO_CONSENT: Consent = { given: null, date: null };
export const consentOnFile = (c: Consent | null | undefined) => c?.given != null;

export interface ChildProgramme {
  name: string;
  /** Team or age group (football), instrument or class (music). */
  group: string;
  /** Level reached (chess) or progress level (music). */
  level: string;
}

export interface Child {
  id: string; // the person's id
  code?: string | null;
  status: ChildStatus;
  enrolledOn: string | null;
  exitedOn?: string | null;
  dateOfBirth?: string | null;
  /** The school's name, as the guardian reports it. */
  school?: string | null;
  schoolStatus: SchoolStatus;
  programmes: ChildProgramme[];
  photoConsent: Consent;
  guardianConsent: Consent;
  deletedAt?: unknown;
}

/** Codes like HC-0042: short enough to read aloud or type from a card. */
export const CODE_PREFIX = 'HC';
export function childCode(sequence: number): string {
  return `${CODE_PREFIX}-${String(sequence).padStart(4, '0')}`;
}
/** A code typed or scanned, in any case and with or without the dash. */
export function normalizeCode(text: string): string | null {
  const m = /^\s*hc[-\s]?(\d{1,6})\s*$/i.exec(text);
  return m ? childCode(Number(m[1])) : null;
}

export const consentMissing = (c: Pick<Child, 'photoConsent' | 'guardianConsent' | 'status' | 'deletedAt'>) =>
  !c.deletedAt && c.status === 'active' && (!consentOnFile(c.photoConsent) || !consentOnFile(c.guardianConsent));

// ---- Programmes and sessions -----------------------------------------------------------------

export interface SessionEvent { id: string; date: string; name: string; activity?: string | null; type?: string; headcounts?: Headcounts | null; deletedAt?: unknown }
export interface SessionRecord { personId: string; eventId: string; status: string; deletedAt?: unknown }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const slugOf = (s: string) => norm(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x';

/** Which programme a session belongs to: its name starts with the programme's ("Football academy match" is Football academy). */
export function programmeOf(event: Pick<SessionEvent, 'activity' | 'name'>, programmes: readonly string[]): string | null {
  const label = norm(event.activity ?? event.name);
  const hits = programmes.filter((p) => label === norm(p) || label.startsWith(`${norm(p)} `));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export const MEALS_PROGRAMME = 'Saturday meals';
export const isMealSession = (e: Pick<SessionEvent, 'type'>) => e.type === 'meal';

/** Sessions with a register taken: at least one child was marked. A session nobody marked doesn't count against anyone. */
function takenSessions(events: readonly SessionEvent[], records: readonly SessionRecord[], programme: string, programmes: readonly string[], from: string | null, to: string) {
  const marked = new Set(records.filter((r) => !r.deletedAt).map((r) => r.eventId));
  return events
    .filter((e) => !e.deletedAt && e.date <= to && (!from || e.date >= from) && marked.has(e.id) && programmeOf(e, programmes) === programme)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const ABSENCE_LIMIT = 3;

/**
 * How many of a programme's latest sessions in a row the child missed (excused counts as missed here: the guardian
 * still deserves a call), and the date the run began. A run needs ABSENCE_LIMIT sessions to trigger a follow-up.
 */
export function missedInARow(
  childId: string, programme: string, programmes: readonly string[],
  events: readonly SessionEvent[], records: readonly SessionRecord[], enrolledOn: string | null, today: string,
): { missed: number; since: string | null } {
  const sessions = takenSessions(events, records, programme, programmes, enrolledOn, today);
  const here = new Map(records.filter((r) => !r.deletedAt && r.personId === childId).map((r) => [r.eventId, r.status]));
  let missed = 0;
  let since: string | null = null;
  for (const e of sessions) {
    if (attended(here.get(e.id))) break;
    missed += 1;
    since = e.date;
  }
  return { missed, since };
}

export interface AbsenceDue { childId: string; programme: string; since: string; missed: number; taskId: string }
export const absenceTaskId = (childId: string, programme: string, since: string) => `${childId}_absent_${slugOf(programme)}_${since}`;
/** The programme an absence task was made for, read back from its id. */
export function programmeOfTask(taskId: string, childId: string, programmes: readonly string[]): string | null {
  return programmes.find((p) => taskId.startsWith(`${childId}_absent_${slugOf(p)}_`)) ?? null;
}
/** A task the system closed because the child came back; it says nothing about whether the guardian was reached. */
export const CAME_BACK = 'Came back';

/** Active children who have missed ABSENCE_LIMIT sessions in a row of a programme they joined. */
export function absencesDue(children: readonly Child[], programmes: readonly string[], events: readonly SessionEvent[], records: readonly SessionRecord[], today: string): AbsenceDue[] {
  const out: AbsenceDue[] = [];
  for (const c of children) {
    if (c.deletedAt || c.status !== 'active') continue;
    for (const p of c.programmes) {
      if (norm(p.name) === norm(MEALS_PROGRAMME)) continue; // meals are drop-in; no one is chased for a missed Saturday
      const { missed, since } = missedInARow(c.id, p.name, programmes, events, records, c.enrolledOn, today);
      if (missed >= ABSENCE_LIMIT && since) out.push({ childId: c.id, programme: p.name, since, missed, taskId: absenceTaskId(c.id, p.name, since) });
    }
  }
  return out;
}

// ---- Numbers ---------------------------------------------------------------------------------

export interface HopeInput {
  children: readonly Child[];
  programmes: readonly string[];
  events: readonly SessionEvent[];
  records: readonly SessionRecord[];
  /** Absence follow-ups, for the guardian contact rate. */
  absenceTasks: readonly { status: string; outcome: string | null }[];
  today: string;
}

export interface HopeMetrics {
  registered: number;
  active: number;
  /** Active children who came to at least one session in the last 8 weeks. */
  attendingLast8Weeks: number;
  newlyRegistered: number;
  consentMissing: number;
  byProgramme: { name: string; sessions: number; averageAttendance: number | null; children: number }[];
  meals: { total: number; sessions: number; averagePerSession: number | null; newChildren: number; returningChildren: number };
  consistencyRate: number | null;
  retentionRate: number | null;
  reachOne: number;
  reachTwoPlus: number;
  schoolEnrolmentRate: number | null;
  guardianContactRate: number | null;
  openAbsenceFollowUps: number;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const avg = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 10) / 10 : null);

/** People at a session: the headcount when one was taken (names not captured), otherwise the children marked present or late. */
export function sessionAttendance(event: SessionEvent, records: readonly SessionRecord[]): number {
  const named = records.filter((r) => !r.deletedAt && r.eventId === event.id && attended(r.status)).length;
  const counted = event.headcounts ? headcountTotal(event.headcounts, (event.type as never) ?? 'session') : 0;
  return Math.max(named, counted);
}

export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function hopeMetrics(input: HopeInput, period: { from: string; to: string }): HopeMetrics {
  const kids = input.children.filter((c) => !c.deletedAt);
  const active = kids.filter((c) => c.status === 'active');
  const events = input.events.filter((e) => !e.deletedAt);
  const inPeriod = events.filter((e) => e.date >= period.from && e.date <= period.to);

  const since8 = addDays(period.to, -55);
  const recent = new Set(events.filter((e) => e.date >= since8 && e.date <= period.to).map((e) => e.id));
  const cameRecently = new Set(input.records.filter((r) => !r.deletedAt && recent.has(r.eventId) && attended(r.status)).map((r) => r.personId));

  const byProgramme = input.programmes.filter((p) => norm(p) !== norm(MEALS_PROGRAMME)).map((name) => {
    const sessions = inPeriod.filter((e) => programmeOf(e, input.programmes) === name);
    const people = sessions.reduce((s, e) => s + sessionAttendance(e, input.records), 0);
    return { name, sessions: sessions.length, averageAttendance: avg(people, sessions.length), children: active.filter((c) => c.programmes.some((p) => norm(p.name) === norm(name))).length };
  });

  const mealEvents = inPeriod.filter((e) => isMealSession(e) || programmeOf(e, input.programmes) === MEALS_PROGRAMME);
  const mealTotal = mealEvents.reduce((s, e) => s + sessionAttendance(e, input.records), 0);
  const mealNew = mealEvents.reduce((s, e) => s + (Number(e.headcounts?.new) || 0), 0);
  const mealReturning = mealEvents.reduce((s, e) => s + (Number(e.headcounts?.returning) || 0), 0);

  // Consistency: of children in a programme, those who came to at least 75% of its sessions in the 12 weeks to the end of the period.
  const windowFrom = addDays(period.to, -83);
  let withSessions = 0;
  let consistent = 0;
  for (const c of active) {
    let held = 0;
    let came = 0;
    const mine = new Map(input.records.filter((r) => !r.deletedAt && r.personId === c.id).map((r) => [r.eventId, r.status]));
    for (const p of c.programmes) {
      if (norm(p.name) === norm(MEALS_PROGRAMME)) continue;
      const from = c.enrolledOn && c.enrolledOn > windowFrom ? c.enrolledOn : windowFrom;
      for (const e of takenSessions(events, input.records, p.name, input.programmes, from, period.to)) {
        held += 1;
        if (attended(mine.get(e.id))) came += 1;
      }
    }
    if (held > 0) { withSessions += 1; if (came / held >= 0.75) consistent += 1; }
  }

  const sixMonthsAgo = monthsBefore(input.today, 6);
  const old = kids.filter((c) => c.enrolledOn && c.enrolledOn <= sixMonthsAgo);
  const keptSixMonths = old.filter((c) => c.status === 'active' || (c.exitedOn != null && c.exitedOn >= monthsBefore(c.enrolledOn!, -6)));

  const known = active.filter((c) => c.schoolStatus !== 'unknown');
  const done = input.absenceTasks.filter((t) => t.status === 'done' && t.outcome !== CAME_BACK);

  const real = (c: Child) => c.programmes.filter((p) => norm(p.name) !== norm(MEALS_PROGRAMME)).length + (c.programmes.some((p) => norm(p.name) === norm(MEALS_PROGRAMME)) ? 1 : 0);
  return {
    registered: kids.length,
    active: active.length,
    attendingLast8Weeks: active.filter((c) => cameRecently.has(c.id)).length,
    newlyRegistered: kids.filter((c) => c.enrolledOn != null && c.enrolledOn >= period.from && c.enrolledOn <= period.to).length,
    consentMissing: kids.filter(consentMissing).length,
    byProgramme,
    meals: { total: mealTotal, sessions: mealEvents.length, averagePerSession: avg(mealTotal, mealEvents.length), newChildren: mealNew, returningChildren: mealReturning },
    consistencyRate: pct(consistent, withSessions),
    retentionRate: pct(keptSixMonths.length, old.length),
    reachOne: active.filter((c) => real(c) === 1).length,
    reachTwoPlus: active.filter((c) => real(c) >= 2).length,
    schoolEnrolmentRate: pct(known.filter((c) => c.schoolStatus === 'in_school').length, known.length),
    guardianContactRate: pct(done.filter((t) => t.outcome === 'Reached').length, done.length),
    openAbsenceFollowUps: input.absenceTasks.filter((t) => t.status === 'open').length,
  };
}

// ---- Reports ---------------------------------------------------------------------------------

export interface HopeReportDoc {
  type: 'weekly' | 'monthly';
  /** "pastor": may list children by code and name. "counts": numbers only, safe for leadership and donors. */
  audience: 'pastor' | 'counts';
  from: string;
  to: string;
  label: string;
  metrics: HopeMetrics;
  /** Weekly (pastor) report only. */
  followUps?: { code: string; name: string; programme: string; since: string }[];
}

/**
 * The monthly report is counts only: it is never given a names map and carries no per-child field.
 * The weekly report is for the pastor and lists open absence follow-ups by code and name.
 */
export function buildHopeReport(
  input: HopeInput, type: 'weekly' | 'monthly', period: { from: string; to: string }, label: string,
  openTasks?: { childId: string; programme: string; since: string }[], who?: Record<string, { code: string; name: string }>,
): HopeReportDoc {
  const base = { type, from: period.from, to: period.to, label, metrics: hopeMetrics(input, period) };
  if (type === 'monthly') return { ...base, audience: 'counts' };
  return {
    ...base,
    audience: 'pastor',
    followUps: (openTasks ?? []).map((t) => ({ code: who?.[t.childId]?.code ?? '', name: who?.[t.childId]?.name ?? 'Unknown child', programme: t.programme, since: t.since })),
  };
}

/** Age in whole years on a day, or null when the date of birth is not known. */
export function ageOn(dateOfBirth: string | null | undefined, day: string): number | null {
  if (!dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = day.split('-').map(Number) as [number, number, number];
  if (!y || !ty) return null;
  const years = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return years >= 0 ? years : null;
}
