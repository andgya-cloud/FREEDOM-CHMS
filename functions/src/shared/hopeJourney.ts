import { HOPE_CLASSES } from './hopeClasses.js';
import { kidCame, type HopeDay } from './hopeRegister.js';
import type { ClubWin } from './hopeClubs.js';
import type { Child } from './hope.js';

export interface JourneyStep { date: string; icon: string; text: string; private?: boolean }

const MILESTONES = [1, 10, 25, 50, 100, 150, 200];

/**
 * A child's journey at Hope (v183, 15A), oldest first: joined, first Saturday and attendance milestones, moving up a
 * stone class on a birthday, club wins, and (only when notes are passed in, for those allowed to read them) home visits.
 */
export function childJourney(c: Child & { id: string }, o: {
  today: string; days: readonly HopeDay[]; wins: readonly ClubWin[]; clubName?: (clubId: string) => string;
  visits?: readonly { day: string; kind: string }[];
}): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const joined = c.enrolledOn ?? c.sponsorship?.registeredOn ?? null;
  if (joined) steps.push({ date: joined, icon: '🌱', text: 'Joined the Hope Centre' });
  const came = o.days.filter((d) => !d.deletedAt && kidCame(d.marks?.[c.id]?.s)).map((d) => d.date).sort();
  for (const n of MILESTONES) {
    const day = came[n - 1];
    if (day) steps.push({ date: day, icon: n === 1 ? '👣' : '⭐', text: n === 1 ? 'First day at Hope' : `${n} days at Hope` });
  }
  if (c.dateOfBirth) {
    const [y, md] = [Number(c.dateOfBirth.slice(0, 4)), c.dateOfBirth.slice(4)];
    for (const k of HOPE_CLASSES.slice(1)) {
      const day = `${String(y + k.from).padStart(4, '0')}${md === '-02-29' ? '-03-01' : md}`;
      if (day <= o.today && (!joined || day > joined)) steps.push({ date: day, icon: '💎', text: `Moved up to ${k.name}` });
    }
  }
  for (const w of o.wins) {
    if (w.deletedAt || !w.childIds.includes(c.id)) continue;
    const club = o.clubName?.(w.clubId);
    steps.push({ date: w.date, icon: '🏆', text: club ? `${w.title} (${club})` : w.title });
  }
  for (const v of o.visits ?? []) {
    if (v.kind === 'visit' || v.kind === 'home') steps.push({ date: v.day, icon: '🏠', text: 'Home visit', private: true });
  }
  return steps.filter((s) => s.date <= o.today).sort((a, b) => a.date.localeCompare(b.date));
}
