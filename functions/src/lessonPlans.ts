import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { can, canAccessOrg, isInventoryManager, TRAINER_ROLE_ID } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { localDateKey } from './shared/datetime.js';
import { addDays } from './shared/metrics.js';
import {
  canChange, cleanFileName, DAYS_BACK, fridayEmail, isAllowedDay, isDocType, LESSON_CHUNK_BYTES, LESSON_MAX_BYTES, LESSON_MAX_PARTS, lessonDaysOf,
  lessonFileType, lessonItemPath, lessonPartPath, maxFilesFor, missingLessons, sixPmEmail, teachingCourses, uploadFileId,
  type LessonItem, type ManualCourse, type TeachingCourse,
} from './shared/lessonPlans.js';
import type { TutorFile } from './shared/tutorFiles.js';

const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPLOAD_ID = /^[a-z0-9]{8,32}$/;

type Profile = UserProfile & { registerClasses?: string[] };
export interface Teacher { uid: string; name: string; email: string; phone: string; courses: TeachingCourse[] }

/** What every course list needs from Exam Records, the departments and the principal's own list. */
interface Ctx { sheets: Awaited<ReturnType<typeof sheetsOf>>; closed: Set<string>; programmes: Record<string, string>; manual: ManualCourse[] }

async function sheetsOf(orgId: string) {
  const snap = await db.collection(`organizations/${orgId}/examSheets`).select('courseName', 'cohort', 'ownerUid', 'courseId', 'deletedAt').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { courseName?: string; cohort?: string; ownerUid?: string; courseId?: string | null; deletedAt?: unknown }) }));
}

async function contextOf(orgId: string): Promise<Ctx> {
  const [sheets, closed, programmes, manual] = await Promise.all([
    sheetsOf(orgId),
    db.collection(`organizations/${orgId}/examCohorts`).where('closed', '==', true).get().then((q) => new Set(q.docs.map((d) => d.id))),
    db.collection(`organizations/${orgId}/courses`).get().then((q) => Object.fromEntries(q.docs.filter((d) => !d.data().deletedAt).map((d) => [d.id, String(d.data().name ?? '')]))),
    db.collection(`organizations/${orgId}/teachingCourses`).get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() }) as ManualCourse).filter((m) => !m.deletedAt)),
  ]);
  return { sheets, closed, programmes, manual };
}

const coursesFor = (uid: string, p: Profile, c: Ctx) =>
  teachingCourses(uid, c.sheets, c.closed, p.roleId === TRAINER_ROLE_ID ? p.registerClasses ?? [] : [], c.programmes, c.manual);

/** Class registers marked from a date to today (3A). */
async function classEventsSince(orgId: string, from: string) {
  const snap = await db.collection(`organizations/${orgId}/events`).where('date', '>=', from).select('name', 'date', 'type', 'deletedAt').get();
  return snap.docs.map((d) => d.data() as { name?: string; date?: string; type?: string; deletedAt?: unknown });
}

