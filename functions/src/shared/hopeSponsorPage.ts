/**
 * Hope Centre sponsorship page (Andy, 2026-11-18): well-wishers open a public link, see the children who have no
 * sponsor yet (first name, age, class stone, a short bio and a photo where the parent agreed), tick the ones they
 * want to support or "Support the Hope Centre", give their name (email, phone and country optional) and get a warm
 * thank-you with the bank details. Nothing a visitor does can change a child's details.
 * Answers: 1 Sponsorship in the Hope menu; 2A + photo; 3A; 4A (Diana, Andy or Doreen hide a child); 5A (they set the
 * amount); 6A held 60 days; 7A; 8A (boxes for the bank particulars, more than one bank); 9A; 10A (Diana, Andy or
 * Doreen mark the money received); 11A; 12A.
 * Pure functions shared by the app and the Cloud Function.
 */
import { addDays } from './metrics.js';

/** A pledged child is held this long so two people don't pick the same child (6A, 60 days). */
export const HOLD_DAYS = 60;
/** At most this many children on one form (12A). */
export const MAX_CHILDREN = 5;
export const BIO_MAX = 160;
export const MAX_BANKS = 4;

export const AMOUNT_PER = ['month', 'term', 'year'] as const;
export type AmountPer = (typeof AMOUNT_PER)[number];
export const AMOUNT_PER_LABELS: Record<AmountPer, string> = { month: 'a month', term: 'a term', year: 'a year' };

/** One bank account well-wishers can send to (8A: boxes for the particulars, more than one bank). */
export interface SponsorBank { bank: string; branch: string; accountName: string; accountNumber: string; swift: string; note: string }
export interface SponsorSettings {
  /** The suggested amount for one child, in KES (5A). Null shows no amount. */
  amount: number | null;
  per: AmountPer;
  banks: SponsorBank[];
  /** M-Pesa Paybill for givers in Kenya; the account is the pledge's reference. Empty hides it. */
  paybill: string;
}

export const DEFAULT_SETTINGS: SponsorSettings = {
  amount: null,
  per: 'month',
  banks: [{ bank: 'Family Bank', branch: 'Utawala', accountName: 'Freedom in Christ Church', accountNumber: '034000022705', swift: '', note: '' }],
  paybill: '222118',
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A whole amount of at least KES 1, or null. */
export function cleanAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '').replace(/^kes/i, '')) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 10_000_000 ? Math.round(n) : null;
}

export function cleanBank(v: unknown): SponsorBank | null {
  const b = (v ?? {}) as Record<string, unknown>;
  const out: SponsorBank = {
    bank: text(b.bank, 80), branch: text(b.branch, 80), accountName: text(b.accountName, 120),
    accountNumber: text(b.accountNumber, 40), swift: text(b.swift, 20).toUpperCase(), note: text(b.note, 160),
  };
  return out.bank || out.accountNumber ? out : null;
}

/** Settings as saved, or the defaults for anything missing. */
export function cleanSettings(v: unknown): SponsorSettings {
  const s = (v ?? {}) as Record<string, unknown>;
  const banks = Array.isArray(s.banks) ? s.banks.map(cleanBank).filter((b): b is SponsorBank => !!b).slice(0, MAX_BANKS) : DEFAULT_SETTINGS.banks;
  return {
    amount: 'amount' in s ? cleanAmount(s.amount) : DEFAULT_SETTINGS.amount,
    per: AMOUNT_PER.includes(s.per as AmountPer) ? (s.per as AmountPer) : DEFAULT_SETTINGS.per,
    banks,
    paybill: 'paybill' in s ? text(s.paybill, 12).replace(/\D/g, '') : DEFAULT_SETTINGS.paybill,
  };
}

/** "KES 3,000 a month". */
export function amountLabel(amount: number | null, per: AmountPer): string {
  return amount ? `KES ${amount.toLocaleString('en-US')} ${AMOUNT_PER_LABELS[per]}` : '';
}

/** "SP-0001". */
export const pledgeRef = (n: number) => `SP-${String(n).padStart(4, '0')}`;

/** The last day a pledge holds its children (6A). */
export const holdUntil = (date: string) => addDays(date, HOLD_DAYS);

