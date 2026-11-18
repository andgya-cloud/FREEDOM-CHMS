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
  /** The Hope Centre's needs a giver can tick under "Support the Hope Centre" (Andy, 2026-11-18, 1A). */
  needs: SponsorNeed[];
  /** How to bring items in kind (3A). */
  dropOff: string;
}

/**
 * The needs list (Andy, 2026-11-18: "a list of almost all the needs of children", answers 1A-10A): grouped, each with
 * a typical cost (2A), a "how many" box for things you count (4A) and up to three stars for "Most needed now" (5A).
 * Diana, Andy or Doreen add, remove or rename items in Sponsorship (1A).
 */
export const NEED_GROUPS = [
  { id: 'food', icon: '🍲', label: 'Food and nutrition' },
  { id: 'school', icon: '📚', label: 'School' },
  { id: 'clothing', icon: '👕', label: 'Clothing' },
  { id: 'health', icon: '🩺', label: 'Health' },
  { id: 'hygiene', icon: '🧼', label: 'Hygiene and dignity' },
  { id: 'home', icon: '🛏️', label: 'Home and sleep' },
  { id: 'talents', icon: '⚽', label: 'Talents and growth' },
  { id: 'faith', icon: '📖', label: 'Faith and learning' },
  { id: 'centre', icon: '🏠', label: 'The centre' },
  { id: 'celebrations', icon: '🎁', label: 'Celebrations' },
] as const;
export type NeedGroup = (typeof NEED_GROUPS)[number]['id'];
export interface SponsorNeed {
  id: string; group: NeedGroup; label: string;
  /** Typical cost in KES (2A), null shows none. */
  cost: number | null;
  /** What the cost is for, like "a pair" or "a month". */
  per: string;
  /** Things you count, like shoes or mattresses, get a "how many" box (4A). */
  count: boolean;
  /** "Most needed now" (5A), at most three. */
  star: boolean;
}
export const MAX_NEEDS = 80;
export const MAX_STARS = 3;
export const MAX_QTY = 500;
export const OTHER_MAX = 200;
/** The giver's own "Where most needed" gift (9A) has this id; it is always first and never removed. */
export const MOST_NEEDED = 'most-needed';

const N = (id: string, group: NeedGroup, label: string, cost: number | null, per: string, count = false): SponsorNeed => ({ id, group, label, cost, per, count, star: false });
export const DEFAULT_NEEDS: SponsorNeed[] = [
  N('saturday-meals', 'food', 'Saturday meals for all the children', 15000, 'a Saturday'),
  N('porridge', 'food', 'Breakfast porridge', 3000, 'a month'),
  N('fruit-milk', 'food', 'Fruit and milk', 5000, 'a month'),
  N('food-basket', 'food', 'Food basket for a family in need', 3500, 'a basket', true),
  N('school-fees', 'school', 'School fees', 5000, 'a child, a term', true),
  N('exam-fees', 'school', 'Exam fees', 1500, 'a child', true),
  N('uniform', 'school', 'School uniform', 2500, 'a set', true),
  N('school-shoes', 'school', 'School shoes', 1500, 'a pair', true),
  N('school-bag', 'school', 'School bag', 1200, 'a bag', true),
  N('books-stationery', 'school', 'Books and stationery', 1500, 'a child', true),
  N('school-sweater', 'school', 'School sweater', 1200, 'a sweater', true),
  N('clothes', 'clothing', 'Everyday clothes', 1500, 'a set', true),
  N('shoes', 'clothing', 'Everyday shoes', 1200, 'a pair', true),
  N('socks-underwear', 'clothing', 'Socks and underwear', 600, 'a pack', true),
  N('jacket', 'clothing', 'Warm jacket', 1500, 'a jacket', true),
  N('clinic-fund', 'health', 'Clinic and medicine fund', 5000, 'a month'),
  N('health-cover', 'health', 'Health cover (SHA)', 500, 'a child, a month', true),
  N('glasses', 'health', 'Eye test and glasses', 3000, 'a child', true),
  N('deworming', 'health', 'Deworming and vitamins', 200, 'a child', true),
  N('first-aid', 'health', 'First aid kit for the centre', 3500, 'a kit', true),
  N('pads', 'hygiene', 'Sanitary pads for girls', 150, 'a pack', true),
  N('toiletries', 'hygiene', 'Soap, toothpaste and lotion', 500, 'a child', true),
  N('towels', 'hygiene', 'Towels', 600, 'a towel', true),
  N('mattress', 'home', 'Mattress', 4500, 'a mattress', true),
  N('blanket', 'home', 'Blanket', 1200, 'a blanket', true),
  N('mosquito-net', 'home', 'Mosquito net', 800, 'a net', true),
  N('solar-lamp', 'home', 'Solar lamp for homework', 1500, 'a lamp', true),
  N('sports', 'talents', 'Sports kits and balls', 3000, 'a kit', true),
  N('music', 'talents', 'Music instruments', null, ''),
  N('art', 'talents', 'Art supplies', 2000, 'a set', true),
  N('camp', 'talents', 'Holiday camp or trip', 2500, 'a child', true),
  N('mentorship', 'talents', 'Mentorship programme', null, ''),
  N('bibles', 'faith', 'Bibles and storybooks', 800, 'a book', true),
  N('reading-corner', 'faith', 'Reading corner', null, ''),
  N('computer', 'faith', 'Computer lessons', 2000, 'a child, a term', true),
  N('furniture', 'centre', 'Chairs and tables', 2500, 'a chair', true),
  N('water-tank', 'centre', 'Water tank', 25000, 'a tank', true),
  N('kitchen', 'centre', 'Cooking gas and utensils', 4000, 'a month'),
  N('staff-support', 'centre', 'Staff and volunteer support', null, ''),
  N('christmas', 'celebrations', 'Christmas gifts', 1000, 'a child', true),
  N('birthday', 'celebrations', 'Birthday treats', 500, 'a child', true),
];
export const DEFAULT_DROP_OFF = 'Please call the Hope Centre on 0794 645 455 to agree a day, then bring the items to Freedom Church Nairobi. Saturdays are best, when the children are there.';