/** Every teacher at the college: Trainer accounts and anyone who has a course (a common course, say). */
export async function teachersOf(orgId: string, ctx?: Ctx): Promise<Teacher[]> {
  const c = ctx ?? await contextOf(orgId);
  const trainers = await db.collection('users').where('roleId', '==', TRAINER_ROLE_ID).get();
  const profiles = new Map<string, Profile>(trainers.docs.map((d) => [d.id, d.data() as Profile]));
  const owners = [...new Set([...c.sheets.filter((s) => !s.deletedAt).map((s) => s.ownerUid), ...c.manual.map((m) => m.tutorUid)].filter((u): u is string => !!u && !profiles.has(u)))];
  if (owners.length) {
    const snaps = await db.getAll(...owners.map((uid) => db.doc(`users/${uid}`)));
    for (const s of snaps) if (s.exists) profiles.set(s.id, s.data() as Profile);
  }
  const out: Teacher[] = [];
  for (const [uid, u] of profiles) {
    if (!u.active || !canAccessOrg(u, orgId)) continue;
    const courses = coursesFor(uid, u, c);
    if (!courses.length && u.roleId !== TRAINER_ROLE_ID) continue;
    out.push({ uid, name: u.displayName || u.email, email: u.email ?? '', phone: u.phone ?? '', courses });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const bucket = () => getStorage().bucket();

/**
 * Weekly lesson plans (Andy, 2026-11-17, 1A-9A). Files go up and come down in 4 MB pieces, so a 20 MB file fits:
 * - "courses": the caller's own courses for the dropdown.
 * - "roster": every teacher and their courses (principal).
 * - "part": one piece of a file being uploaded.
 * - "add": the pieces become one file in the week's plan, checked for its real type.
 * - "remove": the teacher takes a file out (until approved).
 * - "download": one piece of a file, for the teacher or the principal.
 * Approve, Send back, Ask to change and Open again are the Tutor Files actions.
 */
export const lessonPlans = onCall({ invoker: 'public', memory: '1GiB', timeoutSeconds: 180 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? '');
  // 8A: only the teacher, the principal and Mr Andrew; a Reviewer may see the list but not open plans.
  const caller = await requireCaller(request, undefined, { reviewerOk: action === 'courses' });
  const me = caller.profile as Profile;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const manager = isInventoryManager(me) || can(me, 'exams.manage');
  const today = localDateKey();

  if (action === 'courses') {
    const courses = coursesFor(caller.uid, me, await contextOf(orgId));
    const lessons = lessonDaysOf(courses, await classEventsSince(orgId, addDays(today, -DAYS_BACK)), today);
    return { courses, lessons };
  }
  if (action === 'roster') {
    if (!manager) throw new HttpsError('permission-denied', 'Only the principal sees every teacher.');
    const from = typeof data.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.from) && data.from >= addDays(today, -DAYS_BACK) ? data.from : addDays(today, -35);
    const ctx = await contextOf(orgId);
    const [teachers, events] = await Promise.all([teachersOf(orgId, ctx), classEventsSince(orgId, from)]);
    return {
      teachers: teachers.map(({ email: _e, ...t }) => ({ ...t, lessons: lessonDaysOf(t.courses, events, today) })),
      manual: ctx.manual, programmes: Object.entries(ctx.programmes).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  // The principal's own list of courses (6A), one tutor each (7B).
  if (action === 'saveCourse') {
    if (!manager) throw new HttpsError('permission-denied', 'Only the principal adds courses.');
    const name = requireString(data.name, 'the course name', { max: 80 }).trim();
    const cohort = typeof data.cohort === 'string' ? data.cohort.trim().slice(0, 40) : '';
    const department = typeof data.department === 'string' && data.department ? data.department.slice(0, 80) : 'common';
    const tutorUid = requireString(data.tutorUid, 'the tutor', { max: 128 });
    const tutor = (await db.doc(`users/${tutorUid}`).get()).data() as Profile | undefined;
    if (!name || !tutor || !tutor.active || !canAccessOrg(tutor, orgId)) throw new HttpsError('invalid-argument', 'Pick a course name and a tutor at ADIA.');
    const ctx = await contextOf(orgId);
    if (department !== 'common' && !ctx.programmes[department]) throw new HttpsError('invalid-argument', 'Pick a department from the list.');
    const id = typeof data.id === 'string' && /^[A-Za-z0-9]{6,40}$/.test(data.id) ? data.id : null;
    const clash = ctx.manual.find((m) => m.id !== id && m.name.toLowerCase() === name.toLowerCase() && (m.cohort ?? '').toLowerCase() === cohort.toLowerCase());
    if (clash) throw new HttpsError('already-exists', `${name} already has a tutor: ${clash.tutorName}. Change that one instead.`);
    const ref = id ? db.doc(`organizations/${orgId}/teachingCourses/${id}`) : db.collection(`organizations/${orgId}/teachingCourses`).doc();
    await ref.set({ name, cohort, department, tutorUid, tutorName: tutor.displayName || tutor.email, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid, ...(id ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }) }, { merge: true });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'teaching_course_save', path: ref.path, collection: 'teachingCourses', docId: ref.id, orgId });
    return { id: ref.id };
  }
  if (action === 'removeCourse') {
    if (!manager) throw new HttpsError('permission-denied', 'Only the principal removes courses.');
    const id = requireString(data.id, 'the course', { max: 40 });
    const ref = db.doc(`organizations/${orgId}/teachingCourses/${id}`);
    await ref.update({ deletedAt: FieldValue.serverTimestamp(), deletedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'teaching_course_remove', path: ref.path, collection: 'teachingCourses', docId: id, orgId });
    return { ok: true };
  }

  if (action === 'part') {
    const uploadId = requireString(data.uploadId, 'the upload', { max: 32 });
    const n = Number(data.n);
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(n) || n < 0 || n >= LESSON_MAX_PARTS) throw new HttpsError('invalid-argument', 'This upload is not valid.');
    const b64 = requireString(data.data, 'the file', { max: Math.ceil(LESSON_CHUNK_BYTES * 1.37) + 16 });
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > LESSON_CHUNK_BYTES) throw new HttpsError('invalid-argument', 'This piece is too large.');
    await bucket().file(lessonPartPath(orgId, caller.uid, uploadId, n)).save(bytes, { resumable: false, contentType: 'application/octet-stream' });
    return { ok: true };
  }

  if (action === 'add') {
    const courseKey = requireString(data.courseKey, 'the course', { max: 140 });
    const docType = isDocType(data.docType) ? data.docType : 'lesson';
    const day = docType === 'lesson' ? requireString(data.day, 'the lesson date', { max: 10 }) : '';
    const uploadId = requireString(data.uploadId, 'the upload', { max: 32 });
    const parts = Number(data.parts);
    const name = cleanFileName(requireString(data.name, 'the file name', { max: 200 }));
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > LESSON_MAX_PARTS) throw new HttpsError('invalid-argument', 'This upload is not valid.');
    if (docType === 'lesson' && !isAllowedDay(day, today)) throw new HttpsError('invalid-argument', 'Pick a lesson date in the last three months or the next month.');
    const course = coursesFor(caller.uid, me, await contextOf(orgId)).find((c) => c.key === courseKey);
    if (!course) throw new HttpsError('permission-denied', 'This is not one of your courses.');
    const fileId = uploadFileId(courseKey, docType, day, caller.uid);
    const ref = db.doc(`organizations/${orgId}/tutorFiles/${fileId}`);
    const before = (await ref.get()).data() as TutorFile | undefined;
    if (!canChange(before, today)) throw new HttpsError('failed-precondition', 'This is approved and locked. Tap "Ask to change" and the principal can open it for you.');
    if ((before?.files?.length ?? 0) >= maxFilesFor(docType)) throw new HttpsError('failed-precondition', `This holds up to ${maxFilesFor(docType)} files. Remove one first.`);

    const pieces = Array.from({ length: parts }, (_, n) => bucket().file(lessonPartPath(orgId, caller.uid, uploadId, n)));
    const itemId = randomBytes(8).toString('hex');
    const dest = bucket().file(lessonItemPath(orgId, fileId, itemId));
    const cleanup = () => Promise.all(pieces.map((p) => p.delete({ ignoreNotFound: true }))).catch((err) => logger.warn('Lesson plan pieces not removed', err));
    try {
      const sizes = await Promise.all(pieces.map((p) => p.getMetadata().then(([m]) => Number(m.size)).catch(() => -1)));
      if (sizes.some((s) => s < 0)) throw new HttpsError('failed-precondition', 'Part of the file did not arrive. Please try again.');
      const size = sizes.reduce((a, b) => a + b, 0);
      if (size > LESSON_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 20 MB.');
      // The pieces are joined here (at most 20 MB) and checked before anything is kept.
      const whole = Buffer.concat(await Promise.all(pieces.map((p) => p.download().then(([b]) => b))));
      const type = lessonFileType(name, /\.(txt|csv)$/i.test(name) ? whole : whole.subarray(0, 32));
      if (!type) throw new HttpsError('invalid-argument', 'This file is not a PDF, Word, PowerPoint, Excel, OpenOffice, text file or photo.');
      await dest.save(whole, { resumable: false, contentType: type.contentType });
      const item: LessonItem = { id: itemId, name, contentType: type.contentType, size, uploadedOn: today };
      const files = [...(before?.files ?? []), item];
      const doc: Partial<TutorFile> & Record<string, unknown> = {
        orgId, kind: 'upload', docType, requestId: null, eventId: null, courseKey, title: course.label, day,
        tutorUid: caller.uid, tutorName: me.displayName || me.email, status: 'sent',
        fileName: files[0]!.name, contentType: files[0]!.contentType, size: files.reduce((a, f) => a + f.size, 0), files,
        sentOn: today, late: false, version: (before?.version ?? 0) + 1, reopenRequest: null,
        // A reopened plan stays open until its day ends; a sent-back one is sent again.
        reopenUntil: before?.reopenUntil ?? null, returnNote: before?.status === 'returned' ? before.returnNote : '', approvedByName: '',
        sentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
        ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }),
      };
      await ref.set(doc, { merge: true });
      await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'lesson_plan_add', path: ref.path, collection: 'tutorFiles', docId: fileId, orgId, note: `${size} bytes, ${type.ext}` });
      return { fileId, item };
    } finally { await cleanup(); }
  }

  const fileId = requireString(data.fileId, 'the plan', { max: 320 });
  const ref = db.doc(`organizations/${orgId}/tutorFiles/${fileId}`);
  const f = (await ref.get()).data() as TutorFile | undefined;
  if (!f || (f.kind !== 'week' && f.kind !== 'upload')) throw new HttpsError('not-found', 'This lesson plan was not found.');
  const own = f.tutorUid === caller.uid;
  const itemId = requireString(data.itemId, 'the file', { max: 40 });
  const item = (f.files ?? []).find((i) => i.id === itemId);
  if (!item) throw new HttpsError('not-found', 'This file is no longer in the plan.');

  if (action === 'download') {
    if (!own && !manager) throw new HttpsError('permission-denied', 'Only the teacher and the principal open lesson plans.');
    const start = Math.max(0, Math.floor(Number(data.start) || 0));
    if (start >= item.size) return { name: item.name, contentType: item.contentType, size: item.size, data: '' };
    const end = Math.min(item.size, start + LESSON_CHUNK_BYTES) - 1;
    const [bytes] = await bucket().file(lessonItemPath(orgId, fileId, itemId)).download({ start, end });
    return { name: item.name, contentType: item.contentType, size: item.size, data: bytes.toString('base64') };
  }
  if (action === 'remove') {
    if (!own) throw new HttpsError('permission-denied', 'Only the teacher who uploaded it can remove it.');
    if (!canChange(f, today)) throw new HttpsError('failed-precondition', 'This plan is approved and locked.');
    await bucket().file(lessonItemPath(orgId, fileId, itemId)).delete({ ignoreNotFound: true });
    const files = (f.files ?? []).filter((i) => i.id !== itemId);
    await ref.update({
      files, fileName: files[0]?.name ?? '', contentType: files[0]?.contentType ?? '', size: files.reduce((a, x) => a + x.size, 0),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'lesson_plan_remove', path: ref.path, collection: 'tutorFiles', docId: fileId, orgId });
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});

