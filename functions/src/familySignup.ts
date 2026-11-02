import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import nodemailer from 'nodemailer';
import { db, FieldValue, requireCaller, requireString } from './common.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { firstName, HOW_HEARD_OPTIONS, statusChange, type PersonStatus } from './shared/people.js';
import { canAccessOrg, canKeepAccounts, isDirectorProfile } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { poweredByHtml } from './shared/poweredBy.js';
import { approvedStatus, cleanSignup, updatesFor, type CleanSignup, type SignupPerson } from './shared/familySignup.js';

const CHURCH_EMAIL_APP_PASSWORD = defineSecret('CHURCH_EMAIL_APP_PASSWORD');
/** Who wrote the record: the family, through the sign-up form. */
const SIGNUP = 'family-signup';
const MAX_PER_DAY = 200;
const MAX_PER_SENDER = 4;
const APP_URL = 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
type Doc = FirebaseFirestore.DocumentSnapshot;

async function churchOrg(orgId: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orgId)) throw new HttpsError('not-found', 'This form is not linked to a church.');
  const snap = await db.doc(`organizations/${orgId}`).get();
  const org = snap.data();
  if (!snap.exists || org?.deletedAt || org?.type !== 'church_campus') throw new HttpsError('not-found', 'This form is not linked to a church.');
  return org;
}

/** Emails Andrew that a new form is waiting (Andy, 2026-11-02, 3A). A failed email never loses the form. */
async function tellAndrew(orgName: string, form: CleanSignup, known: boolean[]) {
  try {
    const users = await db.collection('users').where('active', '==', true).get();
    const to = users.docs.map((d) => d.data()).filter((u) => isDirectorProfile(u as never)).map((u) => String(u.email ?? '')).filter((e) => EMAIL.test(e));
    if (!to.length) return;
    const test = process.env.PETTY_MAIL_TEST_DIR;
    const lh = letterheadFor({ type: 'church_campus', name: orgName });
    const pass = test ? 'test' : CHURCH_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
    if (!lh.email || !pass) return;
    const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: lh.email, pass } });
    const everyone = [form.me, ...form.family];
    const lines = everyone.map((p, i) => `${p.fullName}${known[i] ? ' (already in People: details to update)' : ' (new)'}`);
    const link = `${APP_URL}/people/signups`;
    const subject = `New family sign-up to approve: ${form.me.fullName}${everyone.length > 1 ? ` (${everyone.length} people)` : ''}`;
    const info = await transport.sendMail({
      from: `"${lh.name}" <${lh.email}>`, to: to.join(', '), replyTo: lh.email, subject,
      text: `A family filled in the sign-up form at ${orgName}:\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\nNothing is added to People until you or Doreen approve it:\n${link}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17241c">
<h2 style="color:#0f3b25">New family sign-up to approve</h2>
<p>A family filled in the sign-up form at ${esc(orgName)}:</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p>Nothing is added to People until you or Doreen approve it.</p>
<p><a href="${link}" style="display:inline-block;background:#1f7a4d;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open Approve sign-ups</a></p>
${poweredByHtml()}</div>`,
    });
    if (test) {
      await mkdir(test, { recursive: true });
      await writeFile(join(test, `${Date.now()}-family-signup.json`), String((info as { message?: unknown }).message ?? ''));
    }
  } catch (err) {
    logger.warn('Family sign-up email failed', err);
  }
}

/**
 * "Join the Freedom family" (Andy, 2026-11-02). Anyone may open it without signing in. The form is kept in
 * organizations/{org}/signups as "waiting" and Andrew gets an email; nothing reaches People until Andrew or Doreen
 * approve it (decideSignup).
 *   { orgId, action: 'info' } → { name, serviceTimes, howHeard }
 *   { orgId, action: 'send', me, family, weddingDate, website }
 */
