/**
 * The "Join the Freedom family" form behind a QR code.
 * - 2026-11-02 (1A-6A): a person fills in their own details and their family's, and each says whether they are a
 *   Member, a Regular or not a member.
 * - 2026-11-02 later (1A-7A): every form now waits in "Approve sign-ups" until Andrew or Doreen approve it (for
 *   people already in the system they see what changes); the form asks marital status, age range (worked out from
 *   the birthday), born again, baptised, how long at Freedom, where they stay, the wedding date, and a few optional
 *   growth questions. Children 0–12 give only name, gender and birthday.
 */
import { normalizePhone } from './phone.js';
import { HOW_HEARD_OPTIONS, tidyName, type PersonStatus } from './people.js';

export const SIGNUP_CLAIMS = ['member', 'regular', 'none'] as const;
export type SignupClaim = (typeof SIGNUP_CLAIMS)[number];
export const SIGNUP_CLAIM_LABELS: Record<SignupClaim, string> = { member: 'Member', regular: 'Regular', none: 'Not a member' };

export const SIGNUP_RELATIONS = ['spouse', 'child', 'other'] as const;
export type SignupRelation = (typeof SIGNUP_RELATIONS)[number];
export const SIGNUP_RELATION_LABELS: Record<SignupRelation, string> = { spouse: 'Husband or wife', child: 'Child', other: 'Other family member' };

export const MARITAL_STATUSES = ['married', 'single', 'single_parent', 'widowed'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_LABELS: Record<MaritalStatus, string> = { married: 'Married', single: 'Single', single_parent: 'Single parent', widowed: 'Widowed' };

export const AGE_RANGES = ['child', 'teen', 'young_adult', 'adult', 'middle', 'senior'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];
export const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  child: 'Children (0–12)',
  teen: 'Youth / Teen (13–17)',
  young_adult: 'Young Adult (18–25)',
  adult: 'Young Professionals / Adults (26–39)',
  middle: 'Middle-Aged Adults (40–59)',
  senior: 'Seniors (60+)',
};

export const FREEDOM_SINCE = ['lt6m', '6to12m', '1to2y', '3to5y', 'gt5y'] as const;
export type FreedomSince = (typeof FREEDOM_SINCE)[number];
export const FREEDOM_SINCE_LABELS: Record<FreedomSince, string> = {
  lt6m: 'Less than 6 months', '6to12m': '6–12 months', '1to2y': '1–2 years', '3to5y': '3–5 years', gt5y: 'More than 5 years',
};

