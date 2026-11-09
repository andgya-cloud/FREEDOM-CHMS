import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller } from './common.js';
import { localDateKey, zonedParts, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { firstName, tidyName } from './shared/people.js';
import { normalizePhone } from './shared/phone.js';
import { attendanceIdFor, attended } from './shared/attendance.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { coverage, enrollmentIdFor, type CompletionRule, type PlanEntry, type SessionLike, type Topic } from './shared/programs.js';
import { codeWordFrom, CODE_WORD_INPUT, isWindowOpen, nextPlanned, ONLINE_LINK_INPUT, sameWord, percentOf, plannedOn, QR_SLOTS_GOOD, scanWindow, slotNow } from './shared/classRegister.js';

/**
 * The class register's QR check-in (Freedom 252, Andy 2026-11-09, 1A-7A). One callable, several actions:
 *   public (no sign-in):
 *     { action: 'info', orgId, eventId, k }                 → what the class is, and whether scanning is open
 *     { action: 'checkin', orgId, eventId, k, phone, name? } → marks the student present (adds them if new, 3A)
 *     { action: 'progress', orgId, token }                   → a student's own progress page (5A)
 *   staff:
 *     { action: 'key', orgId, eventId }        → the class's secret, so the leader's screen can show a code that changes every minute (1A)
 *     { action: 'links', orgId, programId }    → each student's progress link, for the WhatsApp reminders (6A)
 *     { action: 'import', orgId, programId, rows } → adds and enrols a list of students
 */
const SELF = 'class-qr';
const MAX_PER_CLASS = 400;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ID = /^[A-Za-z0-9_-]{1,120}$/;
type Snap = FirebaseFirestore.DocumentSnapshot;

const hmac = (key: string, value: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(value).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function loadOrg(orgId: string) {
  if (!ID.test(orgId)) throw new HttpsError('not-found', 'This class link is not right.');
  const snap = await db.doc(`organizations/${orgId}`).get();
  const org = snap.data();
  if (!snap.exists || org?.deletedAt) throw new HttpsError('not-found', 'This class link is not right.');
  return { name: String(org!.name ?? ''), tz: String(org!.timeZone || DEFAULT_TIME_ZONE) };
}

async function loadClass(orgId: string, eventId: string) {
  if (!ID.test(eventId)) throw new HttpsError('not-found', 'This class was not found. Please scan the code on the screen again.');
  const ev = await db.doc(`organizations/${orgId}/events/${eventId}`).get();
  if (!ev.exists || ev.get('deletedAt') != null || !ev.get('programId')) throw new HttpsError('not-found', 'This class was not found. Please scan the code on the screen again.');
  const program = await db.doc(`organizations/${orgId}/programs/${ev.get('programId')}`).get();
  if (!program.exists || program.get('deletedAt') != null) throw new HttpsError('not-found', 'This class was not found.');
  return { ev, program };
}

/** Each class has its own secret, kept where only the server can read it. */
async function classKey(orgId: string, eventId: string, create: boolean): Promise<string | null> {
  const ref = db.doc(`classKeys/${orgId}_${eventId}`);
  const snap = await ref.get();
  if (snap.exists) return String(snap.get('key'));
  if (!create) return null;
  const key = randomBytes(24).toString('hex');
  await ref.create({ key, orgId, eventId, createdAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return String((await ref.get()).get('key'));
}

/** One secret for the progress links. */
async function linkKey(): Promise<string> {
  const ref = db.doc('classKeys/_progress');
  const snap = await ref.get();
  if (snap.exists) return String(snap.get('key'));
  await ref.create({ key: randomBytes(24).toString('hex'), createdAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return String((await ref.get()).get('key'));
}
const tokenFor = (key: string, enrollmentId: string) => `${enrollmentId}.${hmac(key, `progress|${enrollmentId}`).slice(0, 20)}`;

/** The Meet chat link's code: one for the whole class (it still only works in class hours). */
const isOnlineCode = (key: string, code: string) => same(hmac(key, ONLINE_LINK_INPUT).slice(0, 12), code);
const codeWordOf = (key: string) => codeWordFrom(hmac(key, CODE_WORD_INPUT));

function codeGood(key: string, code: string): boolean {
  if (isOnlineCode(key, code)) return true;
  const now = slotNow();
  for (let s = now - QR_SLOTS_GOOD; s <= now + 1; s++) if (same(hmac(key, String(s)).slice(0, 12), code)) return true;
  return false;
}

/** Whether a class can be scanned right now: on its own day, and for a planned class in its hours (2A). */
function openNow(ev: Snap, program: Snap, tz: string): { open: boolean; why: string } {
  const today = localDateKey(new Date(), tz);
  if (ev.get('date') !== today) return { open: false, why: 'This code is for a class on another day.' };
  const plan = (program.get('plan') as PlanEntry[] | undefined) ?? [];
  if (!plannedOn(plan, today)) return { open: true, why: '' };
  const p = zonedParts(new Date(), tz);
  const cfg = { classStart: program.get('classStart'), classEnd: program.get('classEnd') };
  return isWindowOpen(cfg, p.hour * 60 + p.minute)
    ? { open: true, why: '' }
    : { open: false, why: `Check-in for this class is open from ${scanWindow(cfg).label}.` };
}

const topicNames = (program: Snap, ids: string[]) => {
  const topics = (program.get('topics') as Topic[] | undefined) ?? [];
  return ids.map((id) => topics.find((t) => t.id === id)?.name).filter(Boolean).join(', ');
};

async function progressOf(orgId: string, programId: string, personId: string, program: Snap) {
  const base = `organizations/${orgId}`;
  const [sessions, marks, enrolment] = await Promise.all([
    db.collection(`${base}/events`).where('programId', '==', programId).get(),
    db.collection(`${base}/attendance`).where('programId', '==', programId).where('personId', '==', personId).get(),
    db.doc(`${base}/enrollments/${enrollmentIdFor(programId, personId)}`).get(),
  ]);
  const topics = (program.get('topics') as Topic[] | undefined) ?? [];
  const rule = (program.get('completionRule') as CompletionRule | undefined) ?? { type: 'all_topics' };
  const manual = (enrolment.get('manualTopics') as Record<string, string> | undefined) ?? null;
  const c = coverage(topics, rule, sessions.docs.map((d) => ({ id: d.id, ...d.data() }) as SessionLike),
    marks.docs.map((d) => ({ eventId: d.get('eventId'), status: d.get('status'), deletedAt: d.get('deletedAt') })), manual);
  return { c, topics, manual: manual ?? {}, enrolment };
}

export const classRegister = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30, maxInstances: 10 }, async (request) => {
  const d = (request.data ?? {}) as Record<string, unknown>;
  const action = text(d.action, 20);
  const orgId = text(d.orgId, 60);
  const org = await loadOrg(orgId);

  if (action === 'info') {
    const { ev, program } = await loadClass(orgId, text(d.eventId, 120));
    const key = await classKey(orgId, ev.id, false);
    const fresh = !!key && codeGood(key, text(d.k, 20));
    const { open, why } = openNow(ev, program, org.tz);
    return {
      church: org.name, programme: String(program.get('name') ?? ''), date: ev.get('date'),
      topic: topicNames(program, (ev.get('topicIds') as string[] | undefined) ?? []),
      open: open && fresh, why: !fresh ? 'This code has changed. Please scan the code on the screen again.' : why,
      needWord: !!key && isOnlineCode(key, text(d.k, 20)),
    };
  }

  if (action === 'checkin') return checkIn(request, orgId, org, d);
  if (action === 'progress') return progressPage(orgId, org, text(d.token, 200));

  // ---- staff ----
  const caller = await requireCaller(request);
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to that organization.');

  if (action === 'key') {
    if (!can(caller.profile, 'attendance.write')) throw new HttpsError('permission-denied', 'You do not have permission to take a class.');
    const { ev } = await loadClass(orgId, text(d.eventId, 120));
    return { key: await classKey(orgId, ev.id, true) };
  }

  if (action === 'links') {
    if (!can(caller.profile, 'people.read')) throw new HttpsError('permission-denied', 'You do not have permission to see students.');
    const programId = text(d.programId, 60);
    const key = await linkKey();
    const rows = await db.collection(`organizations/${orgId}/enrollments`).where('programId', '==', programId).get();
    return { links: Object.fromEntries(rows.docs.map((r) => [r.id, tokenFor(key, r.id)])) };
  }

  if (action === 'import') {
    if (!can(caller.profile, 'programs.write')) throw new HttpsError('permission-denied', 'You do not have permission to enrol students.');
    return importStudents(orgId, org.tz, text(d.programId, 60), d.rows, caller.uid);
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});

async function findByPhone(orgId: string, phone: string): Promise<Snap | null> {
  const people = db.collection(`organizations/${orgId}/people`);
  const [a, b] = await Promise.all([people.where('phone', '==', phone).limit(5).get(), people.where('whatsapp', '==', phone).limit(5).get()]);
  return [...a.docs, ...b.docs].find((x) => x.get('deletedAt') == null) ?? null;
}

function newPerson(orgId: string, fullName: string, phone: string | null, email: string | null, onWhatsApp: boolean, today: string, by: string) {
  const now = FieldValue.serverTimestamp();
  return {
    orgId, fullName, firstName: firstName(fullName), phone, whatsapp: onWhatsApp ? phone : null,
    whatsappConsent: { given: onWhatsApp && !!phone, date: today, recordedBy: by, stoppedAt: null },
    // A class student is not a first-time visitor, so no visitor follow-ups start.
    email, status: 'regular', firstVisitDate: null, gender: null, householdId: null, guardianId: null,
    howHeard: null, invitedBy: null, invitedById: null, serviceAttended: null, customFields: {}, possibleDuplicateIds: [],
    deletedAt: null, deletedBy: null, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
  };
}

function newEnrolment(orgId: string, programId: string, personId: string, today: string, by: string, selfAdded: boolean, notes = '') {
  const now = FieldValue.serverTimestamp();
  return {
    orgId, programId, personId, cohortId: null, status: 'active', enrolledDate: today, completedDate: null, completedAuto: false,
    topicsCovered: [], notes, selfAdded, deletedAt: null, deletedBy: null, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
  };
}

async function checkIn(request: CallableRequest, orgId: string, org: { tz: string }, d: Record<string, unknown>) {
  if (text(d.website, 200)) return { ok: true, firstName: '' };
  const { ev, program } = await loadClass(orgId, text(d.eventId, 120));
  const key = await classKey(orgId, ev.id, false);
  if (!key || !codeGood(key, text(d.k, 20))) throw new HttpsError('failed-precondition', 'This code has changed. Please scan the code on the screen again.');
  const { open, why } = openNow(ev, program, org.tz);
  if (!open) throw new HttpsError('failed-precondition', why);
  const phone = normalizePhone(text(d.phone, 30));
  if (!phone) throw new HttpsError('invalid-argument', 'Please type your phone number, for example 0712 345 678.');
  const needWord = isOnlineCode(key, text(d.k, 20));

  const today = localDateKey(new Date(), org.tz);
  const programId = String(ev.get('programId'));
  // A spam guard per class and per phone or network.
  const sender = createHash('sha256').update(`${ev.id}|${request.rawRequest?.ip ?? ''}`).digest('hex').slice(0, 24);
  const countRef = db.doc(`organizations/${orgId}/welcomeDays/class_${ev.id}`);
  const senderRef = db.doc(`organizations/${orgId}/welcomeDays/class_${ev.id}_${sender}`);
  await db.runTransaction(async (tx) => {
    const [all, from] = await Promise.all([tx.get(countRef), tx.get(senderRef)]);
    if ((all.get('count') ?? 0) >= MAX_PER_CLASS || (from.get('count') ?? 0) >= 12) {
      throw new HttpsError('resource-exhausted', 'Too many check-ins from this phone. Please ask the class leader to mark you.');
    }
    tx.set(countRef, { count: FieldValue.increment(1), date: today }, { merge: true });
    tx.set(senderRef, { count: FieldValue.increment(1), date: today }, { merge: true });
  });
  // Counted above, so guessing the word is limited too.
  if (needWord && !sameWord(text(d.word, 30), codeWordOf(key))) {
    throw new HttpsError('permission-denied', 'That code word is not right. Listen for the code word the leader says in class.');
  }

  const person = await findByPhone(orgId, phone);
  const batch = db.batch();
  let added = false;
  if (!person) {
    // Someone new (3A): they type their name and are added and enrolled; the leader sees them on "Check these".
    const fullName = tidyName(text(d.name, 120));
    if (fullName.length < 2 || !/[a-z]/i.test(fullName)) return { needName: true };
    const ref = db.collection(`organizations/${orgId}/people`).doc();
    batch.set(ref, newPerson(orgId, fullName, phone, null, true, today, SELF));
    batch.set(db.doc(`organizations/${orgId}/enrollments/${enrollmentIdFor(programId, ref.id)}`), newEnrolment(orgId, programId, ref.id, today, SELF, true));
    batch.set(db.doc(`organizations/${orgId}/attendance/${attendanceIdFor(ev.id, ref.id)}`), mark(orgId, ev, ref.id));
    await batch.commit();
    return finish(orgId, programId, ref.id, fullName, program, ev, false, true);
  }

  const personId = person.id;
  const enrolRef = db.doc(`organizations/${orgId}/enrollments/${enrollmentIdFor(programId, personId)}`);
  const enrolment = await enrolRef.get();
  if (!enrolment.exists) {
    batch.set(enrolRef, newEnrolment(orgId, programId, personId, today, SELF, true));
    added = true;
  } else if (enrolment.get('deletedAt') != null || enrolment.get('status') === 'dropped') {
    batch.update(enrolRef, { status: 'active', deletedAt: null, deletedBy: null, selfAdded: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: SELF });
    added = true;
  }
  const markRef = db.doc(`organizations/${orgId}/attendance/${attendanceIdFor(ev.id, personId)}`);
  const had = await markRef.get();
  const already = had.exists && had.get('deletedAt') == null && attended(had.get('status'));
  if (!already) {
    if (had.exists) batch.update(markRef, { status: 'present', method: 'self', deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: SELF });
    else batch.set(markRef, mark(orgId, ev, personId));
  }
  await batch.commit();
  return finish(orgId, programId, personId, String(person.get('fullName') ?? ''), program, ev, already, added);
}

function mark(orgId: string, ev: Snap, personId: string) {
  const now = FieldValue.serverTimestamp();
  return {
    orgId, eventId: ev.id, personId, date: ev.get('date'), programId: ev.get('programId'), status: 'present', method: 'self',
    checkedInAt: now, deletedAt: null, deletedBy: null, createdAt: now, createdBy: SELF, updatedAt: now, updatedBy: SELF,
  };
}

async function finish(orgId: string, programId: string, personId: string, fullName: string, program: Snap, ev: Snap, already: boolean, added: boolean) {
  const { c } = await progressOf(orgId, programId, personId, program);
  const key = await linkKey();
  return {
    ok: true, already, added, firstName: firstName(fullName), topic: topicNames(program, (ev.get('topicIds') as string[] | undefined) ?? []),
    done: c.count, total: c.total, percent: percentOf(c.count, c.total), token: tokenFor(key, enrollmentIdFor(programId, personId)),
  };
}

async function progressPage(orgId: string, org: { name: string; tz: string }, token: string) {
  const [enrollmentId, sig] = token.split('.');
  if (!enrollmentId || !sig || !ID.test(enrollmentId)) throw new HttpsError('not-found', 'This progress link is not right.');
  const key = await linkKey();
  if (!same(tokenFor(key, enrollmentId), token)) throw new HttpsError('not-found', 'This progress link is not right.');
  const e = await db.doc(`organizations/${orgId}/enrollments/${enrollmentId}`).get();
  if (!e.exists || e.get('deletedAt') != null) throw new HttpsError('not-found', 'This progress link is no longer in use.');
  const programId = String(e.get('programId')), personId = String(e.get('personId'));
  const [program, person] = await Promise.all([
    db.doc(`organizations/${orgId}/programs/${programId}`).get(),
    db.doc(`organizations/${orgId}/people/${personId}`).get(),
  ]);
  if (!program.exists || !person.exists) throw new HttpsError('not-found', 'This progress link is no longer in use.');
  const { c, topics, manual } = await progressOf(orgId, programId, personId, program);
  const plan = (program.get('plan') as PlanEntry[] | undefined) ?? [];
  const today = localDateKey(new Date(), org.tz);
  const next = nextPlanned(plan, today);
  return {
    church: org.name, programme: String(program.get('name') ?? ''), firstName: firstName(String(person.get('fullName') ?? '')),
    done: c.count, total: c.total, percent: percentOf(c.count, c.total), graduated: e.get('status') === 'completed' || c.complete,
    classTime: String(program.get('classStart') ?? ''),
    next: next ? { date: next.date, topic: topics.find((t) => t.id === next.topicId)?.name ?? '' } : null,
    topics: topics.map((t) => {
      const p = plan.find((x) => x.topicId === t.id);
      return { name: t.name, label: p?.label ?? '', planned: p?.date ?? null, done: c.covered.get(t.id) ?? null, byHand: !!manual[t.id] };
    }),
  };
}

interface ImportRow { name: string; phone: string; email: string; whatsapp: boolean; note: string }

async function importStudents(orgId: string, tz: string, programId: string, raw: unknown, uid: string) {
  const program = await db.doc(`organizations/${orgId}/programs/${programId}`).get();
  if (!program.exists || program.get('deletedAt') != null) throw new HttpsError('not-found', 'That programme was not found.');
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpsError('invalid-argument', 'The list is empty.');
  if (raw.length > 400) throw new HttpsError('invalid-argument', 'Please add at most 400 students at a time.');
  const rows: ImportRow[] = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { name: tidyName(text(o.name, 120)), phone: text(o.phone, 30), email: text(o.email, 160).toLowerCase(), whatsapp: o.whatsapp !== false, note: text(o.note, 500) };
  });
  const today = localDateKey(new Date(), tz);
  const by = uid;
  const result = { added: 0, enrolled: 0, already: 0, problems: [] as string[] };
  const people = db.collection(`organizations/${orgId}/people`);
  for (const r of rows) {
    if (r.name.length < 2) { if (r.phone || r.email) result.problems.push(`A row with no name (${r.phone || r.email}) was left out.`); continue; }
    const phone = normalizePhone(r.phone);
    if (r.phone && !phone) result.problems.push(`${r.name}: the phone number "${r.phone}" is not right, so they were added without it. Please fix it on their page.`);
    let person = phone ? await findByPhone(orgId, phone) : null;
    if (!person && r.email) person = (await people.where('email', '==', r.email).limit(3).get()).docs.find((x) => x.get('deletedAt') == null) ?? null;
    if (!person) {
      const sameName = (await people.where('fullName', '==', r.name).limit(3).get()).docs.find((x) => x.get('deletedAt') == null);
      if (sameName && !sameName.get('phone')) person = sameName;
    }
    const batch = db.batch();
    let personId: string;
    if (person) {
      personId = person.id;
      if (!person.get('email') && r.email) batch.update(person.ref, { email: r.email, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
    } else {
      const ref = people.doc();
      personId = ref.id;
      batch.set(ref, newPerson(orgId, r.name, phone, r.email || null, r.whatsapp, today, by));
      result.added++;
    }
    const enrolRef = db.doc(`organizations/${orgId}/enrollments/${enrollmentIdFor(programId, personId)}`);
    const e = await enrolRef.get();
    if (!e.exists) {
      batch.set(enrolRef, newEnrolment(orgId, programId, personId, today, by, false, r.note));
      result.enrolled++;
    } else if (e.get('deletedAt') != null || e.get('status') === 'dropped') {
      batch.update(enrolRef, { status: 'active', deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
      result.enrolled++;
    } else {
      result.already++;
    }
    await batch.commit();
  }
  return result;
}