export const familySignup = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, secrets: [CHURCH_EMAIL_APP_PASSWORD] }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(data.orgId, 60);
  const org = await churchOrg(orgId);
  const orgName = String(org.name ?? 'Freedom Church');
  const serviceTimes = Array.isArray(org.serviceTimes) ? org.serviceTimes.filter((s: unknown): s is string => typeof s === 'string').slice(0, 12) : [];
  if (data.action === 'info') return { name: orgName, serviceTimes, howHeard: HOW_HEARD_OPTIONS };
  if (text(data.website, 200)) return { ok: true, firstName: '', count: 0 };

  const today = localDateKey(new Date(), String(org.timeZone || DEFAULT_TIME_ZONE));
  let form: CleanSignup;
  try { form = cleanSignup(data, today, serviceTimes); } catch (err) { throw new HttpsError('invalid-argument', (err as Error).message); }

  const sender = createHash('sha256').update(`${today}|${request.rawRequest?.ip ?? ''}|${form.me.phone}`).digest('hex').slice(0, 24);
  const dayRef = db.doc(`organizations/${orgId}/welcomeDays/join_${today}`);
  const senderRef = db.doc(`organizations/${orgId}/welcomeDays/join_${today}_${sender}`);
  await db.runTransaction(async (tx) => {
    const [day, from] = await Promise.all([tx.get(dayRef), tx.get(senderRef)]);
    if ((day.get('count') ?? 0) >= MAX_PER_DAY || (from.get('count') ?? 0) >= MAX_PER_SENDER) {
      throw new HttpsError('resource-exhausted', 'Thank you! We already have your family’s details. The church office can help if anything is missing.');
    }
    tx.set(dayRef, { count: FieldValue.increment(1), date: today }, { merge: true });
    tx.set(senderRef, { count: FieldValue.increment(1), date: today }, { merge: true });
  });

  // Who is already in People, so the approval page can show what changes (1A).
  const people = db.collection(`organizations/${orgId}/people`);
  const live = (docs: Doc[]) => docs.filter((d) => d.get('deletedAt') == null);
  const byPhone = async (phone: string | null): Promise<Doc | null> => {
    if (!phone) return null;
    const [a, b] = await Promise.all([people.where('phone', '==', phone).limit(5).get(), people.where('whatsapp', '==', phone).limit(5).get()]);
    return live([...a.docs, ...b.docs])[0] ?? null;
  };
  const meKnown = await byPhone(form.me.phone);
  const household = meKnown?.get('householdId') ? live((await people.where('householdId', '==', meKnown.get('householdId')).get()).docs) : [];
  const sameName = (name: string) => household.find((d) => String(d.get('fullName') ?? '').toLowerCase() === name.toLowerCase()) ?? null;
  const family: (string | null)[] = [];
  for (const m of form.family) family.push(((await byPhone(m.phone)) ?? sameName(m.fullName))?.id ?? null);

  const now = FieldValue.serverTimestamp();
  await db.collection(`organizations/${orgId}/signups`).add({
    orgId, state: 'waiting', date: today, form, matches: { me: meKnown?.id ?? null, family },
    fullName: form.me.fullName, count: 1 + form.family.length,
    createdAt: now, createdBy: SIGNUP, decidedAt: null, decidedBy: null, decidedByName: null,
  });
  await tellAndrew(orgName, form, [!!meKnown, ...family.map((id) => !!id)]);
  return { ok: true, firstName: firstName(form.me.fullName), count: 1 + form.family.length, returning: !!meKnown };
});

/**
 * Approve or turn down a waiting sign-up (Andy, 2026-11-02, 1A 2A): Andrew and Doreen only. Approving adds new
 * people as one family, and updates people already there with the form's answers.
 *   { orgId, id, decision: 'approve' | 'reject' } → { ok, people }
 */
