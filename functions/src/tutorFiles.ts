import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { can, canAccessOrg, isInventoryManager, TRAINER_ROLE_ID } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { formatDateKey, localDateKey } from './shared/datetime.js';
import {
  canSend, downloadName, fileTypeOf, isForTutor, lessonFileId, needsReminder, reminderSubject, reminderText, reopenUntilFor, requestFileId,
  TUTOR_FILE_MAX_BYTES, tutorFilePath, type FileRequest, type TutorFile,
} from './shared/tutorFiles.js';

// ADIA's Gmail and its app password, the same ones petty cash, inventory and Exam Records emails go from.
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Profile = UserProfile & { trainerCourseIds?: string[]; registerClasses?: string[] };
const isTutor = (p: Profile) => p.roleId === TRAINER_ROLE_ID || can(p, 'exams.mark');

/** The tutor accounts (Trainer role) of an organization. */
async function tutorsOf(orgId: string) {
  const users = await db.collection('users').where('roleId', '==', TRAINER_ROLE_ID).get();
  return users.docs
    .map((d) => ({ uid: d.id, u: d.data() as Profile }))
    .filter(({ u }) => u.active && canAccessOrg(u, orgId))
    .map(({ uid, u }) => ({ uid, name: u.displayName || u.email, email: u.email ?? '', phone: u.phone ?? '', courseIds: u.trainerCourseIds ?? [], registerClasses: u.registerClasses ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything done to a tutor's file (Andy, 2026-11-04). Files sit in Storage, which the app cannot reach, so every
 * read and write is checked here:
 * - "send": a tutor sends a requested file or a lesson plan (PDF or Word). A sent file is locked.
 * - "download": the tutor or the principal gets the file back.
 * - "ask": the tutor asks to change a sent file, with a reason.
 * - "reopen", "approve", "sendBack": the principal (or Admin, the pastor, Doreen) answers.
 * - "roster": the principal's list of tutors.
 */
export const tutorFiles = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as Profile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const manager = isInventoryManager(me) || can(me, 'exams.manage');
  const today = localDateKey();
  const action = String(data.action ?? '');

  if (action === 'roster') {
    if (!manager) throw new HttpsError('permission-denied', 'Only the principal sees the tutors.');
    return { tutors: (await tutorsOf(orgId)).map(({ email: _e, ...t }) => t) };
  }

  if (action === 'send') {
    if (!isTutor(me)) throw new HttpsError('permission-denied', 'Only tutors send files here.');
    const requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId.slice(0, 80) : null;
    const eventId = !requestId && typeof data.eventId === 'string' && data.eventId ? data.eventId.slice(0, 200) : null;
    if (!requestId && !eventId) throw new HttpsError('invalid-argument', 'Which file is this for?');
    let title: string; let day: string; let fileId: string; let late = false;
    if (requestId) {
      const r = (await db.doc(`organizations/${orgId}/fileRequests/${requestId}`).get()).data() as (FileRequest & { deletedAt?: unknown }) | undefined;
      if (!r || r.deletedAt) throw new HttpsError('not-found', 'The principal has removed this request.');
      if (!isForTutor(r, me.trainerCourseIds ?? [])) throw new HttpsError('permission-denied', 'This request is not for your department.');
      title = r.title; day = r.deadline; fileId = requestFileId(requestId, caller.uid); late = today > r.deadline;
    } else {
      const e = (await db.doc(`organizations/${orgId}/events/${eventId}`).get()).data();
      if (!e || e.deletedAt || e.type !== 'class') throw new HttpsError('not-found', 'This class register was not found.');
      if (!(me.registerClasses ?? []).includes(e.name) && e.createdBy !== caller.uid) throw new HttpsError('permission-denied', 'This is not one of your classes.');
      title = String(e.name); day = String(e.date); fileId = lessonFileId(eventId!, caller.uid);
    }
    const ref = db.doc(`organizations/${orgId}/tutorFiles/${fileId}`);
    const before = (await ref.get()).data() as TutorFile | undefined;
    if (!canSend(before, today)) throw new HttpsError('failed-precondition', 'This file is locked. Tap "Ask to change" and the principal can open it for you.');
    const b64 = requireString(data.file, 'the file', { max: Math.ceil(TUTOR_FILE_MAX_BYTES * 1.37) + 16 });
    const bytes = Buffer.from(b64, 'base64');
    const type = fileTypeOf(bytes);
    if (!type) throw new HttpsError('invalid-argument', 'Please send a PDF or a Word file.');
    if (bytes.length > TUTOR_FILE_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 6 MB.');
    await getStorage().bucket().file(tutorFilePath(orgId, fileId)).save(bytes, { contentType: type.contentType, resumable: false });
    const doc: TutorFile & Record<string, unknown> = {
      orgId, kind: requestId ? 'request' : 'lesson', requestId, eventId, title, day,
      tutorUid: caller.uid, tutorName: me.displayName || me.email, status: 'sent',
      fileName: downloadName(title, me.displayName || me.email, type.ext), contentType: type.contentType, size: bytes.length,
      sentOn: today, late, version: (before?.version ?? 0) + 1, reopenRequest: null, reopenUntil: null,
      returnNote: '', approvedByName: '',
      sentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }),
    };
    await ref.set(doc, { merge: true });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'tutor_file_send', path: ref.path, collection: 'tutorFiles', docId: fileId, orgId, note: `${bytes.length} bytes${late ? ', late' : ''}` });
    return { fileId, late };
  }

  const fileId = requireString(data.fileId, 'the file', { max: 320 });
  const ref = db.doc(`organizations/${orgId}/tutorFiles/${fileId}`);
  const f = (await ref.get()).data() as TutorFile | undefined;
  if (!f) throw new HttpsError('not-found', 'This file was not found.');
  const own = f.tutorUid === caller.uid;

  if (action === 'download') {
    if (!own && !manager) throw new HttpsError('permission-denied', 'You cannot open this file.');
    const [bytes] = await getStorage().bucket().file(tutorFilePath(orgId, fileId)).download();
    return { fileName: f.fileName, contentType: f.contentType, file: bytes.toString('base64') };
  }
  if (action === 'ask') {
    if (!own) throw new HttpsError('permission-denied', 'Only the tutor who sent it can ask.');
    const reason = requireString(data.reason, 'the reason', { max: 300 }).trim();
    await ref.update({ reopenRequest: { reason, byName: me.displayName || me.email }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { ok: true };
  }
  if (!manager) throw new HttpsError('permission-denied', 'Only the principal can do that.');
  const byName = me.displayName || me.email;
  if (action === 'reopen') {
    const until = reopenUntilFor(today, Number(data.days));
    await ref.update({ reopenUntil: until, reopenRequest: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'tutor_file_reopen', path: ref.path, collection: 'tutorFiles', docId: fileId, orgId, note: `until ${until}` });
    return { until };
  }
  if (action === 'approve') {
    await ref.update({ status: 'approved', approvedByName: byName, returnNote: '', reopenRequest: null, reopenUntil: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { ok: true };
  }
  if (action === 'sendBack') {
    const note = requireString(data.note, 'the comment', { max: 500 }).trim();
    await ref.update({ status: 'returned', returnNote: note, approvedByName: '', reopenRequest: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});

/**
 * The countdown emails (Andy, 2026-11-04, 4A): each morning for the last five days before a request's deadline, every
 * tutor it is for who has not sent it yet gets a reminder from ADIA's Gmail.
 */
export async function remindTutorFiles(now = new Date()): Promise<number> {
  const today = localDateKey(now);
  const orgs = await db.collection('organizations').where('type', '==', 'college').get();
  let sent = 0;
  let transport: Transporter | null = null;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const from = letterheadFor({ type: 'college', name: '' }).email;
  for (const org of orgs.docs) {
    const requests = (await db.collection(`organizations/${org.id}/fileRequests`).where('deadline', '>=', today).get()).docs
      .filter((d) => !d.data().deletedAt && needsReminder(d.data().deadline as string, today));
    if (!requests.length) continue;
    const tutors = await tutorsOf(org.id);
    for (const r of requests) {
      const req = r.data() as FileRequest;
      for (const t of tutors) {
        if (!isForTutor(req, t.courseIds) || !EMAIL.test(t.email)) continue;
        const f = (await db.doc(`organizations/${org.id}/tutorFiles/${requestFileId(r.id, t.uid)}`).get()).data() as TutorFile | undefined;
        if (f && f.status !== 'returned') continue;
        if (!transport) {
          const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
          if (!from || !pass) { logger.warn('Tutor file reminders: ADIA email is not set up.'); return sent; }
          transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
        }
        try {
          const info = await transport.sendMail({
            from: `"ADIA Training Centre" <${from}>`, replyTo: from ?? undefined, to: `"${t.name.replace(/"/g, '')}" <${t.email}>`,
            subject: reminderSubject(req, today), text: reminderText(req, today, t.name.split(' ')[0] ?? t.name, `${appUrl()}/tutor-files`, formatDateKey),
          });
          if (test) {
            await mkdir(test, { recursive: true });
            await writeFile(join(test, `${Date.now()}-tutorfile-${r.id}-${t.uid}.json`), String((info as { message?: unknown }).message ?? ''));
          }
          sent++;
        } catch (err) { logger.warn(`Tutor file reminder to ${t.email} failed`, err); }
      }
    }
  }
  return sent;
}

export const tutorFileReminders = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe; 8 a.m. in Nairobi.
  { schedule: 'every day 08:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [PETTY_EMAIL_APP_PASSWORD] },
  async () => { await remindTutorFiles(); },
);
