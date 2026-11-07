import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineSecret } from 'firebase-functions/params';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, type UserProfile } from './common.js';
import { contactsFor, hopeBoardContacts, plainName } from './pettyContacts.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { circleOf, isCircleLead, type CircleType } from './shared/circles.js';
import { classOf } from './shared/hopeClasses.js';
import { localDateKey } from './shared/datetime.js';
import { normalizePhone } from './shared/phone.js';
import { STORY_CHILDREN_MAX, type StoryChild } from './shared/hopePhotos.js';

/**
 * What the conversation functions need for each organization (Andy, 2026-11-07, 6A): the Gmail it sends from (Hope
 * freedomnbi@gmail.com, ADIA adiatrainingc@gmail.com, the church freedomchurchnairobi@gmail.com), the people who are
 * told, and the person a conversation is about (a child, a student or a member).
 */
export const HOPE_EMAIL_APP_PASSWORD = defineSecret('HOPE_EMAIL_APP_PASSWORD');
export const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
export const CHURCH_EMAIL_APP_PASSWORD = defineSecret('CHURCH_EMAIL_APP_PASSWORD');
export const CIRCLE_SECRETS = [HOPE_EMAIL_APP_PASSWORD, PETTY_EMAIL_APP_PASSWORD, CHURCH_EMAIL_APP_PASSWORD];

export const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CircleMailer { transport: Transporter; from: string; name: string; test: string | undefined }
export function circleMailer(type: CircleType): CircleMailer | null {
  const lh = letterheadFor({ type, name: '' });
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const secret = type === 'college' ? PETTY_EMAIL_APP_PASSWORD : type === 'church_campus' ? CHURCH_EMAIL_APP_PASSWORD : HOPE_EMAIL_APP_PASSWORD;
  let pass = 'test';
  if (!test) { try { pass = secret.value().replace(/\s+/g, ''); } catch { pass = ''; } }
  if (!lh.email || !pass) return null;
  return {
    from: lh.email, name: circleOf(type).orgName, test,
    transport: test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: lh.email, pass } }),
  };
}

export async function keepTestMail(test: string | undefined, info: unknown, tag: string) {
  if (!test) return;
  await mkdir(test, { recursive: true });
  await writeFile(join(test, `${Date.now()}-${tag}.json`), String((info as { message?: unknown }).message ?? ''));
}

export interface CircleContact { name: string; email: string; phone: string }
/** ADIA's Principal is told too (3A); she has no petty cash contact. */
const FLAVIER = { name: 'Flavier Akinyi', email: 'flavierakinyi101@gmail.com', phone: '' };

/**
 * Who is told and who the package can be sent to (3A, 4A): Hope's board; ADIA's Head, Principal, board, Andy and
 * Doreen; the church's Andy, Doreen and its leaders (the organization heads, by their account's email).
 */
export async function circleContacts(type: CircleType, orgId: string): Promise<CircleContact[]> {
  if (type === 'ministry') return hopeBoardContacts().map((c) => ({ name: c.name, email: c.email, phone: c.phone }));
  if (type === 'college') return [...contactsFor('college').map((c) => ({ name: c.name, email: c.email, phone: c.phone })), FLAVIER];
  const base = contactsFor('church_campus').filter((c) => ['andrewguya', 'doreenmayaka'].includes(plainName(c.name))).map((c) => ({ name: c.name, email: c.email, phone: c.phone }));
  const users = (await db.collection('users').where('active', '==', true).get()).docs.map((d) => d.data() as UserProfile & { phone?: string });
  const leaders = users.filter((u) => !u.allOrgs && isCircleLead(u, orgId, type) && u.displayName);
  const have = new Set(base.map((c) => plainName(c.name)));
  for (const u of leaders) {
    if (have.has(plainName(u.displayName))) continue;
    have.add(plainName(u.displayName));
    base.push({ name: u.displayName, email: u.email ?? '', phone: normalizePhone(u.phone ?? '') ?? '' });
  }
  return base;
}

/** The lead to remind (the Director, ADIA's Head and Principal, the church leaders), with Andy and Doreen copied. */
export async function circleLeadEmails(type: CircleType, orgId: string): Promise<{ to: string[]; cc: string[] }> {
  const contacts = await circleContacts(type, orgId);
  const emailOf = (name: string, fallback: string) => contacts.find((c) => plainName(c.name) === plainName(name))?.email || fallback;
  const users = (await db.collection('users').where('active', '==', true).get()).docs.map((d) => d.data() as UserProfile);
  const to = [...new Set(users.filter((u) => !u.allOrgs && isCircleLead(u, orgId, type)).map((u) => emailOf(u.displayName, u.email)).filter((e) => EMAIL.test(e)))];
  const cc = [...new Set(contacts.filter((c) => ['andrewguya', 'doreenmayaka'].includes(plainName(c.name))).map((c) => c.email).filter((e) => EMAIL.test(e) && !to.includes(e)))];
  return { to: to.length ? to : cc, cc: to.length ? cc : [] };
}

