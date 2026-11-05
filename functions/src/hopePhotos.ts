import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import nodemailer from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, requireStringArray, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg } from './shared/permissions.js';
import { contactsFor, plainName } from './pettyContacts.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { formatDateKey, localDateKey } from './shared/datetime.js';
import {
  canDeletePhotoReport, canSeeAllPhotoReports, canSeePhotoReport, canSendPhotoReport, isPhotoReportKind, MAX_PHOTO_FILES,
  PHOTO_FILE_MAX_BYTES, PHOTO_TEXT_MAX, PHOTO_TITLE_MAX, photoFileName, photoFilePath, photoFileTypeOf, photoReportEmail,
  type PhotoFile, type PhotoReport,
} from './shared/hopePhotos.js';

/** Freedom Hope Center sends from freedomnbi@gmail.com (Andy, 2026-10-30). */
const HOPE_EMAIL_APP_PASSWORD = defineSecret('HOPE_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Stored = PhotoReport & { id: string };
const shown = (id: string, r: PhotoReport) => ({ id, ...r, createdAt: undefined, updatedAt: undefined });

/** The board stakeholders the report can be sent to (the Director and the board), with their built-in contacts. */
const boardOf = () => contactsFor('ministry').map((c) => ({ name: c.name, email: c.email, phone: c.phone }));

/**
 * Everything done to a Hope photo report (Andy, 2026-11-04). The reports and their files are reached only here, so
 * who may see what is checked on every call:
 * - "list": the reports this person may see (all of them for the Director, the board, Andy and Doreen; otherwise
 *   only their own), with the deleted list for those who delete.
 * - "create", then "addFile" for each photo or document (up to ten).
 * - "file": one photo or document back.
 * - "delete" (the Director, Andy, Doreen) with an optional reason; "restore" puts it back.
 * - "board": the names and numbers to send it to; "email": sends it to the chosen board members.
 */
export const hopePhotoReports = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 120, secrets: [HOPE_EMAIL_APP_PASSWORD] }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as UserProfile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (org?.type !== 'ministry') throw new HttpsError('failed-precondition', 'Photo reports are for the Hope Center.');
  const col = db.collection(`organizations/${orgId}/hopePhotoReports`);
  const action = String(data.action ?? '');
  const myName = me.displayName || me.email;
  const all = canSeeAllPhotoReports(me, orgId);
  const deleter = canDeletePhotoReport(me, orgId);

  if (action === 'list') {
    const reportId = typeof data.reportId === 'string' && data.reportId ? data.reportId.slice(0, 120) : null;
    let q: FirebaseFirestore.Query = col;
    if (reportId) q = q.where('reportId', '==', reportId);
    else if (!all) q = q.where('senderUid', '==', caller.uid);
    const snap = await q.get();
    const rows: Stored[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PhotoReport) }))
      .filter((r) => canSeePhotoReport(me, caller.uid, r) || (r.deleted && deleter))
      .sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id));
    return {
      reports: rows.filter((r) => !r.deleted).slice(0, 300).map((r) => shown(r.id, r)),
      deleted: deleter && !reportId ? rows.filter((r) => r.deleted).slice(0, 300).map((r) => shown(r.id, r)) : [],
      seesAll: all, deletes: deleter, sends: canSendPhotoReport(me, orgId),
    };
  }

  if (action === 'create') {
    if (!canSendPhotoReport(me, orgId)) throw new HttpsError('permission-denied', 'You cannot send reports here.');
    if (!isPhotoReportKind(data.kind)) throw new HttpsError('invalid-argument', 'Please choose the kind of report.');
    const title = requireString(data.title, 'the title', { max: PHOTO_TITLE_MAX });
    const day = typeof data.day === 'string' && DAY.test(data.day) ? data.day : '';
    if (!day || day > localDateKey()) throw new HttpsError('invalid-argument', 'Please check the date.');
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, PHOTO_TEXT_MAX) : '';
    let reportId: string | null = null; let reportLabel: string | null = null;
    if (typeof data.reportId === 'string' && data.reportId) {
      const rep = (await db.doc(`organizations/${orgId}/hopeReports/${data.reportId.slice(0, 120)}`).get());
      if (!rep.exists) throw new HttpsError('not-found', 'That weekly or monthly report was not found.');
      reportId = rep.id; reportLabel = String(rep.data()?.label ?? '');
    }
    const ref = col.doc();
    const doc: PhotoReport & Record<string, unknown> = {
      orgId, kind: data.kind, title, day, text, files: [], reportId, reportLabel,
      senderUid: caller.uid, senderName: myName, deleted: false,
      createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    };
    await ref.set(doc);
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_create', path: ref.path, collection: 'hopePhotoReports', docId: ref.id, orgId, note: data.kind });
    return { id: ref.id };
  }

  if (action === 'board') {
    if (!all) throw new HttpsError('permission-denied', 'Only the Director and the board send reports on.');
    return { people: boardOf().map(({ name, email, phone }) => ({ name, hasEmail: EMAIL.test(email), phone })) };
  }

  const id = requireString(data.id, 'the report', { max: 80 });
  const ref = col.doc(id);
  const snap = await ref.get();
  const r = snap.data() as PhotoReport | undefined;
  if (!r) throw new HttpsError('not-found', 'This report was not found.');

  if (action === 'addFile') {
    if (r.senderUid !== caller.uid || r.deleted) throw new HttpsError('permission-denied', 'Only the person who sent it adds files.');
    if (r.files.length >= MAX_PHOTO_FILES) throw new HttpsError('failed-precondition', `A report takes up to ${MAX_PHOTO_FILES} files.`);
    const b64 = requireString(data.file, 'the file', { max: Math.ceil(PHOTO_FILE_MAX_BYTES * 1.37) + 16 });
    const bytes = Buffer.from(b64, 'base64');
    const type = photoFileTypeOf(bytes);
    if (!type) throw new HttpsError('invalid-argument', 'Please send photos (JPG, PNG, WebP, HEIC), PDF or Word files.');
    if (bytes.length > PHOTO_FILE_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 4 MB.');
    const key = String(Math.max(0, ...r.files.map((f) => Number(f.key) || 0)) + 1);
    await getStorage().bucket().file(photoFilePath(orgId, id, key)).save(bytes, { contentType: type.contentType, resumable: false });
    const file: PhotoFile = { key, name: photoFileName(r.title, r.files.length + 1, type.ext), contentType: type.contentType, size: bytes.length, photo: type.photo };
    await ref.update({ files: FieldValue.arrayUnion(file), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { file };
  }

  if (!canSeePhotoReport(me, caller.uid, r)) throw new HttpsError('permission-denied', 'You cannot open this report.');

  if (action === 'file') {
    const key = requireString(data.key, 'the file', { max: 4 });
    const f = r.files.find((x) => x.key === key);
    if (!f) throw new HttpsError('not-found', 'This file was not found.');
    const [bytes] = await getStorage().bucket().file(photoFilePath(orgId, id, key)).download();
    return { name: f.name, contentType: f.contentType, file: bytes.toString('base64') };
  }

  if (action === 'delete' || action === 'restore') {
    if (!deleter) throw new HttpsError('permission-denied', 'Only the Director, Andy and Doreen delete reports.');
    const del = action === 'delete';
    const reason = del && typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
    await ref.update({
      deleted: del, deletedByName: del ? myName : FieldValue.delete(), deletedOn: del ? localDateKey() : FieldValue.delete(),
      deleteReason: del ? reason : FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `hope_photo_report_${action}`, path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: reason || undefined });
    return { ok: true };
  }

  if (action === 'email') {
    if (!all || r.deleted) throw new HttpsError('permission-denied', 'Only the Director and the board send reports on.');
    const names = new Set(requireStringArray(data.names, 'who to send to').map(plainName));
    const to = boardOf().filter((p) => names.has(plainName(p.name)) && EMAIL.test(p.email));
    if (!to.length) throw new HttpsError('invalid-argument', 'Please tick at least one person with an email address.');
    const from = letterheadFor({ type: 'ministry', name: '' }).email;
    const test = process.env.PETTY_MAIL_TEST_DIR;
    const pass = test ? 'test' : HOPE_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
    if (!from || !pass) throw new HttpsError('failed-precondition', 'Email is not set up for the Hope Center yet.');
    const bucket = getStorage().bucket();
    const attachments = await Promise.all(r.files.map(async (f) => ({ filename: f.name, contentType: f.contentType, content: (await bucket.file(photoFilePath(orgId, id, f.key)).download())[0] })));
    const orgName = String(org?.name || 'Freedom Hope Center');
    const { subject, text } = photoReportEmail(r, orgName, `${appUrl()}/hope/photos?report=${id}`, formatDateKey);
    const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
    try {
      const info = await transport.sendMail({
        from: `"${orgName.replace(/"/g, '')}" <${from}>`, replyTo: from, to: to.map((p) => `"${p.name.replace(/"/g, '')}" <${p.email}>`).join(', '),
        subject, text, attachments,
      });
      if (test) {
        await mkdir(test, { recursive: true });
        await writeFile(join(test, `${Date.now()}-hopephoto-${id}.json`), String((info as { message?: unknown }).message ?? ''));
      }
    } catch (err) {
      throw new HttpsError('unavailable', `The email could not be sent. ${err instanceof Error ? err.message.slice(0, 160) : ''}`);
    }
    const sentTo = to.map((p) => p.name);
    await ref.update({ emailedTo: sentTo, emailedOn: localDateKey(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_email', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: sentTo.join(', ') });
    return { sentTo };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});
