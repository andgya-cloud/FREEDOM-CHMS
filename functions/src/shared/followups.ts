/**
 * Follow-ups and WhatsApp messages, shared by the app and Cloud Functions:
 * why a task exists, the message templates and their merge fields, who a
 * message may go to, and when a task is overdue or escalated.
 */
import { attended, weeksAttended, type AttendanceRecord } from './attendance.js';
import { zonedMidnight } from './datetime.js';

// ---- Tasks ---------------------------------------------------------------------

export const FOLLOW_UP_REASONS = ['first_visit', 'checkin_48h', 'care_absent', 'salvation', 'baptism_invite', 'other'] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

export const FOLLOW_UP_REASON_LABELS: Record<FollowUpReason, string> = {
  first_visit: 'First visit: welcome',
  checkin_48h: 'First visit: 48-hour check-in',
  care_absent: 'Absent 3 weeks: care message',
  salvation: 'Salvation follow-up',
  baptism_invite: 'Baptism class invitation',
  other: 'Follow-up',
};

/** Salvation and baptism reveal religious belief, so only staff who may see pastoral records see these tasks. */
export const SENSITIVE_REASONS: readonly FollowUpReason[] = ['salvation', 'baptism_invite'];

export const FOLLOW_UP_OUTCOMES = ['Reached', 'Message sent, no reply yet', 'No answer', 'Wrong number', 'Asked us to stop', 'Other'] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

/** A task this many days past due goes to the pastor. */
export const ESCALATE_AFTER_DAYS = 3;
/** "Absent 3 weeks": no attendance for this many days. */
export const ABSENT_DAYS = 21;
const DAY = 86_400_000;

export function isOverdue(dueAt: Date | null | undefined, now = new Date()): boolean {
  return !!dueAt && dueAt.getTime() < now.getTime();
}

export function isEscalated(dueAt: Date | null | undefined, now = new Date()): boolean {
  return !!dueAt && now.getTime() - dueAt.getTime() >= ESCALATE_AFTER_DAYS * DAY;
}

/** 23:59 local time on the day `days` after `from`, so a task reads as "due that day". */
export function endOfLocalDay(from: Date, timeZone: string, days = 0): Date {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(from);
  const [y, m, d] = local.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days + 1));
  return new Date(zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone).getTime() - 60_000);
}

/**
 * A regular attender (3 of the 8 weeks up to their last visit) who hasn't
 * come for 3 weeks gets a care message. Returns the date of their last visit,
 * which keys the task so each absence makes one task; null when no task is due.
 * People gone longer than 8 weeks are left to the drop-off report, so
 * switching this on doesn't flood the queue with old absences.
 */
export function absenceToFollowUp(records: readonly AttendanceRecord[], now: Date, timeZone: string, regularWeeks = 3): string | null {
  const dates = records.filter((r) => !r.deletedAt && attended(r.status)).map((r) => r.date).sort();
  const last = dates[dates.length - 1];
  if (!last) return null;
  const [y, m, d] = last.split('-').map(Number) as [number, number, number];
  const lastDay = zonedMidnight(y, m, d, timeZone);
  const away = (now.getTime() - lastDay.getTime()) / DAY;
  if (away < ABSENT_DAYS || away >= 8 * 7) return null;
  return weeksAttended(records, new Date(lastDay.getTime() + DAY / 2), 8, timeZone) >= regularWeeks ? last : null;
}

// ---- Templates -----------------------------------------------------------------

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
}

export const MERGE_FIELDS: { key: string; meaning: string }[] = [
  { key: 'first_name', meaning: "the person's first name" },
  { key: 'campus', meaning: 'the campus or organization name' },
  { key: 'service_time', meaning: 'the main service time, for example Sunday 10:00' },
  { key: 'staff_name', meaning: 'your first name' },
  { key: 'child_name', meaning: "the child's first name, when writing to a parent or guardian" },
  { key: 'programme', meaning: 'the programme, for example Freedom 252' },
  { key: 'class_time', meaning: 'when the class meets, for example Tuesdays at 8pm' },
  { key: 'receipt_number', meaning: 'the receipt number' },
  { key: 'amount', meaning: 'the amount, for example KES 1,000' },
  { key: 'fund', meaning: 'the fund, for example Tithes' },
  { key: 'date', meaning: 'the date of the gift' },
  { key: 'student_name', meaning: "the student's first name, when writing to a sponsor or guardian" },
  { key: 'paybill', meaning: 'the M-Pesa Paybill number' },
  { key: 'account', meaning: 'the account to type when paying, for example ADIA#Fees' },
];

