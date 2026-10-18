import { attended } from './attendance.js';

/**
 * The programme engine and groups. One set of rules for every programme:
 * a programme has topics and a completion rule, people enrol in a cohort,
 * and each class covers one or more topics. Growth Track, Freedom 252 and
 * Communication Master Class are configuration, not code.
 *
 * Shared by the app (live progress on screen) and Cloud Functions (which
 * record completion and move people along their journey).
 */

export interface Topic {
  id: string;
  name: string;
}

export type CompletionRule =
  | { type: 'all_topics' }
  | { type: 'topic_count'; count: number };

export interface ProgramConfig {
  name: string;
  description: string;
  topics: Topic[];
  completionRule: CompletionRule;
  /** The journey stage this programme moves people along, if any. */
  pipelineStageId: string | null;
  /** What finishing is called: "Completed" or "Graduated". */
  completedLabel: string;
  /** When classes usually meet, for example "Tuesday 20:00". */
  schedule: string;
  active: boolean;
}

/**
 * The church's standard programmes, from the brief. Freedom 252's topic
 * names are not known yet, so they start as "Topic 1" to "Topic 24" for the
 * pastor to rename. Communication Master Class has no curriculum yet.
 */
export const STANDARD_PROGRAMS: Record<string, ProgramConfig> = {
  growth_track: {
    name: 'Growth Track',
    description: 'Discipleship on four pillars. Complete when all four are done.',
    topics: [
      { id: 'know_god', name: 'Know God' },
      { id: 'find_freedom', name: 'Find Freedom' },
      { id: 'discover_purpose', name: 'Discover Purpose' },
      { id: 'make_a_difference', name: 'Make a Difference' },
    ],
    completionRule: { type: 'all_topics' },
    pipelineStageId: 'growth_track',
    completedLabel: 'Completed',
    schedule: '',
    active: true,
  },
  freedom_252: {
    name: 'Freedom 252',
    description: 'Two-semester leadership programme. Join any time; graduate by covering all 24 topics, including make-up classes.',
    topics: Array.from({ length: 24 }, (_, i) => ({ id: `topic_${String(i + 1).padStart(2, '0')}`, name: `Topic ${i + 1}` })),
    completionRule: { type: 'all_topics' },
    pipelineStageId: 'freedom_252',
    completedLabel: 'Graduated',
    schedule: 'Tuesday 20:00',
    active: true,
  },
  communication_master_class: {
    name: 'Communication Master Class',
    description: 'Cohort course on the same pattern as Growth Track. Add the topics when the curriculum is ready.',
    topics: [],
    completionRule: { type: 'all_topics' },
    pipelineStageId: 'communication_master_class',
    completedLabel: 'Completed',
    schedule: '',
    active: true,
  },
};

export const ENROLLMENT_STATUSES = ['active', 'completed', 'dropped'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export function enrollmentStatusLabel(status: EnrollmentStatus, completedLabel = 'Completed'): string {
  return status === 'active' ? 'Enrolled' : status === 'completed' ? completedLabel : 'Dropped';
}

function slug(text: string, max = 40): string {
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, max);
}

