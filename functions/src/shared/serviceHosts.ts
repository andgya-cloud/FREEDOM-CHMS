/**
 * Service hosts (Andy, 2026-11-17: 1B "Service Host", 2A, 3A, 4A, 5A, 6A, 7B, 8A, 9A, 10A, 11A).
 * One Service Host leads each service. Andy keeps the list of hosts (anyone, recruited any time, with a phone and an
 * email; they never sign in), the services that need a host (Sunday plus any he adds), and one requirements
 * document. "Suggest fair turns" fills empty dates as suggestions only: Andy chooses, and nothing is sent until a
 * date has a host he set. Each host is reminded 7, 3, 2 and 1 days before, at 6 PM Nairobi time. The first
 * reminder asks "Yes, I'll lead" or "I can't". After Yes the rest are routine reminders; after "I can't" nothing
 * more goes to them and Andy is told, with the next free host suggested.
 * Shared by the app (to draw the schedule) and the server (to send reminders), so both agree.
 */
import { addDays, dayLabel, daysBetween, isDateKey, isTime, weekdayOf } from './calendar.js';

export { addDays, daysBetween, dayLabel, isDateKey, isTime, weekdayOf };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** A service that needs a host every week (2A). */
export interface HostService { key: string; name: string; weekday: number; time: string }
/** A one-off service on a single date, such as a conference night. */
export interface SpecialService { key: string; name: string; date: string; time: string }

export interface HostSettings {
  services: HostService[];
  specials: SpecialService[];
  /** The requirements document (8A), kept in Storage; the server attaches it to every email. */
  doc: { name: string; type: string; size: number; path: string; uploadedOn: string } | null;
}

export interface AwaySpan { from: string; to: string }

export interface ServiceHost {
  id: string;
  name: string;
  phone: string;
  email: string;
  /** The person in People, when Andy picked one (9A). */
  personId: string | null;
  active: boolean;
  away: AwaySpan[];
  joinedOn: string;
  deletedAt?: unknown;
}

export type SlotStatus = 'suggested' | 'set';
export type Answer = 'pending' | 'yes' | 'no';

/** One service on one date and who hosts it: organizations/{org}/serviceRota/{date}_{serviceKey}. */
export interface RotaSlot {
  id: string;
  date: string;
  serviceKey: string;
  serviceName: string;
  time: string;
  hostId: string | null;
  hostName: string;
  status: SlotStatus;
  answer: Answer;
  reason: string;
  answeredOn: string | null;
  /** The server's last reminder (the day, and how many days before); and the day it was sent on WhatsApp. */
  remindedOn?: string;
  remindedDays?: number;
  waOn?: string;
}

/** The days before a service when its host hears from us (Andy's choice): a week, 3 days, 2 days, the day before. */
export const REMINDER_DAYS = [7, 3, 2, 1] as const;
/** 7B: reminders go at 6 PM Nairobi time. */
export const REMINDER_HOUR = 18;
/** How far ahead the schedule is planned and shown (3A: three months). */
export const PLAN_WEEKS = 13;
export const DOC_MAX_BYTES = 7 * 1024 * 1024;

export const slotId = (date: string, serviceKey: string) => `${date}_${serviceKey}`;
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** The weekly services from the church's service times ("Sunday 10:00"), or one Sunday 10:00 service. */
export function defaultServices(serviceTimes: readonly string[] | null | undefined): HostService[] {
  const out: HostService[] = [];
  for (const s of serviceTimes ?? []) {
    const m = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?/i.exec(s.trim());
    if (!m) continue;
    const weekday = WEEKDAYS.findIndex((w) => w.toLowerCase() === m[1]!.toLowerCase());
    let h = Number(m[2]);
    if (m[4]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[4]?.toLowerCase() === 'am' && h === 12) h = 0;
    const time = `${String(h).padStart(2, '0')}:${m[3]}`;
    const key = `${WEEKDAYS[weekday]!.slice(0, 3).toLowerCase()}${time.replace(':', '')}`;
    if (!out.some((o) => o.key === key)) out.push({ key, name: weekday === 0 ? 'Sunday service' : `${WEEKDAYS[weekday]} service`, weekday, time });
  }
  return out.length ? out : [{ key: 'sun1000', name: 'Sunday service', weekday: 0, time: '10:00' }];
}

export function settingsOr(raw: Partial<HostSettings> | null | undefined, serviceTimes?: readonly string[] | null): HostSettings {
  return {
    services: raw?.services?.length ? raw.services : defaultServices(serviceTimes),
    specials: raw?.specials ?? [],
    doc: raw?.doc ?? null,
  };
}

export interface PlannedDate { id: string; date: string; serviceKey: string; serviceName: string; time: string }