export const decideSignup = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30 }, async (request) => {
  const caller = await requireCaller(request);
  if (!canKeepAccounts(caller.profile)) throw new HttpsError('permission-denied', 'Only Andrew and Doreen approve sign-ups.');
  const d = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(d.orgId, 'orgId', { max: 60 });
  const id = requireString(d.id, 'id', { max: 60 });
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to that organization.');
  if (d.decision !== 'approve' && d.decision !== 'reject') throw new HttpsError('invalid-argument', 'Choose approve or reject.');
  const org = await churchOrg(orgId);
  const ref = db.doc(`organizations/${orgId}/signups/${id}`);
  const snap = await ref.get();
  const s = snap.data();
  if (!s) throw new HttpsError('not-found', 'That sign-up is no longer there.');
  if (s.state !== 'waiting') throw new HttpsError('failed-precondition', 'That sign-up has already been dealt with.');
  const now = FieldValue.serverTimestamp();
  const decided = { decidedAt: now, decidedBy: caller.uid, decidedByName: caller.profile.displayName ?? '' };
  if (d.decision === 'reject') {
    await ref.update({ state: 'rejected', ...decided });
    return { ok: true, people: 0 };
  }

  const today = localDateKey(new Date(), String(org.timeZone || DEFAULT_TIME_ZONE));
  const form = s.form as CleanSignup;
  const matches = (s.matches ?? {}) as { me?: string | null; family?: (string | null)[] };
  const people = db.collection(`organizations/${orgId}/people`);
  const load = async (pid: string | null | undefined): Promise<Doc | null> => {
    if (!pid) return null;
    const p = await people.doc(pid).get();
    return p.exists && p.get('deletedAt') == null ? p : null;
  };
  const created = { deletedAt: null, deletedBy: null, createdAt: now, createdBy: SIGNUP, updatedAt: now, updatedBy: caller.uid };
  const touched = { updatedAt: now, updatedBy: caller.uid };
  const batch = db.batch();
  const meKnown = await load(matches.me);
  const meRef = meKnown?.ref ?? people.doc();
  const householdId = (meKnown?.get('householdId') as string | null | undefined) || meRef.id;
  const ids: string[] = [];

  const save = (known: Doc | null, pref: FirebaseFirestore.DocumentReference, p: SignupPerson, extra: { familyRole: string | null; guardianId: string | null; whatsapp: string | null; consent: boolean; howHeard?: string | null; serviceAttended?: string | null }) => {
    ids.push(pref.id);
    const next: PersonStatus = approvedStatus(p, form.me.claim ?? 'regular');
    if (!known) {
      batch.set(pref, {
        orgId, fullName: p.fullName, firstName: firstName(p.fullName), phone: p.phone, whatsapp: extra.whatsapp,
        whatsappConsent: { given: extra.consent, date: today, recordedBy: SIGNUP, stoppedAt: null },
        email: p.email, ...statusChange({ status: 'visitor', memberSince: null }, next, today), signup: null, firstVisitDate: null,
        gender: p.gender, birthday: p.birthday, birthYear: p.birthYear, householdId, familyRole: extra.familyRole, guardianId: extra.guardianId,
        howHeard: extra.howHeard ?? null, invitedBy: null, invitedById: null, serviceAttended: extra.serviceAttended ?? null,
        about: p.about, customFields: {}, possibleDuplicateIds: [], ...created,
      });
      return;
    }
    const k = known.data()!;
    const fill: Record<string, unknown> = updatesFor(k, p, next, { howHeard: extra.howHeard, serviceAttended: extra.serviceAttended });
    if ('status' in fill) Object.assign(fill, statusChange({ status: k.status, memberSince: k.memberSince ?? null }, next, today));
    if (k.signup) fill.signup = null;
    if (!k.householdId) fill.householdId = householdId;
    if (!k.familyRole && extra.familyRole && (!k.householdId || k.householdId === householdId)) fill.familyRole = extra.familyRole;
    if (!k.guardianId && extra.guardianId) fill.guardianId = extra.guardianId;
    if (extra.whatsapp && k.whatsapp !== extra.whatsapp) fill.whatsapp = extra.whatsapp;
    if (extra.consent && !k.whatsappConsent?.given) fill.whatsappConsent = { given: true, date: today, recordedBy: SIGNUP, stoppedAt: null };
    if (Object.keys(fill).length) batch.update(known.ref, { ...fill, ...touched });
  };

  save(meKnown, meRef, form.me, {
    familyRole: 'parent', guardianId: null, whatsapp: form.me.whatsapp ? form.me.phone : null, consent: form.me.consent,
    howHeard: form.me.howHeard, serviceAttended: form.me.serviceAttended,
  });
  for (const [i, m] of form.family.entries()) {
    const known = await load(matches.family?.[i]);
    const child = m.relation === 'child';
    save(known, known?.ref ?? people.doc(), m, {
      familyRole: m.relation === 'other' ? null : m.relation,
      guardianId: child ? meRef.id : null,
      whatsapp: child ? null : m.phone,
      consent: false,
    });
  }
  if (form.weddingDate) {
    const hRef = db.doc(`organizations/${orgId}/households/${householdId}`);
    const h = await hRef.get();
    batch.set(hRef, h.exists ? { kind: 'family', weddingDate: form.weddingDate, ...touched } : { orgId, kind: 'family', name: null, weddingDate: form.weddingDate, ...created }, { merge: true });
  }
  batch.update(ref, { state: 'approved', personIds: ids, ...decided });
  await batch.commit();
  return { ok: true, people: ids.length };
});
