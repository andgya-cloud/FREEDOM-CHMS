/**
 * Reading a Google Meet attendance list (Andy, 2026-11-24, 3A 4A 6A). Andy hosts on Gmail and saves the list with a
 * Chrome attendance extension; extensions lay the list out differently, so this reads the usual shapes:
 *   - a row per join with Join (or First seen) and Leave (or Last seen) times, maybe a Duration;
 *   - a row per person with only a Duration (or "Time in call");
 *   - a row per person with a column per moment the extension looked (8:05 PM, 8:10 PM…) ticked when they were there.
 * Times are clock times on the class day. Everything is cut to the class hours, so time before 8 PM does not count.
 */
export interface MeetPerson {
  name: string;
  /** Minutes in the class hours. */
  minutes: number;
  /** First and last minute seen (minutes since midnight), when the list has times. */
  join: number | null;
  leave: number | null;
}
type Role = 'name' | 'join' | 'leave' | 'duration';

const roleOf = (head: string): Role | null => {
  const h = head.trim().toLowerCase();
  if (!h) return null;
  if (/duration|time in (call|meeting|class)|attended for|total time|minutes|time spent/.test(h)) return 'duration';
  if (/join|first seen|arriv|time in$|^in$|start/.test(h)) return 'join';
  if (/leave|left|last seen|exit|time out|^out$|end/.test(h)) return 'leave';
  if (/name|participant|attendee|student|who/.test(h)) return 'name';
  return null;
};

/** "8:04 PM", "20:04", "20:04:31", "2026-11-24 20:04:31", "11/24/2026, 8:04:12 PM" → minutes since midnight. */
export function clockOf(text: string, utcOffsetMinutes = 180): number | null {
  // A full date with a time zone (2026-11-24T17:04:31Z): turned into the church's clock (Nairobi is UTC+3).
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(text.trim())) {
    const d = new Date(text.trim());
    if (!Number.isNaN(d.getTime())) return (((d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + utcOffsetMinutes) % 1440) + 1440) % 1440;
  }
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\b/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]), sec = Number(m[3] ?? 0);
  if (h > 23 || min > 59) return null;
  const ap = m[4]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h * 60 + min + sec / 60;
}

/** "54 min", "1 hr 2 min", "1h 2m 10s", "01:02:33", "54:10", "54" → minutes. */
export function durationOf(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const parts = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (parts) {
    const [a, b, c] = [Number(parts[1]), Number(parts[2]), parts[3] != null ? Number(parts[3]) : null];
    if (c != null) return a * 60 + b + c / 60;
    return a <= 4 ? a * 60 + b : a + b / 60; // 1:05 is an hour and 5 minutes; 54:10 is 54 minutes
  }
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(t);
  const m = /(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/.exec(t);
  const s = /(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds)\b/.exec(t);
  if (h || m || s) return Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0) + Number(s?.[1] ?? 0) / 60;
  if (/^\d+(\.\d+)?$/.test(t)) { const n = Number(t); return n > 300 ? n / 60 : n; }
  return null;
}

const ABSENT = /^(no|n|absent|x|✗|✘|0|false|-|—)$/i;
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Joins overlapping times and adds them up. */
function unionMinutes(spans: [number, number][]): number {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, curA = -1, curB = -1;
  for (const [a, b] of s) {
    if (a > curB) { if (curB > curA) total += curB - curA; curA = a; curB = b; } else curB = Math.max(curB, b);
  }
  if (curB > curA) total += curB - curA;
  return total;
}

/** The list as people with their minutes in the class hours (`start`, `end` in minutes since midnight). */
export function readMeetList(table: readonly (readonly string[])[], start: number, end: number): MeetPerson[] {
  const headAt = table.findIndex((r) => r.some((c) => roleOf(c) === 'name'));
  if (headAt < 0) throw new Error('This list needs a Name (or Participant) column.');
  const head = table[headAt]!;
  const roles = head.map(roleOf);
  const col = (r: Role) => roles.indexOf(r);
  const nameAt = col('name'), joinAt = col('join'), leaveAt = col('leave'), durAt = col('duration');
  // A column per moment the extension looked, headed with a time.
  const moments = head.map((h, i) => ({ i, at: roles[i] ? null : clockOf(h) })).filter((m): m is { i: number; at: number } => m.at != null);
  const clip = (a: number, b: number): [number, number] => [Math.max(a, start), Math.min(b, end)];

  const byName = new Map<string, { name: string; spans: [number, number][]; dur: number; seen: number[] }>();
  for (const row of table.slice(headAt + 1)) {
    const name = tidy(row[nameAt] ?? '');
    if (!name || roleOf(name) === 'name' || /^(total|summary|meeting|date|duration)\b/i.test(name)) continue;
    const key = name.toLowerCase();
    const p = byName.get(key) ?? { name, spans: [], dur: 0, seen: [] };
    byName.set(key, p);
    const j = joinAt >= 0 ? clockOf(row[joinAt] ?? '') : null;
    const l = leaveAt >= 0 ? clockOf(row[leaveAt] ?? '') : null;
    const d = durAt >= 0 ? durationOf(row[durAt] ?? '') : null;
    if (j != null) {
      // Still in the call when the list was saved: there until the end.
      const to = l != null && l >= j ? l : d != null ? j + d : end;
      p.spans.push(clip(j, to));
      p.seen.push(j, to);
    } else if (d != null) {
      p.dur += d;
    }
    for (const m of moments) {
      const v = tidy(row[m.i] ?? '');
      if (v && !ABSENT.test(v)) p.seen.push(m.at);
    }
  }

  const step = moments.length > 1 ? Math.max(1, (moments[moments.length - 1]!.at - moments[0]!.at) / (moments.length - 1)) : 0;
  const classLen = end - start;
  return [...byName.values()].map((p) => {
    let minutes: number;
    if (p.spans.length) minutes = unionMinutes(p.spans);
    else if (moments.length) {
      const inClass = moments.filter((m) => m.at >= start - step / 2 && m.at <= end + step / 2);
      const seen = new Set(p.seen);
      minutes = inClass.length ? (inClass.filter((m) => seen.has(m.at)).length / inClass.length) * classLen : 0;
    } else minutes = Math.min(p.dur, classLen);
    const times = p.seen.filter((t) => t >= start - 60 && t <= end + 60);
    return {
      name: p.name, minutes: Math.round(Math.min(minutes, classLen)),
      join: times.length ? Math.round(Math.max(Math.min(...times), start - 30)) : null,
      leave: times.length ? Math.round(Math.min(Math.max(...times), end + 30)) : null,
    };
  }).filter((p) => p.minutes > 0 || p.join != null);
}

export const meetPercent = (minutes: number, start: number, end: number) => Math.min(100, Math.round((minutes / Math.max(1, end - start)) * 100));
