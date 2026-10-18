import type { OrganizationType } from './organizations.js';
import { weekContaining, zonedMidnight } from './datetime.js';

/**
 * Services, classes and sessions, and who attended them. Shared by the app
 * (check-in screens) and later by the reports, so both count the same way.
 */

export const EVENT_TYPES = ['service', 'class', 'session', 'meal', 'group'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  service: 'Service',
  class: 'Class',
  session: 'Session',
  meal: 'Meal',
  group: 'Group meeting',
};

/** present and late count as attended; absent and excused do not. */
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

/** staff: from the check-in screen; door: the tablet at the door; register: a class register. */
export const CHECK_IN_METHODS = ['staff', 'door', 'register'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export const HEADCOUNT_KEYS = ['adults', 'teens', 'children', 'new', 'returning', 'total'] as const;
export type HeadcountKey = (typeof HEADCOUNT_KEYS)[number];
export type Headcounts = Partial<Record<HeadcountKey, number>>;

export const HEADCOUNT_LABELS: Record<HeadcountKey, string> = {
  adults: 'Adults',
  teens: 'Teens',
  children: 'Children',
  new: 'New',
  returning: 'Returning',
  total: 'Total',
};

/** Which counts each kind of gathering asks for. */
export const HEADCOUNT_FIELDS: Record<EventType, HeadcountKey[]> = {
  service: ['adults', 'teens', 'children'],
  meal: ['new', 'returning'],
  session: ['total'],
  class: [],
  group: [],
};

/**
 * Starting lists of programmes, from the brief. Each organization can edit
 * its own list; these are used until it does. Church campuses use their
 * service times instead.
 */
export const DEFAULT_ACTIVITIES: Record<OrganizationType, string[]> = {
  church_campus: [],
  college: ['Food and Beverage Production', 'Dressmaking & Tailoring', 'ICT', 'Beauty Therapy & Cosmetology'],
  ministry: ['Saturday meals', 'Football academy', 'Chess club', 'Music academy'],
};

export function activitiesFor(org: { type: OrganizationType; activities?: string[] | null }): string[] {
  return org.activities?.length ? org.activities : DEFAULT_ACTIVITIES[org.type];
}

/** What a new gathering is called for each choice: "Sunday 10:00" becomes "Sunday 10:00 service". */
export function eventChoices(org: { type: OrganizationType; activities?: string[] | null; serviceTimes?: string[] | null }): string[] {
  if (org.type === 'church_campus') {
    const times = org.serviceTimes?.length ? org.serviceTimes : ['Sunday 10:00'];
    return times.map((t) => (/service/i.test(t) ? t : `${t} service`));
  }
  return activitiesFor(org);
}

export function eventTypeFor(orgType: OrganizationType, name: string): EventType {
  if (orgType === 'church_campus') return 'service';
  if (orgType === 'college') return 'class';
  return /meal/i.test(name) ? 'meal' : 'session';
}

function slug(text: string): string {
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'event';
}

/**
 * One gathering per name per day, so two devices opening "Sunday 10:00
 * service" on the same day, even offline, land on the same record.
 */
export function eventIdFor(date: string, name: string): string {
  return `${date}_${slug(name)}`;
}

/** Attendance is stored one per person per gathering, so checking in twice changes nothing. */
export function attendanceIdFor(eventId: string, personId: string): string {
  return `${eventId}_${personId}`;
}

export function attended(status: AttendanceStatus | string | undefined): boolean {
  return status === 'present' || status === 'late';
}

export function headcountTotal(counts: Headcounts | null | undefined, type: EventType): number {
  if (!counts) return 0;
  return HEADCOUNT_FIELDS[type].reduce((sum, k) => sum + (Number(counts[k]) || 0), 0);
}

/** Whole, non-negative, sensible: anything else from a text box becomes 0. */
export function cleanCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 0;
}

/**
 * The name shown on the door tablet, where anyone walking past can see it:
 * first name and initial only, "Grace Wanjiku" -> "Grace W.".
 */
export function doorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

/** The last three digits of a phone number, to tell two Graces apart at the door. */
export function phoneHint(e164: string | null | undefined): string {
  const digits = (e164 ?? '').replace(/\D/g, '');
  return digits.length >= 3 ? `…${digits.slice(-3)}` : '';
}

export interface AttendanceRecord {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus | string;
  deletedAt?: unknown;
}

/** Share of recorded classes attended (present or late), as a whole percentage; null with nothing recorded. */
export function attendanceRate(records: readonly AttendanceRecord[]): { attended: number; recorded: number; percent: number | null } {
  const live = records.filter((r) => !r.deletedAt);
  const count = live.filter((r) => attended(r.status)).length;
  return { attended: count, recorded: live.length, percent: live.length ? Math.round((count / live.length) * 100) : null };
}

/**
 * In how many of the last `weeks` Monday-to-Sunday weeks (this week included)
 * the person attended at least once. The basis for "regular attender".
 */
export function weeksAttended(records: readonly AttendanceRecord[], now: Date, weeks = 8, timeZone?: string): number {
  const thisWeek = weekContaining(now, timeZone);
  const earliest = new Date(thisWeek.start.getTime() - (weeks - 1) * 7 * 86_400_000);
  const seen = new Set<number>();
  for (const r of records) {
    if (r.deletedAt || !attended(r.status)) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date);
    if (!m) continue;
    const day = zonedMidnight(Number(m[1]), Number(m[2]), Number(m[3]), timeZone);
    if (day < earliest || day >= thisWeek.end) continue;
    seen.add(weekContaining(day, timeZone).start.getTime());
  }
  return seen.size;
}
