import { isCurrentChild, type Child } from './hope.js';
import { dayTrend, needsCall, rateFrom, saturdayOnOrBefore, type Champion, type ChampionDay, type HopeDay } from './hopeRegister.js';
import { monthPay, payMonthReady, type ChampionExtra } from './hopeChampionPay.js';
import { formatKes, type MealDay } from './hopeRecords.js';
import { childWarning } from './hopeWarning.js';
import { formatDateKey } from './datetime.js';

export interface MondayInput {
  today: string;
  children: (Child & { id: string })[];
  firstName: (id: string) => string;
  days: HopeDay[];
  meals: Pick<MealDay, 'date' | 'breakfast' | 'lunch' | 'fruit'>[];
  champions: Champion[];
  championDays: ChampionDay[];
  extras: ChampionExtra[];
  approvedPay: { id: string; total: number }[];
  /** Conversations not closed, and the children with an urgent one open. Counts only, never their words. */
  openChats: number;
  urgentChildIds: Set<string>;
}

const MONTH = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
const names = (ids: string[], first: (id: string) => string, max = 12) => {
  const n = ids.map(first).filter(Boolean);
  return n.length > max ? `${n.slice(0, max).join(', ')} and ${n.length - max} more` : n.join(', ');
};

/**
 * The Monday 7am summary for Andy and the Director (Andy, 2026-11-05, 16A): Saturday's attendance and its trend,
 * meals, champions who came, children who need us, open care conversations and pay due. Numbers and first names
 * only, with no private notes.
 */
export function mondaySummary(i: MondayInput): { subject: string; lines: string[] } {
  const sat = saturdayOnOrBefore(i.today);
  const day = i.days.find((d) => !d.deletedAt && d.date === sat);
  const kids = rateFrom(Object.values(day?.marks ?? {}));
  const trend = dayTrend(i.days, 6).filter((t) => t.pct != null);
  const prev = [...trend].reverse().find((t) => t.date < sat);
  const lines: string[] = [];

  lines.push(`SATURDAY ${formatDateKey(sat).toUpperCase()}`);
  if (!day || kids.marked === 0) lines.push('The children\'s register was not marked.');
  else {
    const change = prev?.pct != null && kids.pct != null ? kids.pct - prev.pct : null;
    lines.push(`Children: ${kids.present} came (${kids.pct ?? 0}%)${change == null ? '' : change === 0 ? ', the same as the Saturday before' : `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the Saturday before`}.`);
  }
  if (trend.length > 1) lines.push(`Last ${trend.length} Saturdays: ${trend.map((t) => `${t.pct}%`).join(' → ')}`);

  const weekFrom = new Date(Date.parse(`${i.today}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  const week = i.meals.filter((m) => m.date >= weekFrom && m.date < i.today);
  const meal = week.reduce((t, m) => ({ b: t.b + (m.breakfast || 0), l: t.l + (m.lunch || 0), f: t.f + (m.fruit || 0) }), { b: 0, l: 0, f: 0 });
  lines.push(meal.b + meal.l + meal.f > 0 ? `Meals last week: ${meal.b} breakfasts, ${meal.l} lunches, ${meal.f} fruit.` : 'No meals were counted last week.');

  const serving = i.champions.filter((c) => c.status === 'active');
  const cday = i.championDays.find((d) => !d.deletedAt && d.date === sat);
  const champs = rateFrom(Object.values(cday?.marks ?? {}));
  lines.push(cday ? `Champions: ${champs.present} of ${serving.length} came.` : `Champions: the register was not marked (${serving.length} serving).`);

  lines.push('', 'CHILDREN WHO NEED US');
  const current = i.children.filter(isCurrentChild);
  const call = current.filter((c) => needsCall(c, i.days)).map((c) => c.id);
  const red = current.filter((c) => childWarning(c, i.days, { urgent: i.urgentChildIds.has(c.id) }).level === 'red').map((c) => c.id);
  if (call.length) lines.push(`To call (missed the last 3 Saturdays): ${names(call, i.firstName)}.`);
  const otherRed = red.filter((id) => !call.includes(id));
  if (otherRed.length) lines.push(`🔴 Also need us: ${names(otherRed, i.firstName)}.`);
  if (!call.length && !otherRed.length) lines.push('None this week. 🎉');
  lines.push(`Open care conversations: ${i.openChats}.`);

  const ready = payMonthReady(i.today);
  if (ready) {
    const pay = monthPay(i.champions, i.championDays, i.extras, ready.month);
    const approved = i.approvedPay.find((a) => a.id === ready.month);
    lines.push('', 'PAY');
    lines.push(approved && approved.total === pay.total
      ? `Champions' pay for ${MONTH(ready.month)} is approved: ${formatKes(pay.total)}.`
      : `Champions' pay for ${MONTH(ready.month)} is ready to approve: ${formatKes(pay.total)}.`);
  }
  const subject = `Hope Centre this week: ${day && kids.marked ? `${kids.present} ${kids.present === 1 ? 'child' : 'children'} came on Saturday` : 'Monday summary'}${call.length + otherRed.length ? `, ${call.length + otherRed.length} need us` : ''}`;
  return { subject, lines };
}