/** The starting templates. The pastor can edit them in Settings; these are used until then. */
export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'visitor_welcome',
    name: 'First-time visitor welcome',
    body: 'Hi {first_name}, thank you for worshipping with us at {campus} today! It was a joy to have you. If there is anything we can pray with you about, just reply to this message. God bless you. {staff_name}, {campus}',
  },
  {
    id: 'checkin_48h',
    name: '48-hour check-in',
    body: "Hi {first_name}, it's {staff_name} from {campus}. Just checking in after your visit. How are you doing? We would love to see you again on {service_time}.",
  },
  {
    id: 'care_absent',
    name: 'Care message after 3 weeks absent',
    body: "Hi {first_name}, it's {staff_name} from {campus}. We have missed you these last few weeks and wanted to check that you are well. Is there anything we can pray with you about?",
  },
  {
    id: 'salvation_followup',
    name: 'Salvation follow-up',
    body: "Hi {first_name}, it's {staff_name} from {campus}. We are so glad about your decision to follow Jesus! I'd love to meet up and help you take your next steps. When would suit you this week?",
  },
  {
    id: 'baptism_invite',
    name: 'Baptism class invitation',
    body: "Hi {first_name}, it's {staff_name} from {campus}. Our next baptism class is coming up and we would love you to join. Reply here and I will share the details.",
  },
  {
    id: 'program_reminder',
    name: 'Programme reminder',
    body: 'Hi {first_name}, a reminder that {programme} meets {class_time}. See you there! {staff_name}, {campus}',
  },
  {
    id: 'giving_receipt',
    name: 'Giving receipt',
    body: 'Hi {first_name}, thank you for your giving to {campus}. We received {amount} for {fund} on {date}. Receipt number {receipt_number}. God bless you.',
  },
  {
    id: 'fee_reminder',
    name: 'School fee reminder',
    body: 'Hello {first_name}, this is {staff_name} from {campus}. A gentle reminder that {student_name} has a school fee balance of {amount}. You can pay by M-Pesa Paybill {paybill}, account {account}. Thank you, and God bless you.',
  },
];

/** Which template a task's reason starts with. */
export const TEMPLATE_FOR_REASON: Record<FollowUpReason, string> = {
  first_visit: 'visitor_welcome',
  checkin_48h: 'checkin_48h',
  care_absent: 'care_absent',
  salvation: 'salvation_followup',
  baptism_invite: 'baptism_invite',
  other: 'checkin_48h',
};

/** Templates that mention salvation or baptism: messages sent with them are kept pastor-only in the log. */
export const SENSITIVE_TEMPLATES: readonly string[] = ['salvation_followup', 'baptism_invite'];

/** The saved templates, with any starting template that hasn't been saved yet. */
export function withDefaults(saved: readonly MessageTemplate[] | null | undefined): MessageTemplate[] {
  const list = [...(saved ?? [])];
  for (const t of DEFAULT_TEMPLATES) if (!list.some((s) => s.id === t.id)) list.push(t);
  return list;
}

/** Fills in {merge_fields}. A field with no value is left out, with the extra space tidied. */
export function renderTemplate(body: string, fields: Record<string, string | null | undefined>): string {
  return body
    .replace(/\{(\w+)\}/g, (whole, key: string) => (key in fields ? (fields[key] ?? '').trim() : whole))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim();
}

/** Merge fields this template uses that aren't known, so the editor can warn about typos. */
export function unknownFields(body: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].filter((k) => !known.has(k));
}

// ---- Who a message goes to ----------------------------------------------------------

export interface Contact {
  id: string;
  fullName: string;
  firstName?: string;
  status?: string;
  phone: string | null;
  whatsapp?: string | null;
  whatsappConsent?: { given: boolean; stoppedAt?: string | null } | null;
  guardianId?: string | null;
}

export type Recipient =
  | { ok: true; to: Contact; phone: string; viaGuardian: boolean }
  | { ok: false; reason: string };

const firstOf = (c: Contact) => c.firstName || c.fullName.split(' ')[0] || c.fullName;

function canMessage(c: Contact): string | null {
  if (c.whatsappConsent?.stoppedAt) return `${firstOf(c)} asked us to stop WhatsApp messages.`;
  if (!c.whatsappConsent?.given) return `${firstOf(c)} hasn't agreed to WhatsApp messages. Call instead, or record their agreement on their record.`;
  if (!(c.whatsapp || c.phone)) return `There is no WhatsApp number for ${firstOf(c)}.`;
  return null;
}

/**
 * Who a WhatsApp message about this person goes to. A child is never
 * messaged directly: the message goes to their parent or guardian, who must
 * have agreed to WhatsApp messages.
 */
export function recipientFor(person: Contact, guardian: Contact | null | undefined): Recipient {
  if (person.status === 'child') {
    if (!guardian) return { ok: false, reason: `${firstOf(person)} is a child, so messages go to a parent or guardian. Add one on their record first.` };
    const problem = canMessage(guardian);
    return problem ? { ok: false, reason: problem } : { ok: true, to: guardian, phone: (guardian.whatsapp || guardian.phone)!, viaGuardian: true };
  }
  const problem = canMessage(person);
  return problem ? { ok: false, reason: problem } : { ok: true, to: person, phone: (person.whatsapp || person.phone)!, viaGuardian: false };
}

/** A wa.me link that opens WhatsApp with the message ready to send. */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export function firstNameOf(c: Pick<Contact, 'fullName' | 'firstName'>): string {
  return c.firstName || c.fullName.split(' ')[0] || c.fullName;
}