export type PledgeState = 'waiting' | 'received' | 'cancelled';
export interface PledgeLike { state: PledgeState; childIds: string[]; holdUntil: string }

/** Children held by pledges still waiting for money and not past their 60 days. */
export function heldChildren(pledges: readonly PledgeLike[], today: string): Set<string> {
  const held = new Set<string>();
  for (const p of pledges) if (p.state === 'waiting' && p.holdUntil >= today) for (const id of p.childIds) held.add(id);
  return held;
}

/** Who appears on the page (4A): a current child with no sponsor, not hidden by Diana, Andy or Doreen. */
export function listed(c: { status: string; deletedAt?: unknown; sponsorName?: string | null }, hidden: boolean): boolean {
  return !c.deletedAt && (c.status === 'active' || c.status === 'departing') && !(c.sponsorName ?? '').trim() && !hidden;
}

export interface PledgeForm { childIds: string[]; general: boolean; name: string; email: string; phone: string; country: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The well-wisher's form, checked. Throws a message to show them. */
export function cleanPledge(v: unknown): PledgeForm {
  const d = (v ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(d.childIds) ? [...new Set(d.childIds.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x)))] : [];
  const general = d.general === true;
  if (!ids.length && !general) throw new Error('Please choose a child or the Hope Centre.');
  if (ids.length > MAX_CHILDREN) throw new Error(`Please choose up to ${MAX_CHILDREN} children at a time.`);
  const name = text(d.name, 100);
  if (name.length < 2) throw new Error('Please write your name.');
  const email = text(d.email, 120).toLowerCase();
  if (email && !EMAIL.test(email)) throw new Error('Please check your email address, or leave it empty.');
  const phone = text(d.phone, 30);
  if (phone && phone.replace(/\D/g, '').length < 7) throw new Error('Please check your phone number, or leave it empty.');
  return { childIds: ids, general, name, email, phone, country: text(d.country, 60) };
}

/** "Amani, Brian and the Hope Centre". */
export function namesList(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What the pledge is for, in words: the children's first names and/or the Hope Centre. */
export function pledgeFor(childNames: readonly string[], general: boolean): string[] {
  return [...childNames, ...(general ? ['the Hope Centre'] : [])];
}

/** The bank details as plain lines, for copying and for WhatsApp. */
export function bankLines(s: SponsorSettings, ref: string): string[] {
  const lines: string[] = [];
  for (const b of s.banks) {
    lines.push(`Bank: ${b.bank}${b.branch ? `, ${b.branch}` : ''}`);
    if (b.accountName) lines.push(`Account name: ${b.accountName}`);
    if (b.accountNumber) lines.push(`Account number: ${b.accountNumber}`);
    if (b.swift) lines.push(`SWIFT code: ${b.swift}`);
    if (b.note) lines.push(b.note);
    lines.push('');
  }
  if (s.paybill) lines.push(`M-Pesa Paybill: ${s.paybill}, Account: ${ref}`, '');
  lines.push(`Reference: ${ref}`);
  return lines;
}

/** The warm thank-you (9A), the same words on the screen, in the email and on WhatsApp. */
export function thankYouText(first: string, names: readonly string[], ref: string, s: SponsorSettings): string {
  return [
    `Dear ${first},`,
    '',
    `Thank you for your kind heart towards ${namesList(names)}. Because of people like you, the children at Freedom Hope Centre can stay in school, eat well and grow up knowing they are loved.`,
    '',
    `Please send your gift to the account below and write ${ref} as the reference, so we know it is from you.`,
    '',
    ...bankLines(s, ref),
    '',
    'With love and gratitude,',
    'Freedom Hope Centre, Freedom Church Nairobi',
  ].join('\n');
}

/** The note when the gift has arrived (10A). */
export function receivedText(first: string, names: readonly string[], ref: string): string {
  return [
    `Dear ${first},`,
    '',
    `Your gift (${ref}) for ${namesList(names)} has arrived. Thank you so much. We will send you news and a photo each term.`,
    '',
    'With love and gratitude,',
    'Freedom Hope Centre, Freedom Church Nairobi',
  ].join('\n');
}
