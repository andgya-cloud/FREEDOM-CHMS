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
import { addDays, mondayOf } from './shared/metrics.js';
import {
  canChangeWeek, cleanFileName, isAllowedWeek, LESSON_CHUNK_BYTES, LESSON_MAX_BYTES, LESSON_MAX_FILES, LESSON_MAX_PARTS, lessonFileType, lessonItemPath,
  lessonPartPath, missingCourses, reminderEmail, teachingCourses, weekFileId, weekRange, type LessonItem, type TeachingCourse,
} from './shared/lessonPlans.js';
import type { TutorFile } from './shared/tutorFiles.js';

const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPLOAD_ID = /^[a-z0-9]{8,32}$/;

type Profile = UserProfile & { registerClasses?: string[] };
export interface Teacher { uid: string; name: string; email: string; phone: string; courses: TeachingCourse[] }

async function closedCohorts(orgId: string): Promise<Set<string>> {
  const snap = await db.collection(`organizations/${orgId}/examCohorts`).where('closed', '==', true).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function sheetsOf(orgId: string, uid?: string) {
  const col = db.collection(`organizations/${orgId}/examSheets`);
  const snap = await (uid ? col.where('ownerUid', '==', uid) : col).select('courseName', 'cohort', 'ownerUid', 'deletedAt').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { courseName?: string; cohort?: string; ownerUid?: string; deletedAt?: unknown }) }));
}

/** A person's own courses (2A): their marks sheets in open cohorts; a trainer with none gets their class registers. */
async function coursesOf(orgId: string, uid: string, profile: Profile): Promise<TeachingCourse[]> {
  const [sheets, closed] = await Promise.all([sheetsOf(orgId, uid), closedCohorts(orgId)]);
  return teachingCourses(uid, sheets, closed, profile.roleId === TRAINER_ROLE_ID ? profile.registerClasses ?? [] : []);
}

/** Every teacher at the college: Trainer accounts and anyone who teaches a course (a common course, say). */
export async function teachersOf(orgId: string): Promise<Teacher[]> {
  const [sheets, closed, trainers] = await Promise.all([sheetsOf(orgId), closedCohorts(orgId), db.collection('users').where('roleId', '==', TRAINER_ROLE_ID).get()]);
  const profiles = new Map<string, Profile>(trainers.docs.map((d) => [d.id, d.data() as Profile]));
  const owners = [...new Set(sheets.filter((s) => !s.deletedAt && s.ownerUid && !profiles.has(s.ownerUid)).map((s) => s.ownerUid!))];
  if (owners.length) {
    const snaps = await db.getAll(...owners.map((uid) => db.doc(`users/${uid}`)));
    for (const s of snaps) if (s.exists) profiles.set(s.id, s.data() as Profile);
  }
  const out: Teacher[] = [];
  for (const [uid, u] of profiles) {
    if (!u.active || !canAccessOrg(u, orgId)) continue;
    const courses = teachingCourses(uid, sheets, closed, u.roleId === TRAINER_ROLE_ID ? u.registerClasses ?? [] : []);
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

  if (action === 'courses') return { courses: await coursesOf(orgId, caller.uid, me) };
  if (action === 'roster') {
    if (!manager) throw new HttpsError('permission-denied', 'Only the principal sees every teacher.');
    return { teachers: (await teachersOf(orgId)).map(({ email: _e, ...t }) => t) };
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
    const monday = requireString(data.week, 'the week', { max: 10 });
    const uploadId = requireString(data.uploadId, 'the upload', { max: 32 });
    const parts = Number(data.parts);
    const name = cleanFileName(requireString(data.name, 'the file name', { max: 200 }));
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > LESSON_MAX_PARTS) throw new HttpsError('invalid-argument', 'This upload is not valid.');
    if (!isAllowedWeek(monday, today)) throw new HttpsError('invalid-argument', 'Pick a week from the list.');
    const course = (await coursesOf(orgId, caller.uid, me)).find((c) => c.key === courseKey);
    if (!course) throw new HttpsError('permission-denied', 'This is not one of your courses.');
    const fileId = weekFileId(courseKey, monday, caller.uid);
    const ref = db.doc(`organizations/${orgId}/tutorFiles/${fileId}`);
    const before = (await ref.get()).data() as TutorFile | undefined;
    if (!canChangeWeek(before, today)) throw new HttpsError('failed-precondition', 'This plan is approved and locked. Tap "Ask to change" and the principal can open it for you.');
    if ((before?.files?.length ?? 0) >= LESSON_MAX_FILES) throw new HttpsError('failed-precondition', `A plan holds up to ${LESSON_MAX_FILES} files. Remove one first.`);

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
        orgId, kind: 'week', requestId: null, eventId: null, courseKey, title: course.label, day: monday,
        tutorUid: caller.uid, tutorName: me.displayName || me.email, status: 'sent',
        fileName: files[0]!.name, contentType: files[0]!.contentType, size: files.reduce((a, f) => a + f.size, 0), files,
        sentOn: today, late: today > monday, version: (before?.version ?? 0) + 1, reopenRequest: null,
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
  if (!f || f.kind !== 'week') throw new HttpsError('not-found', 'This lesson plan was not found.');
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
    if (!canChangeWeek(f, today)) throw new HttpsError('failed-precondition', 'This plan is approved and locked.');
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

/** 6A: each Friday, teachers who have not uploaded next week's plan for every course get one email listing what's missing. */
export async function remindLessonPlans(now = new Date()): Promise<number> {
  const today = localDateKey(now);
  const monday = addDays(mondayOf(today), 7);
  const orgs = await db.collection('organizations').where('type', '==', 'college').get();
  const from = letterheadFor({ type: 'college', name: '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  let transport: Transporter | null = null;
  let sent = 0;
  for (const org of orgs.docs) {
    const teachers = await teachersOf(org.id);
    const plans = (await db.collection(`organizations/${org.id}/tutorFiles`).where('day', '==', monday).get()).docs
      .map((d) => d.data() as TutorFile).filter((p) => p.kind === 'week');
    for (const t of teachers) {
      if (!EMAIL.test(t.email) || !t.courses.length) continue;
      const missing = missingCourses(t.courses, plans.filter((p) => p.tutorUid === t.uid).map((p) => ({ ...p, courseKey: p.courseKey ?? '' })));
      if (!missing.length) continue;
      if (!transport) {
        const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
        if (!from || !pass) { logger.warn('Lesson plan reminders: ADIA email is not set up.'); return sent; }
        transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
      }
      const mail = reminderEmail(t.name.split(' ')[0] ?? t.name, monday, missing, `${appUrl()}/tutor-files/lesson-plans`);
      try {
        const info = await transport.sendMail({ from: `"ADIA Training Centre" <${from}>`, replyTo: from ?? undefined, to: `"${t.name.replace(/"/g, '')}" <${t.email}>`, ...mail });
        if (test) {
          await mkdir(test, { recursive: true });
          await writeFile(join(test, `${Date.now()}-lessonplan-${t.uid}.json`), String((info as { message?: unknown }).message ?? ''));
        }
        sent++;
      } catch (err) { logger.warn(`Lesson plan reminder to ${t.email} failed`, err); }
    }
  }
  logger.info(`Lesson plan reminders for ${weekRange(monday)}: ${sent} sent.`);
  return sent;
}

export const lessonPlanReminders = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this runs from Europe; Friday 8 a.m. in Nairobi.
  { schedule: 'every friday 08:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [PETTY_EMAIL_APP_PASSWORD] },
  async () => { await remindLessonPlans(); },
);
