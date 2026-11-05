/**
 * WhatsApp messages to parents from the Hope Centre phone (Andy, 2026-11-05, 6A 7A). Messages go from the Hope
 * phone itself: the app opens WhatsApp with the message ready, one parent at a time for a bulk message.
 */
import { normalizePhone, phoneDigits } from './phone.js';

/** The Hope Centre's WhatsApp and calls number (Andy, 2026-11-05). */
export const HOPE_PHONE = '0794 645 455';
export const HOPE_PHONE_E164 = '+254794645455';
export const HOPE_SIGN_OFF = `Freedom Hope Centre, ${HOPE_PHONE}`;

export interface MessageChild { id: string; name: string; parentName: string; parentPhone: string }
export interface Recipient {
  /** The phone, +2547…, which also keys the recipient. */
  phone: string;
  parentName: string;
  /** Brothers and sisters with the same parent get one message. */
  children: { id: string; name: string }[];
}

/** One recipient per parent phone; children without a usable phone are listed apart. */
export function recipients(children: readonly MessageChild[]): { to: Recipient[]; noPhone: { id: string; name: string }[] } {
  const by = new Map<string, Recipient>();
  const noPhone: { id: string; name: string }[] = [];
  for (const c of children) {
    const phone = normalizePhone(c.parentPhone);
    if (!phone) { noPhone.push({ id: c.id, name: c.name }); continue; }
    const r = by.get(phone) ?? { phone, parentName: c.parentName.trim(), children: [] };
    if (!r.parentName && c.parentName.trim()) r.parentName = c.parentName.trim();
    r.children.push({ id: c.id, name: c.name });
    by.set(phone, r);
  }
  return { to: [...by.values()].sort((a, b) => (a.children[0]?.name ?? '').localeCompare(b.children[0]?.name ?? '')), noPhone };
}

const first = (n: string) => n.trim().split(/\s+/)[0] ?? '';
/** "Amani and Baraka", "Amani, Baraka and Neema". */
export function namesList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Fills {parent} and {child} in a message, and adds the Hope sign-off. */
export function fillMessage(text: string, r: Pick<Recipient, 'parentName' | 'children'>): string {
  const parent = first(r.parentName) || 'Parent';
  const child = namesList(r.children.map((c) => first(c.name)));
  const body = text.replace(/\{parent\}/gi, parent).replace(/\{child\}/gi, child).trim();
  return body.includes(HOPE_PHONE) ? body : `${body}\n\n${HOPE_SIGN_OFF}`;
}

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phoneDigits(normalizePhone(phone) ?? phone)}?text=${encodeURIComponent(text)}`;
}

/** Ready messages to choose from; each can be changed before sending. */
export const MESSAGE_TEMPLATES: { id: string; label: string; text: string }[] = [
  { id: 'saturday', label: 'Saturday reminder', text: 'Hello {parent}, a reminder to bring {child} to the Hope Centre this Saturday at 8:30am. God bless you.' },
  { id: 'missed', label: 'We missed your child', text: 'Hello {parent}, we have missed {child} at the Hope Centre on the last Saturdays. Is everything well? Please let us know.' },
  { id: 'closed', label: 'No meeting this Saturday', text: 'Hello {parent}, there is no Hope Centre meeting this Saturday. We will see {child} the following Saturday.' },
  { id: 'fees', label: 'School fees', text: 'Hello {parent}, this is about {child}\'s school fees for this term. Please call or reply when you can.' },
  { id: 'hello', label: 'Write my own', text: 'Hello {parent}, ' },
];
