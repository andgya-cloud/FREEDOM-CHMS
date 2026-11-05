import { consentMissing, type Child } from './hope.js';
import { kidCame, missedSaturdays, needsCall, saturdayOnOrBefore, type HopeDay } from './hopeRegister.js';

export type WarningLevel = 'green' | 'amber' | 'red';
export interface ChildWarning { level: WarningLevel; reasons: string[] }
export const WARNING_DOT: Record<WarningLevel, string> = { green: '🟢', amber: '🟠', red: '🔴' };
export const WARNING_LABEL: Record<WarningLevel, string> = { green: 'Doing well', amber: 'Watch', red: 'Needs us' };

/**
 * The early warning for a child (v182, 14A), from what the app already knows: 🔴 needs us (missed the last 3
 * Saturdays with no call yet, an urgent conversation open, or came to fewer than half of the last 8 Saturdays),
 * 🟠 watch (missed the last 2, fewer than three in four, fees owing, consent missing, no sponsor, departing),
 * 🟢 doing well otherwise. Each reason is shown on the child's profile.
 */
export function childWarning(c: Child & { id: string }, days: readonly HopeDay[], extra: { urgent?: boolean; owing?: boolean } = {}): ChildWarning {
  const red: string[] = [], amber: string[] = [];
  if (extra.urgent) red.push('An urgent conversation is open');
  if (needsCall(c, days)) red.push('Missed the last 3 Saturdays, parent not called yet');
  else if (missedSaturdays(c.id, c.enrolledOn, days, 3)) amber.push('Missed the last 3 Saturdays (parent called)');
  else if (missedSaturdays(c.id, c.enrolledOn, days, 2)) amber.push('Missed the last 2 Saturdays');
  const sats = days.filter((d) => !d.deletedAt && saturdayOnOrBefore(d.date) === d.date && Object.keys(d.marks ?? {}).length > 0 && (!c.enrolledOn || d.date >= c.enrolledOn))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).filter((d) => d.marks[c.id]?.s !== 'excused');
  if (sats.length >= 4) {
    const pct = Math.round((sats.filter((d) => kidCame(d.marks[c.id]?.s)).length / sats.length) * 100);
    if (pct < 50) red.push(`Came to ${pct}% of the last ${sats.length} Saturdays`);
    else if (pct < 75) amber.push(`Came to ${pct}% of the last ${sats.length} Saturdays`);
  }
  if (extra.owing) amber.push('School fees still to pay this term');
  if (consentMissing(c)) amber.push('Consent missing');
  if (!c.sponsorName && !c.sponsorship?.sponsorName) amber.push('No sponsor yet');
  if (c.status === 'departing') amber.push('Departing');
  return { level: red.length ? 'red' : amber.length ? 'amber' : 'green', reasons: [...red, ...amber] };
}