/** Every service date from `from` for `weeks` weeks, earliest first. */
export function plannedDates(s: Pick<HostSettings, 'services' | 'specials'>, from: string, weeks = PLAN_WEEKS): PlannedDate[] {
  const to = addDays(from, weeks * 7 - 1);
  const out: PlannedDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const sv of s.services) if (sv.weekday === weekdayOf(d)) out.push({ id: slotId(d, sv.key), date: d, serviceKey: sv.key, serviceName: sv.name, time: sv.time });
  }
  for (const sp of s.specials) if (sp.date >= from && sp.date <= to) out.push({ id: slotId(sp.date, sp.key), date: sp.date, serviceKey: sp.key, serviceName: sp.name, time: sp.time });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export const isAway = (h: Pick<ServiceHost, 'away'>, date: string) => (h.away ?? []).some((a) => date >= a.from && date <= (a.to || a.from));
const usable = (h: ServiceHost) => h.active && !h.deletedAt;

interface Count { n: number; last: string }
function countsOf(hosts: ServiceHost[], slots: Pick<RotaSlot, 'date' | 'hostId' | 'answer'>[]): Map<string, Count> {
  const m = new Map<string, Count>(hosts.map((h) => [h.id, { n: 0, last: '' }]));
  for (const s of slots) {
    if (!s.hostId || s.answer === 'no') continue;
    const c = m.get(s.hostId);
    if (!c) continue;
    c.n += 1;
    if (s.date > c.last) c.last = s.date;
  }
  return m;
}

/** Hosts who could take this date: active, not away, not on another service that day, not hosting the service just before. */
function candidates(hosts: ServiceHost[], date: string, taken: Pick<RotaSlot, 'date' | 'hostId' | 'answer'>[], previousHost: string | null, exclude: Set<string>): ServiceHost[] {
  const busy = new Set(taken.filter((t) => t.date === date && t.hostId && t.answer !== 'no').map((t) => t.hostId!));
  return hosts.filter((h) => usable(h) && !isAway(h, date) && !busy.has(h.id) && !exclude.has(h.id) && h.id !== previousHost);
}

function fairest(list: ServiceHost[], counts: Map<string, Count>): ServiceHost | null {
  return [...list].sort((a, b) => {
    const ca = counts.get(a.id) ?? { n: 0, last: '' };
    const cb = counts.get(b.id) ?? { n: 0, last: '' };
    return ca.n - cb.n || ca.last.localeCompare(cb.last) || a.name.localeCompare(b.name);
  })[0] ?? null;
}

/**
 * "Suggest fair turns" (3A): a host for every empty date, as a suggestion. Everyone takes turns (the fewest turns
 * first, then the longest since their last), nobody twice in a row, nobody on a date they are away. Dates that
 * already have a host keep it. Returns slot id → host id.
 */
export function suggestFill(dates: PlannedDate[], hosts: ServiceHost[], existing: RotaSlot[]): Map<string, string> {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const all: Pick<RotaSlot, 'date' | 'hostId' | 'answer'>[] = existing.filter((s) => s.hostId).map((s) => ({ date: s.date, hostId: s.hostId, answer: s.answer }));
  const counts = countsOf(hosts, all);
  const out = new Map<string, string>();
  let previous: string | null = null;
  const before = existing.filter((s) => s.date < (dates[0]?.date ?? '') && s.hostId && s.answer !== 'no').sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  previous = before?.hostId ?? null;
  for (const d of dates) {
    const have = byId.get(d.id);
    if (have?.hostId && have.answer !== 'no') { previous = have.hostId; continue; }
    const declined = new Set(have?.answer === 'no' && have.hostId ? [have.hostId] : []);
    const pick = fairest(candidates(hosts, d.date, all, previous, declined), counts) ?? fairest(candidates(hosts, d.date, all, null, declined), counts);
    if (!pick) { previous = null; continue; }
    out.set(d.id, pick.id);
    all.push({ date: d.date, hostId: pick.id, answer: 'pending' });
    const c = counts.get(pick.id)!;
    c.n += 1;
    if (d.date > c.last) c.last = d.date;
    previous = pick.id;
  }
  return out;
}

/** The next free host for a date someone said they can't take (5A), or null. */
export function nextFree(date: string, hosts: ServiceHost[], slots: RotaSlot[], exclude: string[]): ServiceHost | null {
  const others = slots.filter((s) => s.hostId);
  return fairest(candidates(hosts, date, others, null, new Set(exclude)), countsOf(hosts, others));
}

export type ReminderKind = 'ask' | 'routine';

/**
 * What tonight's 6 PM run sends for a slot, if anything. `sentDays` are the days-before already sent to this host.
 * A week before: the ask. A host set later than that gets the ask on the first evening. 3, 2 and 1 days before:
 * a routine reminder after Yes, or the ask again while there is no answer. After "I can't", nothing.
 */
export function reminderFor(slot: Pick<RotaSlot, 'date' | 'hostId' | 'status' | 'answer'>, today: string, sentDays: readonly number[]): { days: number; kind: ReminderKind } | null {
  if (!slot.hostId || slot.status !== 'set' || slot.answer === 'no') return null;
  const days = daysBetween(today, slot.date);
  if (days < 1 || days > 7 || sentDays.includes(days)) return null;
  const due = (REMINDER_DAYS as readonly number[]).includes(days) || sentDays.length === 0;
  if (!due) return null;
  return { days, kind: slot.answer === 'yes' ? 'routine' : 'ask' };
}

