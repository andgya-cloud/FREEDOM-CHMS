import { classOf } from '../../../functions/src/shared/hopeClasses';
import { kidCame, saturdayOnOrBefore, streak, type HopeDay } from '../../../functions/src/shared/hopeRegister';
import type { Child } from '../../../functions/src/shared/hope';
import type { Club, ClubWin } from '../../../functions/src/shared/hopeClubs';
import type { SponsorPage } from '../../lib/sponsorUpdate';

/** A child's Sponsor update page (v182, 13A): this year's Saturdays, their clubs and wins. */
export function sponsorPage(input: {
  child: Child; name: string; age: number | null; today: string; days: readonly HopeDay[]; clubs: readonly Club[]; wins: readonly ClubWin[];
  photo: string | null; note?: string;
}): SponsorPage {
  const { child: c, today } = input;
  const year = today.slice(0, 4);
  const sats = input.days.filter((d) => !d.deletedAt && d.date.startsWith(year) && saturdayOnOrBefore(d.date) === d.date && Object.keys(d.marks ?? {}).length > 0
    && (!c.enrolledOn || d.date >= c.enrolledOn));
  return {
    name: input.name, code: c.code ?? '', childId: c.sponsorship?.childId ?? '', age: input.age, klass: classOf(c.dateOfBirth, today),
    school: c.school ?? '', schoolClass: c.schoolClass ?? '', photo: c.photoConsent?.given ? input.photo : null,
    sponsorName: c.sponsorName ?? c.sponsorship?.sponsorName ?? '', registeredOn: c.enrolledOn ?? c.sponsorship?.registeredOn ?? null,
    came: sats.filter((d) => kidCame(d.marks[c.id]?.s)).length, of: sats.filter((d) => d.marks[c.id]?.s !== 'excused').length,
    streak: streak(c.id, input.days),
    clubs: input.clubs.filter((k) => k.status === 'active' && k.memberIds.includes(c.id)).map((k) => ({ name: k.name, level: k.levels?.[c.id] ?? '' })),
    wins: input.wins.filter((w) => w.childIds.includes(c.id) && w.date.startsWith(year)).map((w) => ({ date: w.date, title: w.title })),
    note: input.note ?? '',
  };
}
