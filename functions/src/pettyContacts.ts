import { normalizePhone } from './shared/phone.js';

/**
 * Each organization's petty cash stakeholders and where notices reach them (Andy, 2026-10-24). Emails and WhatsApp
 * notices go to these addresses, whatever email the person's Insight-IQ account signs in with. Kept on
 * the server only, so the numbers are never part of the app's public files.
 */
export const ADIA_CONTACTS: ReadonlyArray<{ name: string; email: string; phone: string; aliases?: string[]; requestsOnly?: boolean }> = [
  { name: 'Elizabeth Mutuku', email: 'elizabethkithei@gmail.com', phone: '0711938064' },
  { name: 'Elias Omondi', email: 'omondieliaso@gmail.com', phone: '0722909664' },
  { name: "Daniel Ojwang'", email: 'danalfre9@gmail.com', phone: '0714938182' },
  { name: 'Doreen Mayaka', email: 'dorreen.guya@gmail.com', phone: '0723560852', aliases: ['Doreen Guya'] },
  { name: 'Andrew Guya', email: 'andgya@gmail.com', phone: '0728354575' },
  { name: 'Ronald Awili', email: 'ronaldawili@gmail.com', phone: '0720806229' },
];

/** Freedom Church's and Freedom Hope Center's stakeholders (Andy, 2026-10-30): the same five as ADIA, without Elizabeth. */
const FREEDOM_CONTACTS = ADIA_CONTACTS.filter((c) => c.name !== 'Elizabeth Mutuku');
/** Diana Kiunga raises requests at Freedom Hope Center but does not sign (Andy, 2026-10-30). */
const HOPE_CONTACTS = [...FREEDOM_CONTACTS, { name: 'Diana Kiunga', email: 'diana.kiunga@gmail.com', phone: '0742060412', requestsOnly: true }];
const EVERYONE = [...ADIA_CONTACTS, ...HOPE_CONTACTS.slice(FREEDOM_CONTACTS.length)];

export const plainName = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** One key per person, so "Doreen Guya" and "Doreen Mayaka" are the same stakeholder. */
export function personKey(name: string) {
  const n = plainName(name);
  const c = EVERYONE.find((x) => [x.name, ...(x.aliases ?? [])].some((a) => plainName(a) === n));
  return c ? plainName(c.name) : n;
}

/** The built-in email for this person's name, if any. */
export const contactEmail = (name: string) => EVERYONE.find((c) => plainName(c.name) === personKey(name))?.email ?? '';

/**
 * The Director (Andrew Guya, the pastor account) is greyed out for others and signs from his own account
 * with no password. Other people who manage accounts are not the Director.
 */
export function isDirector(profile: { displayName?: string; pettyTitle?: string; permissions?: string[] } | undefined) {
  if (!(profile?.permissions ?? []).includes('users.manage')) return false;
  return personKey(profile?.displayName ?? '') === 'andrewguya';
}

/** The built-in contacts for this kind of organization. */
export function contactsFor(orgType: string | undefined) {
  const list = orgType === 'college' ? ADIA_CONTACTS : orgType === 'ministry' ? HOPE_CONTACTS : orgType === 'church_campus' ? FREEDOM_CONTACTS : [];
  return list.map((c) => ({ ...c, phone: normalizePhone(c.phone) ?? '' }));
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
  const key = (name: string) => personKey(name);
  const out: Contactable[] = people.map((p) => {
    const c = byName.get(key(p.name));
    return c ? { ...p, email: c.email, phone: c.phone || p.phone } : p;
  });
  const have = new Set(out.map((p) => key(p.name)));
  for (const c of contacts) if (!c.requestsOnly && !have.has(plainName(c.name))) out.push({ uid: `contact-${plainName(c.name)}`, name: c.name, email: c.email, phone: c.phone });
  return out;
}