export const DEFAULT_SETTINGS: SponsorSettings = {
  amount: null,
  per: 'month',
  banks: [{ bank: 'Family Bank', branch: 'Utawala', accountName: 'Freedom in Christ Church', accountNumber: '034000022705', swift: '', note: '' }],
  paybill: '222118',
  needs: DEFAULT_NEEDS,
  dropOff: DEFAULT_DROP_OFF,
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

const GROUP_IDS = new Set<string>(NEED_GROUPS.map((g) => g.id));
/** One need as saved, or null. The id is kept so old pledges still match it. */
export function cleanNeed(v: unknown): SponsorNeed | null {
  const n = (v ?? {}) as Record<string, unknown>;
  const label = text(n.label, 80);
  if (!label) return null;
  const id = typeof n.id === 'string' && /^[a-z0-9-]{1,40}$/.test(n.id) && n.id !== MOST_NEEDED ? n.id : needId(label);
  return { id, group: GROUP_IDS.has(n.group as string) ? (n.group as NeedGroup) : 'centre', label, cost: cleanAmount(n.cost), per: text(n.per, 30), count: n.count === true, star: n.star === true };
}
/** "School shoes" → "school-shoes" (a new item's id). */
export const needId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item';

/** The list as saved: no repeated ids, at most three stars (5A). */
export function cleanNeeds(v: unknown): SponsorNeed[] {
  if (!Array.isArray(v)) return DEFAULT_NEEDS;
  const out: SponsorNeed[] = [];
  const ids = new Set<string>();
  let stars = 0;
  for (const raw of v) {
    const n = cleanNeed(raw);
    if (!n || out.length >= MAX_NEEDS) continue;
    let id = n.id, i = 2;
    while (ids.has(id)) id = `${n.id}-${i++}`;
    ids.add(id);
    const star = n.star && stars < MAX_STARS;
    if (star) stars++;
    out.push({ ...n, id, star });
  }
  return out;
}

/** "about KES 1,500 a pair". */
export function needCost(n: Pick<SponsorNeed, 'cost' | 'per'>): string {
  return n.cost ? `about KES ${n.cost.toLocaleString('en-US')}${n.per ? ` ${n.per}` : ''}` : '';
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
    needs: cleanNeeds(s.needs),
    dropOff: 'dropOff' in s ? text(s.dropOff, 400) : DEFAULT_DROP_OFF,
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

export type PledgeState = 'waiting' | 'received' | 'cancelled' | 'deleted';
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

/** One need a giver ticked, as it was on the day (the label and cost are copied so later edits don't change it). */
export interface PledgedNeed { id: string; label: string; qty: number | null; cost: number | null }
export const GIVE_BY = ['money', 'items'] as const;
export type GiveBy = (typeof GIVE_BY)[number];
export const OFTEN = ['once', 'monthly'] as const;
export type Often = (typeof OFTEN)[number];
/** The Hope Centre part of a pledge: what they ticked, "Others", "Where most needed", and money or items (3A, 9A). */
export interface CentreGift {
  needs: PledgedNeed[]; other: string; giveBy: GiveBy;
  /** "Where most needed" (9A): any amount, once or every month. Money only. */
  mostNeeded: { amount: number | null; often: Often } | null;
}
export interface PledgeForm { childIds: string[]; general: boolean; name: string; email: string; phone: string; country: string; gift: CentreGift | null }

/** The giver's Hope Centre choices, checked against today's list. Throws a message to show them. */
export function cleanGift(v: unknown, list: readonly SponsorNeed[]): CentreGift {
  const g = (v ?? {}) as Record<string, unknown>;
  const giveBy: GiveBy = g.giveBy === 'items' ? 'items' : 'money';
  const byId = new Map(list.map((n) => [n.id, n]));
  const needs: PledgedNeed[] = [];
  for (const raw of Array.isArray(g.needs) ? g.needs.slice(0, MAX_NEEDS) : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = byId.get(String(r.id ?? ''));
    if (!n || needs.some((x) => x.id === n.id)) continue;
    const q = Math.round(Number(r.qty));
    needs.push({ id: n.id, label: n.label, qty: n.count ? (Number.isFinite(q) && q >= 1 ? Math.min(q, MAX_QTY) : 1) : null, cost: n.cost });
  }
  const other = text(g.other, OTHER_MAX);
  const m = (g.mostNeeded ?? null) as Record<string, unknown> | null;
  const mostNeeded = giveBy === 'money' && m && typeof m === 'object' ? { amount: cleanAmount(m.amount), often: (m.often === 'monthly' ? 'monthly' : 'once') as Often } : null;
  if (!needs.length && !other && !mostNeeded) throw new Error('Please tick what you would like to give for the Hope Centre.');
  return { needs, other, giveBy, mostNeeded };
}

/** "School shoes × 2". */
export const needText = (n: Pick<PledgedNeed, 'label' | 'qty'>) => (n.qty && n.qty > 1 ? `${n.label} × ${n.qty}` : n.label);

/** Everything the giver chose for the Hope Centre, as short lines. */
export function giftLines(g: CentreGift | null | undefined): string[] {
  if (!g) return [];
  const out: string[] = [];
  if (g.mostNeeded) out.push(`Where most needed${g.mostNeeded.amount ? `: KES ${g.mostNeeded.amount.toLocaleString('en-US')}` : ''}${g.mostNeeded.often === 'monthly' ? ' every month' : ''}`);
  for (const n of g.needs) out.push(needText(n));
  if (g.other) out.push(`Other: ${g.other}`);
  return out;
}

/** A rough total of the typical costs, for the giver's guidance only. */
export function giftEstimate(g: CentreGift | null | undefined): number {
  if (!g) return 0;
  return g.needs.reduce((t, n) => t + (n.cost ?? 0) * (n.qty ?? 1), 0) + (g.mostNeeded?.amount ?? 0);
}

/** What the sponsor promises before sending (Andy, 2026-11-18, 2A), and the consent for their own details (3A). */
export const SAFETY_PROMISE = 'I will contact the child only through Freedom Hope Centre, and I will not share the child\u2019s photo or details online.';
export const DATA_CONSENT = 'I agree that Freedom Hope Centre keeps my details to thank me and send me updates.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The well-wisher's form, checked. Throws a message to show them. */
export function cleanPledge(v: unknown, needs: readonly SponsorNeed[] = DEFAULT_NEEDS): PledgeForm {
  const d = (v ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(d.childIds) ? [...new Set(d.childIds.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x)))] : [];
  const general = d.general === true;
  if (!ids.length && !general) throw new Error('Please choose a child or the Hope Centre.');
  if (ids.length > MAX_CHILDREN) throw new Error(`Please choose up to ${MAX_CHILDREN} children at a time.`);
  if (ids.length && d.promise !== true) throw new Error('Please tick the promise to keep the children safe.');
  if (d.dataConsent !== true) throw new Error('Please tick that we may keep your details.');
  const name = text(d.name, 100);
  if (name.length < 2) throw new Error('Please write your name.');
  const email = text(d.email, 120).toLowerCase();
  if (email && !EMAIL.test(email)) throw new Error('Please check your email address, or leave it empty.');
  const phone = text(d.phone, 30);
  if (phone && phone.replace(/\D/g, '').length < 7) throw new Error('Please check your phone number, or leave it empty.');
  const gift = general ? cleanGift(d.gift, needs) : null;
  return { childIds: ids, general, name, email, phone, country: text(d.country, 60), gift };
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

const kidCount = (names: readonly string[]) => names.filter((n) => n !== 'the Hope Centre').length;

/** Does this pledge need the bank details? Children always do; Hope Centre items brought in kind don't (3A). */
export const needsMoney = (childCount: number, gift: CentreGift | null | undefined) => childCount > 0 || !gift || gift.giveBy === 'money';

/** The warm thank-you (9A), the same words on the screen, in the email and on WhatsApp. */
export function thankYouText(first: string, names: readonly string[], ref: string, s: SponsorSettings, childCount = kidCount(names), gift: CentreGift | null = null): string {
  const lines = giftLines(gift);
  const money = needsMoney(childCount, gift);
  const items = gift?.giveBy === 'items';
  return [
    `Dear ${first},`,
    '',
    `Thank you for your kind heart towards ${namesList(names)}. Because of people like you, the children at Freedom Hope Centre can stay in school, eat well and grow up knowing they are loved.`,
    ...(lines.length ? ['', `For the Hope Centre you chose${items ? ' to bring' : ''}:`, ...lines.map((l) => `• ${l}`)] : []),
    ...(money ? ['', `Please send your gift${items ? ' for the children' : ''} to the account below and write ${ref} as the reference, so we know it is from you.`, '', ...bankLines(s, ref)] : []),
    ...(items ? ['', `Bringing the items: ${s.dropOff || DEFAULT_DROP_OFF} Please mention ${ref}.`] : []),
    '',
    'With love and gratitude,',
    'Freedom Hope Centre, Freedom Church Nairobi',
  ].join('\n');
}

/** The note when the gift has arrived (10A); for the Hope Centre, "Your gift has reached the children" (8A). */
export function receivedText(first: string, names: readonly string[], ref: string, childCount = kidCount(names), gift: CentreGift | null = null, photo = false): string {
  const lines = giftLines(gift);
  return [
    `Dear ${first},`,
    '',
    childCount
      ? `Your gift (${ref}) for ${namesList(names)} has arrived. Thank you so much. We will send you news and a photo each term.`
      : `Your gift (${ref}) has reached the children at Freedom Hope Centre. Thank you so much.`,
    ...(lines.length ? ['', ...lines.map((l) => `• ${l}`)] : []),
    ...(photo ? ['', 'We have attached a photo of your gift.'] : []),
    '',
    'With love and gratitude,',
    'Freedom Hope Centre, Freedom Church Nairobi',
  ].join('\n');
}

/** The term update email (4A); the child's Sponsor update PDF is attached. */
export function updateText(first: string, names: readonly string[]): string {
  return [
    `Dear ${first},`,
    '',
    `Here is the latest news of ${namesList(names)} from Freedom Hope Centre, with a photo and how the term has gone. Thank you for walking with ${names.length > 1 ? 'them' : names[0] ?? 'them'}.`,
    '',
    'To keep the children safe, please keep this update private and contact them only through the Hope Centre.',
    '',
    'With love and gratitude,',
    'Freedom Hope Centre, Freedom Church Nairobi · 0794 645 455',
  ].join('\n');
}
