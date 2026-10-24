import { normalizePhone } from './shared/phone.js';

/**
 * ADIA's petty cash stakeholders and where notices reach them (Andy, 2026-10-24). Emails and WhatsApp
 * notices go to these addresses, whatever email the person's Insight-IQ account signs in with. Kept on
 * the server only, so the numbers are never part of the app's public files.
 */
export const ADIA_CONTACTS: ReadonlyArray<{ name: string; email: string; phone: string }> = [
  { name: 'Elizabeth Mutuku', email: 'elizabethkithei@gmail.com', phone: '0711938064' },
  { name: 'Elias Omondi', email: 'omondieliaso@gmail.com', phone: '0722909664' },
  { name: "Daniel Ojwang'", email: 'danalfre9@gmail.com', phone: '0714938182' },
  { name: 'Doreen Mayaka', email: 'dorreen.guya@gmail.com', phone: '0723560852' },
  { name: 'Andrew Guya', email: 'andgya@gmail.com', phone: '0728354575' },
  { name: 'Ronald Awili', email: 'ronaldawili@gmail.com', phone: '0720806229' },
];

export const plainName = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** The built-in contacts for this kind of organization (ADIA only, so far). */
export function contactsFor(orgType: string | undefined) {
  return orgType === 'college' ? ADIA_CONTACTS.map((c) => ({ ...c, phone: normalizePhone(c.phone) ?? '' })) : [];
}

export interface Contactable { uid: string; name: string; email: string; phone: string }

/**
 * Gives each stakeholder the built-in email and number for their name, and adds the built-in contacts
 * who have no Insight-IQ account yet, so every stakeholder hears about a requisition.
 */
export function withContacts<T extends Contactable>(orgType: string | undefined, people: T[]): Contactable[] {
  const contacts = contactsFor(orgType);
  if (!contacts.length) return people;
  const byName = new Map(contacts.map((c) => [plainName(c.name), c]));
  const out: Contactable[] = people.map((p) => {
    const c = byName.get(plainName(p.name));
    return c ? { ...p, email: c.email, phone: c.phone || p.phone } : p;
  });
  const have = new Set(out.map((p) => plainName(p.name)));
  for (const c of contacts) if (!have.has(plainName(c.name))) out.push({ uid: `contact-${plainName(c.name)}`, name: c.name, email: c.email, phone: c.phone });
  return out;
}
