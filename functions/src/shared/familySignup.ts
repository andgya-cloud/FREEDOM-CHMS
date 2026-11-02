/**
 * The "Join the Freedom family" form behind a QR code (Andy, 2026-11-02, 1A-6A): a person fills in their own
 * details and their family's, and each says whether they are a Member, a Regular or not a member. People appear
 * at once on the People page as one family, marked "New sign-up · Says: Member" until Andrew or Doreen confirm.
 */
import { normalizePhone } from './phone.js';
import { tidyName } from './people.js';

export const SIGNUP_CLAIMS = ['member', 'regular', 'none'] as const;
export type SignupClaim = (typeof SIGNUP_CLAIMS)[number];
export const SIGNUP_CLAIM_LABELS: Record<SignupClaim, string> = { member: 'Member', regular: 'Regular', none: 'Not a member' };

export const SIGNUP_RELATIONS = ['spouse', 'child', 'other'] as const;
export type SignupRelation = (typeof SIGNUP_RELATIONS)[number];
export const SIGNUP_RELATION_LABELS: Record<SignupRelation, string> = { spouse: 'Husband or wife', child: 'Child', other: 'Other family member' };

/** Kept on a person until Andrew or Doreen confirm their status. */
export interface SignupMark { claimed: SignupClaim; at: string }

/** The status a new sign-up starts with: a Member claim waits as Regular, "Not a member" starts as Visitor. */
export function startingStatus(claim: SignupClaim): 'regular' | 'visitor' {
  return claim === 'none' ? 'visitor' : 'regular';
}

/** The status Confirm gives. */
export function confirmedStatus(claim: SignupClaim): 'member' | 'regular' | 'visitor' {
  return claim === 'member' ? 'member' : claim === 'regular' ? 'regular' : 'visitor';
}

export const MAX_FAMILY = 12;

export interface SignupPerson {
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: 'Male' | 'Female' | null;
  birthday: string | null;
  birthYear: number | null;
  claim: SignupClaim;
}
export interface SignupMember extends SignupPerson { relation: SignupRelation }
export interface CleanSignup {
  me: SignupPerson & { whatsapp: boolean; consent: boolean };
  family: SignupMember[];
  weddingDate: string | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function person(raw: Record<string, unknown>, label: string, phoneRequired: boolean): SignupPerson {
  const fullName = tidyName(text(raw.fullName, 120));
  if (fullName.length < 2 || !/[a-z]/i.test(fullName)) throw new Error(`Please type ${label} full name.`);
  const typed = text(raw.phone, 30);
  const phone = typed ? normalizePhone(typed) : null;
  if (typed && !phone) throw new Error(`Please check ${label} phone number, for example 0712 345 678.`);
  if (phoneRequired && !phone) throw new Error('Please type your phone number, for example 0712 345 678.');
  const email = text(raw.email, 120);
  if (email && !EMAIL.test(email)) throw new Error(`Please check ${label} email address.`);
  const birthday = text(raw.birthday, 5);
  const year = Number(raw.birthYear);
  const claim = SIGNUP_CLAIMS.includes(raw.claim as SignupClaim) ? (raw.claim as SignupClaim) : null;
  if (!claim) throw new Error(`Please choose Member, Regular or Not a member for ${fullName.split(' ')[0]}.`);
  return {
    fullName,
    phone,
    email: email || null,
    gender: raw.gender === 'Male' || raw.gender === 'Female' ? raw.gender : null,
    birthday: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(birthday) ? birthday : null,
    birthYear: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    claim,
  };
}

/** Checks the form; throws an Error with a plain message for the person filling it in. */
export function cleanSignup(raw: unknown): CleanSignup {
  const d = (raw ?? {}) as Record<string, unknown>;
  const me = person((d.me ?? {}) as Record<string, unknown>, 'your', true);
  const whatsapp = (d.me as Record<string, unknown> | undefined)?.whatsapp !== false;
  const consent = whatsapp && (d.me as Record<string, unknown> | undefined)?.consent === true;
  const list = Array.isArray(d.family) ? d.family.slice(0, MAX_FAMILY) : [];
  const family = list.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const relation = SIGNUP_RELATIONS.includes(r.relation as SignupRelation) ? (r.relation as SignupRelation) : 'other';
    return { ...person(r, 'the family member’s', false), relation };
  });
  const wedding = text(d.weddingDate, 10);
  const weddingDate = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(wedding) && family.some((m) => m.relation === 'spouse') ? wedding : null;
  return { me: { ...me, whatsapp, consent }, family, weddingDate };
}
