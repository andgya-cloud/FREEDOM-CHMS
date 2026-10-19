import { zonedParts } from './datetime.js';

/**
 * WhatsApp Cloud API automation: which messages may be sent by themselves, what Meta's approved
 * templates look like, when it is polite to send, and how delivery updates and "stop" replies are read.
 * Pure functions, shared by the app and the Cloud Functions. Secrets (the access token) never appear here.
 */

export const SEND_MODES = ['off', 'approve', 'auto'] as const;
export type SendMode = (typeof SEND_MODES)[number];
export const SEND_MODE_LABELS: Record<SendMode, string> = {
  off: 'Off (staff tap Send in WhatsApp)',
  approve: 'Staff approve each message first',
  auto: 'Send by itself',
};

/**
 * Meta only lets a business start a conversation with a template it has approved, with {{1}}, {{2}} slots.
 * Each message type below says what to paste into Meta, and which merge fields fill the slots in order.
 * Salvation and baptism messages are never automatic (they reveal belief and stay with the pastoral team),
 * and fee reminders stay tap-to-send because a person should check the amount first.
 */
export interface AutoTemplate {
  id: string;
  label: string;
  /** Meta template name (lowercase letters, digits and underscores). Changeable in Settings. */
  metaName: string;
  category: 'UTILITY' | 'MARKETING';
  body: string;
  fields: string[];
  example: string[];
}

export const AUTO_TEMPLATES: AutoTemplate[] = [
  {
    id: 'visitor_welcome', label: 'First-time visitor welcome', metaName: 'visitor_welcome', category: 'UTILITY',
    body: 'Hi {{1}}, thank you for worshipping with us at {{2}}! It was a joy to have you. If there is anything we can pray with you about, just reply to this message. God bless you. {{3}}',
    fields: ['first_name', 'campus', 'staff_name'], example: ['Grace', 'Freedom Church Nairobi', 'Pastor Andy'],
  },
  {
    id: 'checkin_48h', label: '48-hour check-in', metaName: 'visitor_checkin', category: 'UTILITY',
    body: "Hi {{1}}, it's {{2}} from {{3}}. Just checking in after your visit. How are you doing? We would love to see you again on {{4}}.",
    fields: ['first_name', 'staff_name', 'campus', 'service_time'], example: ['Grace', 'Pastor Andy', 'Freedom Church Nairobi', 'Sunday 10:00'],
  },
  {
    id: 'care_absent', label: 'Care message after 3 weeks absent', metaName: 'care_message', category: 'UTILITY',
    body: "Hi {{1}}, it's {{2}} from {{3}}. We have missed you these last few weeks and wanted to check that you are well. Is there anything we can pray with you about?",
    fields: ['first_name', 'staff_name', 'campus'], example: ['Grace', 'Pastor Andy', 'Freedom Church Nairobi'],
  },
  {
    id: 'child_absent', label: 'Child missed sessions (to the guardian)', metaName: 'child_absence_check', category: 'UTILITY',
    body: 'Hello {{1}}, this is {{2}} from {{3}}. We have missed {{4}} at our sessions these last few weeks and wanted to check that all is well. Is there anything we can help with? God bless you.',
    fields: ['first_name', 'staff_name', 'campus', 'child_name'], example: ['Mary', 'Pastor Andy', 'Freedom Hope Center', 'Baraka'],
  },
];

export const autoTemplate = (id: string) => AUTO_TEMPLATES.find((t) => t.id === id);

export interface WhatsAppSettings {
  /** Master switch. Nothing is sent while it is off, whatever the modes say. */
  enabled: boolean;
  /** The WhatsApp Business phone number's id from Meta (not a secret, and not the phone number itself). */
  phoneNumberId: string;
  modes: Record<string, SendMode>;
  /** Meta template name and language per message type, if they differ from the suggestions. */
  metaNames: Record<string, string>;
  language: string;
}

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = { enabled: false, phoneNumberId: '', modes: {}, metaNames: {}, language: 'en' };

export function withWhatsAppDefaults(saved: Partial<WhatsAppSettings> | null | undefined): WhatsAppSettings {
  return {
    enabled: saved?.enabled === true,
    phoneNumberId: typeof saved?.phoneNumberId === 'string' ? saved.phoneNumberId.trim() : '',
    modes: saved?.modes ?? {},
    metaNames: saved?.metaNames ?? {},
    language: saved?.language || 'en',
  };
}

