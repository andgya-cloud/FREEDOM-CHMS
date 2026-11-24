import { eventIdFor, serviceName, type Headcounts } from './attendance.js';

/**
 * Phone counters (Andy, 2026-11-23, 1A-10A): each Sunday number has one person, who counts it on their own phone
 * from a link with no password. They see only their number, big, with a + button and "Type the number". The count
 * goes straight into the service record, so the Sunday page and Today show it live. Shared by the server and the app.
 */
export const COUNTER_JOBS = ['adults', 'teens', 'children', 'all', 'firstTimers', 'salvations'] as const;
export type CounterJob = (typeof COUNTER_JOBS)[number];
export const isCounterJob = (v: unknown): v is CounterJob => typeof v === 'string' && (COUNTER_JOBS as readonly string[]).includes(v);

export const COUNTER_INFO: Record<CounterJob, { label: string; hint: string; emoji: string }> = {
  adults: { label: 'Adults', hint: '20 and over', emoji: '🧑' },
  teens: { label: 'Teens', hint: '13 to 19', emoji: '🧑‍🎓' },
  children: { label: 'Children', hint: 'Under 13', emoji: '🧒' },
  all: { label: 'Whole Church', hint: 'Everyone in the service', emoji: '⛪' },
  firstTimers: { label: 'First-time visitors', hint: 'People here for the first time', emoji: '👋' },
  salvations: { label: 'Salvations', hint: 'People who gave their life to Christ', emoji: '✝️' },
};

/** One job's person and link, as the server keeps it (organizations/{org}/counterJobs/{job}). */
export interface CounterJobDoc {
  job: CounterJob;
  person: string;
  phone: string;
  token: string;
  active: boolean;
}

/** Who counted what on one service (organizations/{org}/serviceCounts/{eventId}); "done" once they press Finished. */
export interface ServiceCountDoc {
  eventId: string;
  date: string;
  name: string;
  by: Partial<Record<CounterJob | 'youth', { person: string; done: boolean }>>;
  emailed?: boolean;
}

export const cleanPerson = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');

/**
 * The services a counter can pick from today (6A): services already started today first, then today's services
 * in the Calendar, and on a Sunday the usual Sunday service (named as last Sunday's, so the weeks line up).
 * One entry per service record, so two names that land on the same record are shown once.
 */
export function counterServices(input: {
  today: string;
  isSunday: boolean;
  started: string[];
  calendar: { title: string; start: string | null }[];
  lastSunday: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const n = name.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!n) return;
    const id = eventIdFor(input.today, n);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(n);
  };
  input.started.forEach(add);
  // On a Sunday the usual service comes before calendar extras, unless one has already started.
  if (input.isSunday && out.length === 0) add(input.lastSunday || 'Sunday service');
  for (const c of input.calendar) add(serviceName(c.title, c.start ?? ''));
  if (input.isSunday) add(input.lastSunday || 'Sunday service');
  return out;
}

/** Every job that has a person and is switched on has pressed Finished (10A): time to email Andy. */
export function allFinished(jobs: Pick<CounterJobDoc, 'job' | 'person' | 'active'>[], by: ServiceCountDoc['by']): boolean {
  const live = jobs.filter((j) => j.active && j.person);
  return live.length > 0 && live.every((j) => by[j.job]?.done === true);
}

/** The summary lines in Andy's email, in the Sunday page's order. */
export function countLines(counts: Headcounts, by: ServiceCountDoc['by']): string[] {
  return COUNTER_JOBS.map((k) => `${COUNTER_INFO[k].label}: ${Number(counts[k]) || 0}${by[k]?.person ? ` (${by[k]!.person})` : ''}`);
}

/** The WhatsApp message that gives a counter their link. */
export function counterInvite(job: CounterJob, person: string, link: string, church: string): string {
  const first = person.split(' ')[0] || person;
  return `Hello ${first}, thank you for counting ${COUNTER_INFO[job].label} at ${church}. `
    + `Open this link on your phone at each service, then tap + for every person, or type the number:\n${link}\n`
    + 'Tip: save it to your home screen so it is always one tap away.';
}

/** "0712 345 678" or "+254712345678" → "254712345678" for wa.me; '' when it is not a phone number. */
export function waPhone(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  return d.length >= 10 ? d : '';
}
