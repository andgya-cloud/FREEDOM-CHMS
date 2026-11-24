/**
 * Freedom Church Youth (Andy, 2026-11-24, 1A-9A): its own ministry beside Sunday school (the Teens class stays in
 * Sunday school). Sheila leads it (0727671790), as one group (3B). Youth meet on Sundays and on their own days (4A);
 * Sheila counts each meeting on her phone, and a Sunday's youth add into the Sunday total (5A). The youth room,
 * timetable and reminders are Sunday school's, with Sheila, Andy and Doreen as the editors (6A-8A).
 */
import type { SsClass } from './sundaySchool.js';
import { ssDayLabel, type SsDay } from './ssTimetable.js';

export const YOUTH_LEADER = 'Sheila';
/** The one youth group (3B), shaped like a Sunday school class so the timetable and room work the same. */
export const YOUTH_GROUP: SsClass = { id: 'youth', name: 'Youth', ages: '', leader: YOUTH_LEADER };

export interface YouthCount { date: string; name: string; count: number; by: string }

/** A youth meeting today: a day on the youth timetable (any day, 4A), or a Sunday. Null when there is none. */
export function youthMeeting(today: string, day: SsDay | null, sunday: boolean): { date: string; name: string } | null {
  if (day?.noClass) return null;
  if (day) return { date: today, name: day.title || (sunday ? 'Sunday youth' : 'Youth meeting') };
  return sunday ? { date: today, name: 'Sunday youth' } : null;
}

/** The message Sheila sends the youth group the day before (8A), by hand on WhatsApp. */
export function youthReminderText(o: { day: SsDay; app: string; drive: string }): string {
  const d = o.day;
  const l = d.lessons.youth;
  const lines = [`Youth meeting ${ssDayLabel(d.date, false)}${d.time ? `, ${d.time}` : ''} 🔥`];
  if (d.title) lines.push(d.title);
  if (d.theme) lines.push(`Theme: ${d.theme}`);
  if (l?.title) lines.push(`Topic: ${l.title}`);
  if (l?.passage) lines.push(`Bible passage: ${l.passage}`);
  if (l?.verse) lines.push(`Memory verse: ${l.verse}`);
  if (l?.activity) lines.push(`Activity: ${l.activity}`);
  if (d.note) lines.push(d.note);
  if (l?.teacher) lines.push(`Leading: ${l.teacher}`);
  if (l?.link || d.link) lines.push(`Notes: ${l?.link || d.link}`);
  if (o.drive) lines.push(`Youth folder: ${o.drive}`);
  lines.push('', 'See you there! Freedom Church Youth');
  return lines.join('\n');
}

/** The weekly summary for Sheila (9A): each meeting's number, the reports and the wins. */
export function youthSummaryLines(counts: YouthCount[], reports: { day: string; present: number; lesson: string; win: string; need: string; by: string }[], wins: number): string[] {
  const lines: string[] = [];
  const days = [...new Set([...counts.map((c) => c.date), ...reports.map((r) => r.day)])].sort();
  for (const d of days) {
    const c = counts.find((x) => x.date === d);
    const r = reports.filter((x) => x.day === d);
    lines.push(`${ssDayLabel(d, false)}: ${c ? `${c.count} young people${c.name ? ` · ${c.name}` : ''}` : 'not counted'}`);
    for (const x of r) {
      if (x.lesson) lines.push(`   Topic: ${x.lesson}`);
      if (x.win) lines.push(`   Win: ${x.win}`);
      if (x.need) lines.push(`   Need: ${x.need}`);
    }
  }
  if (!days.length) lines.push('No youth meetings were counted this week.');
  lines.push(`Wins posted in the youth room: ${wins}`);
  lines.push(`Total at youth meetings: ${counts.reduce((s, c) => s + c.count, 0)}`);
  return lines;
}