export const modeFor = (s: WhatsAppSettings, templateId: string): SendMode => {
  const m = s.modes[templateId];
  return autoTemplate(templateId) && (m === 'approve' || m === 'auto') ? m : 'off';
};
export const metaNameFor = (s: WhatsAppSettings, templateId: string): string => s.metaNames[templateId]?.trim() || autoTemplate(templateId)?.metaName || '';

/** True when sending is switched on and the number is set up. */
export const sendingReady = (s: WhatsAppSettings) => s.enabled && s.phoneNumberId.length >= 5;

// ---- When to send ---------------------------------------------------------------------------

/** Messages go out between 08:00 and 20:00 local time only. */
export const QUIET_START_HOUR = 8;
export const QUIET_END_HOUR = 20;
export function isSendingHour(now: Date, timeZone: string): boolean {
  const h = zonedParts(now, timeZone).hour;
  return h >= QUIET_START_HOUR && h < QUIET_END_HOUR;
}

/** The 48-hour check-in waits until the morning of its due day; everything else is ready as soon as the task exists. */
export function readyToSend(templateId: string, dueAt: Date | null, now: Date): boolean {
  if (templateId === 'checkin_48h' && dueAt) return now.getTime() >= dueAt.getTime() - 14 * 3_600_000;
  return true;
}

// ---- What is sent ---------------------------------------------------------------------------

const FALLBACKS: Record<string, string> = { staff_name: 'the team', service_time: 'Sunday', child_name: 'your child', campus: 'our church' };

/** Meta refuses empty slots, newlines, tabs and runs of spaces inside a slot. */
export function cleanParam(value: string | null | undefined, field: string): string {
  const text = (value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120);
  return text || FALLBACKS[field] || '-';
}

export function buildParams(templateId: string, fields: Record<string, string | null | undefined>): string[] {
  const t = autoTemplate(templateId);
  return t ? t.fields.map((f) => cleanParam(fields[f], f)) : [];
}

/** The message as the person will read it, for the log and the approval screen. */
export function previewText(templateId: string, params: readonly string[]): string {
  const t = autoTemplate(templateId);
  return t ? t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '') : '';
}

export function sendPayload(toE164: string, metaName: string, language: string, params: readonly string[]) {
  return {
    messaging_product: 'whatsapp',
    to: toE164.replace(/\D/g, ''),
    type: 'template',
    template: { name: metaName, language: { code: language }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
  };
}

// ---- Delivery and replies -------------------------------------------------------------------

export const OUTBOX_STATUSES = ['pending_approval', 'queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
export const OUTBOX_LABELS: Record<OutboxStatus, string> = {
  pending_approval: 'Waiting for your approval', queued: 'Sending…', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not delivered', cancelled: 'Cancelled',
};

const RANK: Record<string, number> = { queued: 1, sent: 2, delivered: 3, read: 4 };
/** Meta's updates can arrive out of order: a delivery never moves a message back from "read". A failure always shows. */
export function nextStatus(current: OutboxStatus, incoming: 'sent' | 'delivered' | 'read' | 'failed'): OutboxStatus {
  if (incoming === 'failed') return current === 'delivered' || current === 'read' ? current : 'failed';
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

/** "Stop" in the few ways people write it, in English and Swahili. A whole message that is just the keyword. */
const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout', 'acha', 'komesha', 'simama'];
export function isStopMessage(text: string | null | undefined): boolean {
  const t = (text ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return STOP_WORDS.includes(t);
}

/** Digits only, the way Meta writes numbers. Used as a lookup key for who a number belongs to. */
export const digitsOf = (e164: string) => e164.replace(/\D/g, '');

/** Meta's error codes for "this number cannot receive WhatsApp" or "the person has not opted in / blocked us". */
export function failureHint(code: number | null | undefined): string {
  if (code === 131026) return 'This number is not on WhatsApp.';
  if (code === 131047) return 'More than 24 hours since they last wrote, and no approved template matched.';
  if (code === 132001 || code === 132000) return 'Meta has not approved this message template yet, or its name or language is wrong in Settings.';
  if (code === 190) return 'The access token has expired or is wrong.';
  if (code === 131056 || code === 130429) return 'Sending too fast. It will be tried again.';
  return 'Meta could not deliver this message.';
}
