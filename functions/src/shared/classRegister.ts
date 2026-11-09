import type { PlanEntry, ProgramConfig, Topic } from './programs.js';

/**
 * Freedom 252 class register (Andy, 2026-11-09, 1A-7A). The 24 topics and their class dates come from the
 * church's 2027 calendar ("Freedom 252 · Leadership Development Program · 24 weeks"). Students join any time and
 * graduate once they have covered all 24 topics, at the class itself or at a make-up class; each topic is 1/24.
 *
 * Marking is done by the students: the class leader shows a QR code that changes every minute (1A), each student
 * scans it and types their phone number, and the check-in counts towards their topics.
 */

export const F252_ID = 'freedom_252';
export const F252_GRADUATION = '2027-08-15';

const F252_CALENDAR: [string, string, string][] = [
  ['2026-11-10', 'Semester 1 · Week 1', 'The Law of The Lid'],
  ['2026-11-17', 'Semester 1 · Week 2', 'Leadership Secrets from The Life of Joseph'],
  ['2026-11-24', 'Semester 1 · Week 3', 'Clarifying Your Calling'],
  ['2026-12-01', 'Semester 1 · Week 4', 'The 5 Traits of Transformational Leadership'],
  ['2027-01-05', 'Semester 1 · Week 5', 'The Anatomy of Apprenticeship'],
  ['2027-01-19', 'Semester 1 · Week 6', 'Honor Among the Generations'],
  ['2027-01-26', 'Semester 1 · Week 7', 'Encouragers & Confronters'],
  ['2027-02-09', 'Semester 1 · Week 8', 'The Coaching Mindset'],
  ['2027-02-23', 'Semester 1 · Week 9', 'Creating a Culture of Honor'],
  ['2027-03-02', 'Semester 1 · Week 10', 'The Prodigal God: Discovering True Sonship'],
  ['2027-03-16', 'Semester 1 · Week 11', 'How to Lead Cultural Innovation'],
  ['2027-03-23', 'Semester 1 · Week 12', 'Breathing Room: Leveraging Personal Replenishment Cycles'],
  ['2027-04-06', 'Semester 2 · Week 1', 'Making Vision Stick'],
  ['2027-04-20', 'Semester 2 · Week 2', 'Sustained Enthusiasm'],
  ['2027-04-27', 'Semester 2 · Week 3', 'Emotionally Healthy Leadership'],
  ['2027-05-11', 'Semester 2 · Week 4', 'The Four Pillars of Drama'],
  ['2027-05-18', 'Semester 2 · Week 5', 'The Ideal Team Player'],
  ['2027-05-25', 'Semester 2 · Week 6', 'Navigating Team Dynamics'],
  ['2027-06-17', 'Semester 2 · Week 7', 'Discovering Your Enneagram Type'],
  ['2027-07-08', 'Semester 2 · Week 8', 'Leaders of 10: Keys to Effective Delegation'],
  ['2027-07-20', 'Semester 2 · Week 9', 'A New Definition of Character'],
  ['2027-07-27', 'Semester 2 · Week 10', 'Eat the Book: A History of The Bible'],
  ['2027-08-03', 'Semester 2 · Week 11', 'Overcoming the 7 Facets of Discouragement'],
  ['2027-08-10', 'Semester 2 · Week 12', "The Leader's Prayer Life"],
];

/** The topic ids stay topic_01..topic_24 (the ones the programme already has), so nothing recorded is lost. */
export const F252_TOPICS: Topic[] = F252_CALENDAR.map(([, , name], i) => ({ id: `topic_${String(i + 1).padStart(2, '0')}`, name }));
export const F252_PLAN: PlanEntry[] = F252_CALENDAR.map(([date, label], i) => ({ topicId: F252_TOPICS[i]!.id, date, label }));