/** A new programme's id from its name, kept apart from ids already used. */
export function programIdFor(name: string, taken: readonly string[]): string {
  const base = slug(name) || 'programme';
  let id = base.length >= 2 ? base : `${base}_programme`;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

/** A new topic's id, kept apart from the programme's other topics. */
export function topicIdFor(name: string, taken: readonly string[]): string {
  const base = slug(name, 30) || 'topic';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

/** One enrolment per person per programme, so enrolling twice changes nothing. */
export const enrollmentIdFor = (programId: string, personId: string) => `${programId}_${personId}`;
export const teamMemberIdFor = (teamId: string, personId: string) => `${teamId}_${personId}`;
export const groupMemberIdFor = (groupId: string, personId: string) => `${groupId}_${personId}`;

/**
 * One class per programme per cohort per day, so two devices starting the
 * same class offline land on the same record. A make-up class is open to
 * everyone enrolled, whatever their cohort.
 */
export function programSessionIdFor(date: string, programId: string, cohortId: string | null): string {
  return `${date}_${programId}_${cohortId ?? 'makeup'}`;
}

/** One meeting per group per day. */
export function groupMeetingIdFor(date: string, groupId: string): string {
  return `${date}_group_${groupId}`;
}

export interface SessionLike {
  id: string;
  date: string;
  topicIds?: string[] | null;
  deletedAt?: unknown;
}

export interface MarkLike {
  eventId: string;
  status: string;
  deletedAt?: unknown;
}

export interface Coverage {
  /** Topic id -> date first covered, for topics still on the programme. */
  covered: Map<string, string>;
  count: number;
  total: number;
  complete: boolean;
  /** The day the last needed topic was covered, when complete. */
  completedDate: string | null;
}

export function topicsNeeded(rule: CompletionRule, total: number): number {
  if (total === 0) return Infinity; // nothing to complete until topics are added
  return rule.type === 'topic_count' ? Math.min(Math.max(1, Math.floor(rule.count)), total) : total;
}

/**
 * Which topics a person has covered: every class of the programme they
 * attended (present or late), whichever cohort or make-up class it was.
 */
export function coverage(
  topics: readonly Topic[],
  rule: CompletionRule,
  sessions: readonly SessionLike[],
  marks: readonly MarkLike[],
): Coverage {
  const known = new Set(topics.map((t) => t.id));
  const attendedIds = new Set(marks.filter((m) => !m.deletedAt && attended(m.status)).map((m) => m.eventId));
  const covered = new Map<string, string>();
  const ordered = sessions.filter((s) => !s.deletedAt && attendedIds.has(s.id)).sort((a, b) => a.date.localeCompare(b.date));
  for (const s of ordered) {
    for (const t of s.topicIds ?? []) if (known.has(t) && !covered.has(t)) covered.set(t, s.date);
  }
  const needed = topicsNeeded(rule, topics.length);
  const complete = covered.size >= needed;
  // The date the person reached the number of topics needed.
  const completedDate = complete ? [...covered.values()].sort()[needed - 1] ?? null : null;
  return { covered, count: covered.size, total: topics.length, complete, completedDate };
}

export interface EnrollmentState {
  status: EnrollmentStatus;
  completedDate: string | null;
  completedAuto: boolean;
}

/**
 * What an enrolment becomes after progress is recounted. Completion is
 * recorded by itself; a completion staff set by hand, or a drop, is never
 * changed. If an automatic completion no longer holds (a check-in was taken
 * back), the person goes back to enrolled.
 */
export function nextEnrollmentState(current: EnrollmentState, progress: Pick<Coverage, 'complete' | 'completedDate'>): EnrollmentState {
  if (current.status === 'active' && progress.complete) {
    return { status: 'completed', completedDate: progress.completedDate, completedAuto: true };
  }
  if (current.status === 'completed' && current.completedAuto) {
    return progress.complete
      ? { status: 'completed', completedDate: progress.completedDate, completedAuto: true }
      : { status: 'active', completedDate: null, completedAuto: false };
  }
  return current;
}

export type StageStatus = 'not_started' | 'in_progress' | 'completed' | 'dropped';

/**
 * How joining a programme, team or group moves a journey stage. It only
 * ever moves forward: a stage someone completed is never set back.
 * Returns null when nothing should change.
 */
export function nextStageStatus(existing: StageStatus | null, wanted: StageStatus): StageStatus | null {
  if (existing === wanted) return null;
  if (wanted === 'completed') return 'completed';
  if (wanted === 'in_progress') return existing === null || existing === 'not_started' || existing === 'dropped' ? 'in_progress' : null;
  if (wanted === 'dropped') return existing === 'in_progress' ? 'dropped' : null;
  return null;
}

// ---- Groups ---------------------------------------------------------------

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

function dayNumber(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function keyFor(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the week containing a day (1970-01-01 was a Thursday). */
function mondayOf(day: number): number {
  return day - ((day + 3) % 7);
}

/**
 * The group's meeting days that have passed with no meeting recorded in
 * their Monday-to-Sunday week, counted back from the latest one. A meeting
 * recorded on another day of the same week still counts. Weeks before the
 * group started are not counted, and today is not counted until it is over.
 */
export function missedMeetings(meetingDates: readonly string[], meetingDay: Weekday, startDate: string, today: string): { inARow: number; lastMissed: string | null } {
  const todayN = dayNumber(today);
  const startN = dayNumber(startDate);
  if (!Number.isFinite(todayN) || !Number.isFinite(startN)) return { inARow: 0, lastMissed: null };
  const offset = WEEKDAYS.indexOf(meetingDay);
  const metWeeks = new Set(meetingDates.map((d) => mondayOf(dayNumber(d))).filter(Number.isFinite));
  let week = mondayOf(todayN);
  if (week + offset >= todayN) week -= 7; // this week's meeting day hasn't passed yet
  let inARow = 0;
  let lastMissed: string | null = null;
  for (; week + offset >= startN && inARow < 52; week -= 7) {
    if (metWeeks.has(week)) break;
    if (inARow === 0) lastMissed = keyFor(week + offset);
    inARow++;
  }
  return { inARow, lastMissed };
}

/** A group is flagged after two missed meetings in a row. */
export const MISSED_MEETINGS_FLAG = 2;