async function mailer() {
  const from = letterheadFor({ type: 'college', name: '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) { logger.warn('Lesson plan reminders: ADIA email is not set up.'); return null; }
  const transport: Transporter = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  return async (to: { uid: string; name: string; email: string }, mail: { subject: string; text: string }) => {
    try {
      const info = await transport.sendMail({ from: `"ADIA Training Centre" <${from}>`, replyTo: from, to: `"${to.name.replace(/"/g, '')}" <${to.email}>`, ...mail });
      if (test) {
        await mkdir(test, { recursive: true });
        await writeFile(join(test, `${Date.now()}-lessonplan-${to.uid}.json`), String((info as { message?: unknown }).message ?? ''));
      }
      return true;
    } catch (err) { logger.warn(`Lesson plan reminder to ${to.email} failed`, err); return false; }
  };
}

/**
 * 8A: at 6pm, a tutor who marked a register today but sent no plan gets an email; on Friday, every tutor gets one
 * email listing the lessons of the last two weeks that still have no plan.
 */
export async function remindLessonPlans(kind: 'evening' | 'friday', now = new Date()): Promise<number> {
  const today = localDateKey(now);
  const from = kind === 'evening' ? today : addDays(today, -13);
  const orgs = await db.collection('organizations').where('type', '==', 'college').get();
  let send: Awaited<ReturnType<typeof mailer>> | undefined;
  let sent = 0;
  for (const org of orgs.docs) {
    const [teachers, events, plans] = await Promise.all([
      teachersOf(org.id),
      classEventsSince(org.id, from),
      db.collection(`organizations/${org.id}/tutorFiles`).where('day', '>=', from).get().then((q) => q.docs.map((d) => d.data() as TutorFile & { docType?: string }).filter((p) => p.kind === 'upload')),
    ]);
    for (const t of teachers) {
      if (!EMAIL.test(t.email)) continue;
      const missing = missingLessons(lessonDaysOf(t.courses, events, today), t.courses, plans.filter((p) => p.tutorUid === t.uid));
      if (!missing.length) continue;
      if (send === undefined) send = await mailer();
      if (!send) return sent;
      const link = `${appUrl()}/tutor-files/lesson-plans`;
      const first = t.name.split(' ')[0] ?? t.name;
      if (await send(t, kind === 'evening' ? sixPmEmail(first, missing, link) : fridayEmail(first, missing, link))) sent++;
    }
  }
  logger.info(`Lesson plan reminders (${kind}): ${sent} sent.`);
  return sent;
}

// Cloud Scheduler isn't offered in africa-south1, so these run from Europe, on Nairobi time.
const schedule = (when: string) => ({ schedule: when, timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [PETTY_EMAIL_APP_PASSWORD] });
export const lessonPlanReminders = onSchedule(schedule('every friday 16:00'), async () => { await remindLessonPlans('friday'); });
export const lessonPlanEvening = onSchedule(schedule('every day 18:00'), async () => { await remindLessonPlans('evening'); });