export const WORK_STATUSES = ['student', 'employed', 'self_employed', 'looking', 'retired'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_LABELS: Record<WorkStatus, string> = { student: 'Student', employed: 'Employed', self_employed: 'Self-employed', looking: 'Looking for work', retired: 'Retired' };

/** What the form adds about a person, kept on the person as `about`. Any answer may be missing. */
export interface PersonAbout {
  maritalStatus: MaritalStatus | null;
  ageRange: AgeRange | null;
  bornAgain: boolean | null;
  baptised: boolean | null;
  /** Do you tithe? (Andy, 2026-11-02). Shown only to staff who may see giving. */
  tithes: boolean | null;
  freedomSince: FreedomSince | null;
  area: string | null;
  work: WorkStatus | null;
  homeGroup: boolean | null;
  ministry: string | null;
}
export const ABOUT_KEYS = ['maritalStatus', 'ageRange', 'bornAgain', 'baptised', 'tithes', 'freedomSince', 'area', 'work', 'homeGroup', 'ministry'] as const;
export const EMPTY_ABOUT: PersonAbout = { maritalStatus: null, ageRange: null, bornAgain: null, baptised: null, tithes: null, freedomSince: null, area: null, work: null, homeGroup: null, ministry: null };

/** Kept on a person from the earlier form, until Andrew or Doreen confirm their status. */
export interface SignupMark { claimed: SignupClaim; at: string }

/** The status a claim gives once approved. */
export function confirmedStatus(claim: SignupClaim): 'member' | 'regular' | 'visitor' {
  return claim === 'member' ? 'member' : claim === 'regular' ? 'regular' : 'visitor';
}
/** Kept for older callers: the earlier form's starting status. */
export function startingStatus(claim: SignupClaim): 'regular' | 'visitor' {
  return claim === 'none' ? 'visitor' : 'regular';
}

/** Age today from the year (and, if known, the "MM-DD" birthday). */
export function ageOn(birthYear: number | null, birthday: string | null, todayKey: string): number | null {
  if (!birthYear) return null;
  const [y, m, d] = todayKey.split('-');
  let age = Number(y) - birthYear;
  if (birthday && birthday > `${m}-${d}`) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
export function ageRangeFor(age: number): AgeRange {
  return age <= 12 ? 'child' : age <= 17 ? 'teen' : age <= 25 ? 'young_adult' : age <= 39 ? 'adult' : age <= 59 ? 'middle' : 'senior';
}

export const MAX_FAMILY = 12;

export interface SignupPerson {
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: 'Male' | 'Female' | null;
  birthday: string | null;
  birthYear: number | null;
  /** Null for children 0–12, who are not asked. */
  claim: SignupClaim | null;
  about: PersonAbout;
}
export interface SignupMember extends SignupPerson { relation: SignupRelation }
export interface SignupMe extends SignupPerson { whatsapp: boolean; consent: boolean; howHeard: string | null; serviceAttended: string | null }
export interface CleanSignup {
  me: SignupMe;
  family: SignupMember[];
  weddingDate: string | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => (list.includes(v as T) ? (v as T) : null);
const yesNo = (v: unknown): boolean | null => (v === true || v === false ? v : null);

function person(raw: Record<string, unknown>, opts: { self: boolean; relation: SignupRelation | null; todayKey: string }): SignupPerson {
  const fullName = tidyName(text(raw.fullName, 120));
  const label = opts.self ? 'your' : 'the family member’s';
  if (fullName.length < 2 || !/[a-z]/i.test(fullName)) throw new Error(`Please type ${label} full name.`);
  const first = fullName.split(' ')[0];
  const who = opts.self ? 'yourself' : first;
  const typed = text(raw.phone, 30);
  const phone = typed ? normalizePhone(typed) : null;
  if (typed && !phone) throw new Error(`Please check ${label} phone number, for example 0712 345 678.`);
  if (opts.self && !phone) throw new Error('Please type your phone number, for example 0712 345 678.');
  const email = text(raw.email, 120);
  if (email && !EMAIL.test(email)) throw new Error(`Please check ${label} email address.`);
  const gender = raw.gender === 'Male' || raw.gender === 'Female' ? raw.gender : null;
  if (!gender) throw new Error(`Please choose Male or Female for ${who}.`);
  const day = text(raw.birthday, 5);
  const birthday = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(day) ? day : null;
  const year = Number(raw.birthYear);
  const birthYear = Number.isInteger(year) && year >= 1900 && Number(opts.todayKey.slice(0, 4)) >= year ? year : null;
  const raw_about = (raw.about ?? {}) as Record<string, unknown>;
  // 4A: the birthday decides the age range; the range is asked only when the year is skipped.
  const age = ageOn(birthYear, birthday, opts.todayKey);
  const ageRange = age != null ? ageRangeFor(age) : pick(AGE_RANGES, raw_about.ageRange);
  if (!ageRange) throw new Error(`Please give the year of birth or choose an age range for ${who}.`);

  // 7A: children 0–12 give only name, gender and birthday.
  if (ageRange === 'child') {
    return { fullName, phone, email: email || null, gender, birthday, birthYear, claim: null, about: { ...EMPTY_ABOUT, ageRange } };
  }
  const claim = pick(SIGNUP_CLAIMS, raw.claim);
  if (!claim) throw new Error(`Please choose Member, Regular or Not a member for ${who}.`);
  const bornAgain = yesNo(raw_about.bornAgain);
  if (bornAgain == null) throw new Error(`Please answer “born again” for ${who}.`);
  const baptised = yesNo(raw_about.baptised);
  if (baptised == null) throw new Error(`Please answer “baptised in water” for ${who}.`);
  const tithes = yesNo(raw_about.tithes);
  if (tithes == null) throw new Error(`Please answer “Do you tithe?” for ${who}.`);
  const freedomSince = pick(FREEDOM_SINCE, raw_about.freedomSince);
  if (!freedomSince) throw new Error(`Please choose how long ${opts.self ? 'you have' : `${first} has`} been at Freedom Church.`);
  let maritalStatus = pick(MARITAL_STATUSES, raw_about.maritalStatus);
  if (opts.relation === 'spouse') maritalStatus = 'married';
  if (ageRange === 'teen') maritalStatus = null;
  if (opts.self && ageRange !== 'teen' && !maritalStatus) throw new Error('Please choose your marital status.');
  return {
    fullName, phone, email: email || null, gender, birthday, birthYear, claim,
    about: {
      maritalStatus, ageRange, bornAgain, baptised, tithes, freedomSince,
      area: text(raw_about.area, 80) || null,
      work: pick(WORK_STATUSES, raw_about.work),
      homeGroup: yesNo(raw_about.homeGroup),
      ministry: text(raw_about.ministry, 120) || null,
    },
  };
}

/** Checks the form; throws an Error with a plain message for the person filling it in. */
export function cleanSignup(raw: unknown, todayKey: string, serviceTimes: readonly string[] = []): CleanSignup {
  const d = (raw ?? {}) as Record<string, unknown>;
  const rawMe = (d.me ?? {}) as Record<string, unknown>;
  const me = person(rawMe, { self: true, relation: null, todayKey });
  const whatsapp = rawMe.whatsapp !== false;
  const consent = whatsapp && rawMe.consent === true;
  const howHeard = HOW_HEARD_OPTIONS.includes(String(rawMe.howHeard)) ? String(rawMe.howHeard) : null;
  const serviceAttended = serviceTimes.includes(String(rawMe.serviceAttended)) ? String(rawMe.serviceAttended) : null;
  const list = Array.isArray(d.family) ? d.family.slice(0, MAX_FAMILY) : [];
  const family = list.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const relation = pick(SIGNUP_RELATIONS, r.relation) ?? 'other';
    return { ...person(r, { self: false, relation, todayKey }), relation };
  });
  const wedding = text(d.weddingDate, 10);
  const married = me.about.maritalStatus === 'married' || family.some((m) => m.relation === 'spouse');
  const weddingDate = married && /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(wedding) && wedding <= todayKey ? wedding : null;
  return { me: { ...me, whatsapp, consent, howHeard, serviceAttended }, family, weddingDate };
}

/** The status someone gets on approval. Children 0–12 follow the parent who filled in the form. */
export function approvedStatus(p: SignupPerson, parentClaim: SignupClaim): PersonStatus {
  if (p.claim) return confirmedStatus(p.claim);
  return parentClaim === 'none' ? 'visitor' : 'regular';
}

/** A person's fields as they are in People, for comparing with the form. */
export interface ExistingPerson {
  fullName?: string; phone?: string | null; email?: string | null; gender?: string | null; birthday?: string | null;
  birthYear?: number | null; status?: string; about?: Partial<PersonAbout> | null; howHeard?: string | null; serviceAttended?: string | null;
}

/**
 * The fields approval writes onto someone already in People (1A "update the information"): every answer the form
 * gives replaces what is there; answers left blank keep what is there.
 */
export function updatesFor(existing: ExistingPerson, p: SignupPerson, status: PersonStatus, extra: { howHeard?: string | null; serviceAttended?: string | null } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (k: keyof ExistingPerson, v: unknown) => { if (v != null && v !== '' && existing[k] !== v) out[k] = v; };
  set('fullName', p.fullName);
  set('phone', p.phone);
  set('email', p.email);
  set('gender', p.gender);
  set('birthday', p.birthday);
  set('birthYear', p.birthYear);
  set('howHeard', extra.howHeard);
  set('serviceAttended', extra.serviceAttended);
  if (existing.status !== status) out.status = status;
  const before = { ...EMPTY_ABOUT, ...(existing.about ?? {}) };
  const after = { ...before };
  for (const k of ABOUT_KEYS) {
    const v = p.about[k];
    if (v != null) (after as Record<string, unknown>)[k] = v;
  }
  if (ABOUT_KEYS.some((k) => after[k] !== before[k])) out.about = after;
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_WORDS: Record<string, string> = { member: 'Member', regular: 'Regular', visitor: 'Visitor', inactive: 'Inactive', student: 'Student', child: 'Child' };
const yn = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : '');
const ABOUT_LABELS: Record<(typeof ABOUT_KEYS)[number], [string, (v: unknown) => string]> = {
  maritalStatus: ['Marital status', (v) => MARITAL_LABELS[v as MaritalStatus] ?? ''],
  ageRange: ['Age range', (v) => AGE_RANGE_LABELS[v as AgeRange] ?? ''],
  bornAgain: ['Born again', yn],
  baptised: ['Baptised in water', yn],
  tithes: ['Tithes', yn],
  freedomSince: ['At Freedom for', (v) => FREEDOM_SINCE_LABELS[v as FreedomSince] ?? ''],
  area: ['Where they stay', (v) => String(v ?? '')],
  work: ['Work', (v) => WORK_LABELS[v as WorkStatus] ?? ''],
  homeGroup: ['In a home group', yn],
  ministry: ['Ministry', (v) => String(v ?? '')],
};
/** "14 Feb" from "02-14". */
export function birthdayText(b: string | null | undefined): string {
  if (!b) return '';
  const [m, d] = b.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** One line per answer, in plain words, for showing a person's `about`. */
export function aboutLines(about: Partial<PersonAbout> | null | undefined): { label: string; value: string }[] {
  if (!about) return [];
  return ABOUT_KEYS.map((k) => ({ label: ABOUT_LABELS[k][0], value: ABOUT_LABELS[k][1](about[k]) })).filter((l) => l.value);
}

/** What approval will change, as rows of label / now / new, for the approval page. */
export function changeRows(existing: ExistingPerson, updates: Record<string, unknown>): { label: string; now: string; next: string }[] {
  const rows: { label: string; now: string; next: string }[] = [];
  const plain: [string, string, (v: unknown) => string][] = [
    ['fullName', 'Name', String], ['phone', 'Phone', String], ['email', 'Email', String], ['gender', 'Gender', String],
    ['birthday', 'Birthday', (v) => birthdayText(v as string)], ['birthYear', 'Year of birth', String],
    ['status', 'Status', (v) => STATUS_WORDS[String(v)] ?? String(v)], ['howHeard', 'First came through', String], ['serviceAttended', 'Usual service', String],
  ];
  for (const [k, label, f] of plain) {
    if (k in updates) {
      const now = (existing as Record<string, unknown>)[k];
      rows.push({ label, now: now == null || now === '' ? '—' : f(now), next: f(updates[k]) });
    }
  }
  const after = updates.about as PersonAbout | undefined;
  if (after) {
    const before = existing.about ?? {};
    for (const k of ABOUT_KEYS) {
      if (after[k] !== (before[k] ?? null)) rows.push({ label: ABOUT_LABELS[k][0], now: ABOUT_LABELS[k][1](before[k]) || '—', next: ABOUT_LABELS[k][1](after[k]) });
    }
  }
  return rows;
}