/** One person a conversation is about, or is named in a message: a child (HC code, class), a student (admission number, course) or a member. */
export async function circlePerson(orgId: string, id: string, type: CircleType): Promise<StoryChild | null> {
  const person = await db.doc(`organizations/${orgId}/people/${id}`).get();
  const p = person.data() ?? {};
  if (type === 'ministry') {
    const c = await db.doc(`organizations/${orgId}/children/${id}`).get();
    if (!c.exists || c.data()?.deletedAt) return null;
    return { id, name: String(p.fullName ?? 'Child'), code: String(c.data()?.code ?? ''), className: classOf(p.dateOfBirth as string | null, localDateKey())?.name ?? '' };
  }
  if (!person.exists || p.deletedAt) return null;
  if (type === 'college') {
    const s = await db.doc(`organizations/${orgId}/students/${id}`).get();
    if (!s.exists || s.data()?.deletedAt) return null;
    const course = s.data()?.courseId ? (await db.doc(`organizations/${orgId}/courses/${s.data()!.courseId}`).get()).data() : undefined;
    return { id, name: String(p.fullName ?? 'Student'), code: String(s.data()?.admissionNo ?? ''), className: String(course?.name ?? '') };
  }
  return { id, name: String(p.fullName ?? 'Member'), code: '', className: String(p.status ? String(p.status).replace(/^\w/, (x) => x.toUpperCase()) : '') };
}

/** The people named in a message (2A), checked and kept as they are today. */
export async function circlePeopleOf(orgId: string, ids: unknown, type: CircleType): Promise<StoryChild[]> {
  const list = [...new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,120}$/.test(x)) : [])].slice(0, STORY_CHILDREN_MAX);
  const out: StoryChild[] = [];
  for (const id of list) { const one = await circlePerson(orgId, id, type); if (one) out.push(one); }
  return out;
}

/** Everyone who can be named (2A): the children, the students, or the church's people. */
export async function circleEveryone(orgId: string, type: CircleType): Promise<StoryChild[]> {
  const today = localDateKey();
  const people = new Map((await db.collection(`organizations/${orgId}/people`).get()).docs.filter((d) => !d.data().deletedAt).map((d) => [d.id, d.data()]));
  let rows: StoryChild[];
  if (type === 'ministry') {
    rows = (await db.collection(`organizations/${orgId}/children`).get()).docs.filter((d) => !d.data().deletedAt && d.data().status !== 'left').map((d) => {
      const p = people.get(d.id) ?? {};
      return { id: d.id, name: String(p.fullName ?? ''), code: String(d.data().code ?? ''), className: classOf(p.dateOfBirth as string | null, today)?.name ?? '' };
    });
  } else if (type === 'college') {
    const courses = new Map((await db.collection(`organizations/${orgId}/courses`).get()).docs.map((d) => [d.id, String(d.data().name ?? '')]));
    rows = (await db.collection(`organizations/${orgId}/students`).get()).docs.filter((d) => !d.data().deletedAt && people.has(d.id)).map((d) => ({
      id: d.id, name: String(people.get(d.id)?.fullName ?? ''), code: String(d.data().admissionNo ?? ''), className: courses.get(String(d.data().courseId ?? '')) ?? '',
    }));
  } else {
    rows = [...people.entries()].map(([id, p]) => ({ id, name: String(p.fullName ?? ''), code: '', className: p.status ? String(p.status).replace(/^\w/, (x) => x.toUpperCase()) : '' }));
  }
  return rows.filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name));
}

/** The next number for this year in a counter (4A, 7A). */
export async function nextNumber(orgId: string, counterId: string): Promise<{ year: number; n: number }> {
  const year = Number(localDateKey().slice(0, 4));
  const counter = db.doc(`organizations/${orgId}/counters/${counterId}`);
  const n = await db.runTransaction(async (tx) => {
    const c = (await tx.get(counter)).data() as { year?: number; n?: number } | undefined;
    const next = c?.year === year ? (c.n ?? 0) + 1 : 1;
    tx.set(counter, { year, n: next });
    return next;
  });
  return { year, n };
}