export const daysLabel = (days: number) => (days === 1 ? 'tomorrow' : days === 7 ? 'in one week' : `in ${days} days`);

export function clock(hhmm: string): string {
  if (!isTime(hhmm)) return '';
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A Kenyan phone number in the form WhatsApp links need (2547…), or '' when it cannot be read. */
export function waNumber(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  if (/^254[17]\d{8}$/.test(d)) return d;
  return d.length >= 10 ? d : '';
}

export interface HostMessageInput {
  church: string;
  hostName: string;
  serviceName: string;
  date: string;
  time: string;
  days: number;
  kind: ReminderKind;
  link: string;
  /** Where the requirements are: attached to the email, on the link (WhatsApp), or none uploaded. */
  doc: 'attached' | 'link' | null;
}

/** The words of a reminder, the same in the email and on WhatsApp (6A). */
export function hostMessage(m: HostMessageInput): { subject: string; text: string } {
  const when = `${dayLabel(m.date, false)}${m.time ? ` at ${clock(m.time)}` : ''}`;
  const hello = `Hello ${firstName(m.hostName)},`;
  const doc = m.doc === 'attached' ? ' The Service Host requirements are attached. Please read them before the day.' : m.doc === 'link' ? ' The Service Host requirements are on the link below. Please read them before the day.' : '';
  if (m.kind === 'ask') {
    return {
      subject: `Can you host the ${m.serviceName} on ${dayLabel(m.date, false)}?`,
      text: `${hello} you are the Service Host for the ${m.serviceName} at ${m.church} ${daysLabel(m.days)}, ${when}.${doc}\n\nPlease tap to say "Yes, I'll lead" or "I can't": ${m.link}\n\nThank you and God bless.`,
    };
  }
  return {
    subject: `Reminder: you host the ${m.serviceName} ${daysLabel(m.days)}`,
    text: `${hello} a reminder that you are the Service Host for the ${m.serviceName} at ${m.church} ${daysLabel(m.days)}, ${when}. Thank you for saying yes.${doc}\n\nYour details: ${m.link}\n\nGod bless.`,
  };
}

export function welcomeMessage(church: string, hostName: string, hasDoc: boolean): { subject: string; text: string } {
  return {
    subject: `Welcome to the Service Hosts team at ${church}`,
    text: `Hello ${firstName(hostName)}, welcome to the Service Hosts team at ${church}. Thank you for serving.\n\nWhen it is your turn to host a service you will get a message a week before, asking you to confirm, and short reminders 3 days, 2 days and the day before.${hasDoc ? '\n\nThe Service Host requirements are attached. Please read them carefully.' : ''}\n\nGod bless.`,
  };
}

/** Plain checks for the server. */
export const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 100) : '');
export const cleanPhone = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\d+ ]/g, '').trim().slice(0, 20) : '');
export const cleanEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 120) : '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function cleanAway(raw: unknown): AwaySpan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => ({ from: (a as AwaySpan)?.from, to: (a as AwaySpan)?.to || (a as AwaySpan)?.from }))
    .filter((a): a is AwaySpan => isDateKey(a.from) && isDateKey(a.to) && a.to >= a.from)
    .slice(0, 30);
}

export function cleanServices(raw: unknown): HostService[] {
  if (!Array.isArray(raw)) return [];
  const out: HostService[] = [];
  for (const r of raw.slice(0, 10)) {
    const name = cleanName((r as HostService)?.name).slice(0, 60);
    const weekday = Number((r as HostService)?.weekday);
    const time = (r as HostService)?.time;
    if (!name || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !isTime(time)) continue;
    const key = typeof (r as HostService).key === 'string' && /^[a-z0-9]{3,20}$/.test((r as HostService).key) ? (r as HostService).key : `${WEEKDAYS[weekday]!.slice(0, 3).toLowerCase()}${time.replace(':', '')}`;
    if (!out.some((o) => o.key === key)) out.push({ key, name, weekday, time });
  }
  return out;
}

export function cleanSpecials(raw: unknown): SpecialService[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecialService[] = [];
  for (const r of raw.slice(0, 60)) {
    const name = cleanName((r as SpecialService)?.name).slice(0, 60);
    const { date, time } = (r as SpecialService) ?? {};
    if (!name || !isDateKey(date) || !isTime(time)) continue;
    const key = typeof (r as SpecialService).key === 'string' && /^x[a-z0-9]{3,20}$/.test((r as SpecialService).key) ? (r as SpecialService).key : `x${date.replace(/-/g, '')}${time.replace(':', '')}`;
    if (!out.some((o) => o.key === key)) out.push({ key, name, date, time });
  }
  return out;
}
