import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue } from './common.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { firstName } from './shared/people.js';
import { cleanSignup, confirmedStatus, startingStatus, type CleanSignup, type SignupPerson } from './shared/familySignup.js';

/** Who wrote the record: the family, through the sign-up form. */
const SIGNUP = 'family-signup';
const MAX_PER_DAY = 200;
const MAX_PER_SENDER = 4;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
type Doc = FirebaseFirestore.QueryDocumentSnapshot;

/**
 * "Join the Freedom family" (Andy, 2026-11-02, 1A-6A). Anyone may open it without signing in. It adds the person
 * and their family to People as one family, or links people already there (matched by phone), and marks each
 * "New sign-up · Says: Member" until Andrew or Doreen confirm. A wedding date goes on the family for anniversaries.
 *   { orgId, action: 'info' } → { name }
 *   { orgId, action: 'send', me, family, weddingDate, website }
 */
export const familySignup = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(data.orgId, 60);
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orgId)) throw new HttpsError('not-found', 'This form is not linked to a church.');
  const orgSnap = await db.doc(`organizations/${orgId}`).get();
  const org = orgSnap.data();
  if (!orgSnap.exists || org?.deletedAt || org?.type !== 'church_campus') throw new HttpsError('not-found', 'This form is not linked to a church.');
  const orgName = String(org.name ?? 'Freedom Church');
  if (data.action === 'info') return { name: orgName };
  if (text(data.website, 200)) return { ok: true, firstName: '', count: 0 };

  let form: CleanSignup;
  try { form = cleanSignup(data); } catch (err) { throw new HttpsError('invalid-argument', (err as Error).message); }

  const today = localDateKey(new Date(), String(org.timeZone || DEFAULT_TIME_ZONE));
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

  const people = db.collection(`organizations/${orgId}/people`);
  const live = (docs: Doc[]) => docs.filter((d) => d.get('deletedAt') == null);
  const byPhone = async (phone: string | null): Promise<Doc | null> => {
    if (!phone) return null;
    const [a, b] = await Promise.all([people.where('phone', '==', phone).limit(5).get(), people.where('whatsapp', '==', phone).limit(5).get()]);
    return live([...a.docs, ...b.docs])[0] ?? null;
  };
  const now = FieldValue.serverTimestamp();
  const created = { deletedAt: null, deletedBy: null, createdAt: now, createdBy: SIGNUP, updatedAt: now, updatedBy: SIGNUP };
  const touched = { updatedAt: now, updatedBy: SIGNUP };
  const batch = db.batch();

  // The person filling in the form, and the family they belong to.
  const meKnown = await byPhone(form.me.phone);
  const meRef = meKnown?.ref ?? people.doc();
  const householdId = (meKnown?.get('householdId') as string | null | undefined) || meRef.id;
  const household = live((await people.where('householdId', '==', householdId).get()).docs);
  const sameName = (name: string) => household.find((d) => String(d.get('fullName') ?? '').toLowerCase() === name.toLowerCase()) ?? null;

  /** Adds a new person, or fills in what is missing on someone already there and flags a different status. */
  const save = (known: Doc | null, ref: FirebaseFirestore.DocumentReference, p: SignupPerson, extra: { familyRole: string | null; guardianId: string | null; whatsapp: string | null; consent: boolean }) => {
    const mark = { claimed: p.claim, at: today };
    if (!known) {
      batch.set(ref, {
        orgId, fullName: p.fullName, firstName: firstName(p.fullName), phone: p.phone, whatsapp: extra.whatsapp,
        whatsappConsent: { given: extra.consent, date: today, recordedBy: SIGNUP, stoppedAt: null },
        email: p.email, status: startingStatus(p.claim), memberSince: null, firstVisitDate: null, gender: p.gender,
        birthday: p.birthday, birthYear: p.birthYear, householdId, familyRole: extra.familyRole, guardianId: extra.guardianId,
        howHeard: null, invitedBy: null, invitedById: null, serviceAttended: null, customFields: {}, possibleDuplicateIds: [],
        signup: mark, ...created,
      });
      return;
    }
    const k = known.data();
    const fill: Record<string, unknown> = {};
    if (!k.householdId) fill.householdId = householdId;
    if (!k.familyRole && extra.familyRole && (!k.householdId || k.householdId === householdId)) fill.familyRole = extra.familyRole;
    if (!k.guardianId && extra.guardianId) fill.guardianId = extra.guardianId;
    if (!k.email && p.email) fill.email = p.email;
    if (!k.gender && p.gender) fill.gender = p.gender;
    if (!k.birthday && p.birthday) fill.birthday = p.birthday;
    if (!k.birthYear && p.birthYear) fill.birthYear = p.birthYear;
    if (!k.phone && p.phone) fill.phone = p.phone;
    // A status that differs from what they said waits for Andrew or Doreen (3A).
    if (confirmedStatus(p.claim) !== k.status) fill.signup = mark;
    if (Object.keys(fill).length) batch.update(known.ref, { ...fill, ...touched });
  };

  save(meKnown, meRef, form.me, { familyRole: 'parent', guardianId: null, whatsapp: form.me.whatsapp ? form.me.phone : null, consent: form.me.consent });
  for (const m of form.family) {
    const known = (await byPhone(m.phone)) ?? sameName(m.fullName);
    const ref = known?.ref ?? people.doc();
    const child = m.relation === 'child';
    save(known, ref, m, {
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
  await batch.commit();
  return { ok: true, firstName: firstName(form.me.fullName), count: 1 + form.family.length, returning: !!meKnown };
});
