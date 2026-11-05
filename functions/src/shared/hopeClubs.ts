/**
 * Freedom Hope Centre clubs (Andy, 2026-11-04, 8A): each club has its members, its champion leaders, a day and
 * time, a weekly register with percentages, and a wins log. Football, Chess and Music keep the history of their
 * earlier programme sessions. A club's register for a day is clubDays/{clubId}_{date}.
 */
import { addDays } from './metrics.js';
import { rateFrom, type HopeDay, type KidEntry } from './hopeRegister.js';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Club {
  id: string;
  name: string;
  emoji: string;
  description: string;
  day: Weekday;
  /** "HH:MM" start and end. */
  time: string;
  endTime: string;
  place: string;
  /** The most children the club can take; 0 means no limit. */
  capacity: number;
  memberIds: string[];
  /** Champions who lead the club. */
  leaderIds: string[];
  /** A level or group for each member (chess rating, music grade, football team). */
  levels: Record<string, string>;
  /** The earlier programme whose sessions are this club's history (Football academy, Chess club, Music academy). */
  legacyProgramme: string | null;
  status: 'active' | 'paused';
  deletedAt?: unknown;
}

export interface ClubDay extends HopeDay { clubId: string }
export const clubDayId = (clubId: string, date: string) => `${clubId}_${date}`;

export const WIN_KINDS = ['award', 'match', 'performance', 'milestone', 'product', 'other'] as const;
export type WinKind = (typeof WIN_KINDS)[number];
export const WIN_KIND_LABELS: Record<WinKind, string> = {
  award: 'Award or prize', match: 'Match or competition won', performance: 'Performance or show', milestone: 'Milestone or level passed',
  product: 'Something made or sold', other: 'Other good news',
};
export const WIN_EMOJI: Record<WinKind, string> = { award: '🏆', match: '⚽', performance: '🎤', milestone: '⭐', product: '🧺', other: '🎉' };
export interface ClubWin { id: string; clubId: string; date: string; kind: WinKind; title: string; note: string; childIds: string[]; deletedAt?: unknown }

/** The eight clubs Andy named, in his order, with the earlier programme each one continues. */
export const STARTER_CLUBS: { name: string; emoji: string; legacy: string | null; level: string }[] = [
  { name: 'Football Academy', emoji: '⚽', legacy: 'Football academy', level: 'Team or age group' },
  { name: 'Chess Club', emoji: '♟️', legacy: 'Chess club', level: 'Level reached' },
  { name: 'Music Academy', emoji: '🎵', legacy: 'Music academy', level: 'Instrument and grade' },
  { name: 'Fashion and Design Club', emoji: '🧵', legacy: null, level: 'Level' },
  { name: 'Baking Club', emoji: '🧁', legacy: null, level: 'Level' },
  { name: 'Computer Club', emoji: '💻', legacy: null, level: 'Level' },
  { name: 'Mat Making Club', emoji: '🧶', legacy: null, level: 'Level' },
  { name: 'Soap and Detergents Club', emoji: '🧼', legacy: null, level: 'Level' },
];

/** What the level is called in a club. */
export function levelLabel(club: Pick<Club, 'name'>): string {
  const n = club.name.toLowerCase();
  if (n.includes('football')) return 'Team or age group';
  if (n.includes('chess')) return 'Level reached';
  if (n.includes('music')) return 'Instrument and grade';
  return 'Level';
}

/** The club's day on or before a date ("the last Tuesday"). */
export function clubDayOnOrBefore(day: Weekday, date: string): string {
  const want = (WEEKDAYS.indexOf(day) + 1) % 7; // 0 Sunday … 6 Saturday
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((dow - want + 7) % 7));
}

/** A member's attendance in a club. */
export function memberRate(childId: string, days: readonly ClubDay[]) {
  return rateFrom(days.filter((d) => !d.deletedAt && d.marks?.[childId]).map((d) => d.marks[childId] as KidEntry));
}

/** The club's own percentage over its register days, and the members who came to under half (to follow up). */
export function clubSummary(club: Pick<Club, 'memberIds'>, days: readonly ClubDay[]) {
  const all = rateFrom(days.filter((d) => !d.deletedAt).flatMap((d) => Object.values(d.marks ?? {})));
  const atRisk = club.memberIds.filter((id) => { const r = memberRate(id, days); return r.pct != null && r.present + r.absent >= 3 && r.pct < 50; });
  return { ...all, sessions: days.filter((d) => !d.deletedAt && Object.keys(d.marks ?? {}).length).length, atRisk };
}

/** "Saturday 10:00 to 12:00" */
export function scheduleText(c: Pick<Club, 'day' | 'time' | 'endTime' | 'place'>): string {
  return [c.day, c.time && c.endTime ? `${c.time} to ${c.endTime}` : c.time, c.place].filter(Boolean).join(' · ');
}