/** What "Put in the calendar" writes on the Freedom 252 programme. */
export const F252_SETUP: ProgramConfig = {
  name: 'Freedom 252',
  description: 'Leadership Development Program, 24 weeks. Join any time; graduate by covering all 24 topics, at the class or a make-up class.',
  topics: F252_TOPICS,
  completionRule: { type: 'all_topics' },
  pipelineStageId: 'freedom_252',
  completedLabel: 'Graduated',
  schedule: 'Tuesdays 8:00pm',
  active: true,
  plan: F252_PLAN,
  classStart: '20:00',
  classEnd: '22:00',
};

/** Minutes the QR check-in opens before a planned class starts (2A). */
export const OPEN_BEFORE_MINUTES = 30;
/** The QR code changes every minute (1A); a code stays good for a few minutes so typing the number has time. */
export const QR_SLOT_SECONDS = 60;
export const QR_SLOTS_GOOD = 4;

export const slotNow = (ms = Date.now()) => Math.floor(ms / 1000 / QR_SLOT_SECONDS);

const minutesOf = (hhmm: string | undefined, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

/** "20:00" -> "8:00pm" */
export function clockLabel(hhmm: string | undefined): string {
  const mins = minutesOf(hhmm, -1);
  if (mins < 0) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** The planned class on a day, if any. */
export const plannedOn = (plan: readonly PlanEntry[] | undefined, date: string) => (plan ?? []).find((p) => p.date === date) ?? null;

/** The next planned class on or after a day. */
export const nextPlanned = (plan: readonly PlanEntry[] | undefined, date: string) =>
  [...(plan ?? [])].sort((a, b) => a.date.localeCompare(b.date)).find((p) => p.date >= date) ?? null;

/**
 * Whether scanning is open for a planned class at a local time of day (minutes since midnight):
 * from 30 minutes before the start until the class ends (2A). Make-up classes are open all that day.
 */
export function scanWindow(program: Pick<ProgramConfig, 'classStart' | 'classEnd'>): { from: number; to: number; label: string } {
  const start = minutesOf(program.classStart, 20 * 60);
  const end = Math.max(minutesOf(program.classEnd, start + 120), start + 30);
  const from = Math.max(0, start - OPEN_BEFORE_MINUTES);
  const fmt = (m: number) => clockLabel(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  return { from, to: end, label: `${fmt(from)} to ${fmt(end)}` };
}

export function isWindowOpen(program: Pick<ProgramConfig, 'classStart' | 'classEnd'>, minutesNow: number): boolean {
  const w = scanWindow(program);
  return minutesNow >= w.from && minutesNow <= w.to;
}

/** Whole percent, each topic one of `total`. */
export const percentOf = (count: number, total: number) => (total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0);

/** The public page a QR code opens. */
export const checkInPath = (orgId: string, eventId: string, code: string) => `/class/${orgId}/${eventId}?k=${code}`;
export const progressPath = (orgId: string, token: string) => `/class/${orgId}/p/${token}`;

/** Reminder texts (6A): sent by tapping, one person at a time, or once to the class WhatsApp group. */
export function reminderText(first: string, programName: string, when: string, topic: string, time: string, done: number, total: number, link: string): string {
  return `Hi ${first}, ${programName} is ${when}${time ? ` at ${time}` : ''}: "${topic}". You have done ${done} of ${total} topics (${percentOf(done, total)}%).${link ? ` Your progress: ${link}` : ''} See you there!`;
}
export function groupReminderText(programName: string, when: string, topic: string, time: string): string {
  return `${programName} is ${when}${time ? ` at ${time}` : ''}: "${topic}". Scan the code on the screen when you arrive to be marked present. See you there!`;
}
export function missedText(first: string, programName: string, when: string, topic: string, done: number, total: number, link: string): string {
  return `Hi ${first}, we missed you at ${programName} on ${when} ("${topic}"). You can catch up at a make-up class: just ask the class leader. You have done ${done} of ${total} topics (${percentOf(done, total)}%).${link ? ` Your progress: ${link}` : ''}`;
}
