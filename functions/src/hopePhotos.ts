import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, requireStringArray, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg, canKeepAccounts } from './shared/permissions.js';
import { chatRole } from './shared/hopeChats.js';
import { contactsFor, plainName } from './pettyContacts.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { formatDateKey, localDateKey } from './shared/datetime.js';
import {
  canDeletePhotoReport, canSeeAllPhotoReports, canSeePhotoReport, canSendPhotoReport, isPhotoReportKind, MAX_PHOTO_FILES,
  PHOTO_FILE_MAX_BYTES, PHOTO_TEXT_MAX, PHOTO_TITLE_MAX, photoFileName, photoFilePath, photoFileTypeOf,
  canEditMessage, canPackageStory, canUnsay, canWriteInStory, cleanIncident, OPENING_ID, STORY_DOC_MAX_BYTES, STORY_FILES_MAX, STORY_PART_BYTES,
  STORY_TEXT_MAX, STORY_VIDEO_MAX_BYTES, storyStartEmail, type PhotoFile, type PhotoReport, type StoryMessage,
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

function mailer(): { transport: Transporter; from: string; test: string | undefined } | null {
  const from = letterheadFor({ type: 'ministry', name: '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : HOPE_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) return null;
  return { from, test, transport: test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } }) };
}
async function keepTestMail(test: string | undefined, info: unknown, tag: string) {
  if (!test) return;
  await mkdir(test, { recursive: true });
  await writeFile(join(test, `${Date.now()}-${tag}.json`), String((info as { message?: unknown }).message ?? ''));
}

const preview = (text: string, files: number) => (text.replace(/\s+/g, ' ').trim().slice(0, 90) || (files ? `📎 ${files} ${files === 1 ? 'file' : 'files'}` : ''));
/** A reply's file in Storage; the opening's files keep their "1" to "10" places. */
const replyFilePath = (orgId: string, reportId: string, key: string) => `hopePhotoReports/${orgId}/${reportId}/m/${key}`;
const partPath = (orgId: string, reportId: string, upload: string, i: number) => `hopePhotoReports/${orgId}/${reportId}/parts/${upload}/${i}`;
const KEY = /^[a-f0-9]{20}$/;
/** What the app shows of a message: a deleted one keeps only who took it out. */
const shownMessage = (id: string, m: StoryMessage) => (m.deleted
  ? { id, byUid: m.byUid, byName: m.byName, byRole: m.byRole, at: m.at, files: [], text: '', deleted: true, deletedByName: m.deletedByName, deletedAt: m.deletedAt }
  : { id, ...m });

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
export const hopePhotoReports = onCall({ invoker: 'public', memory: '1GiB', timeoutSeconds: 120, secrets: [HOPE_EMAIL_APP_PASSWORD] }, async (request) => {
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
    const at = new Date().toISOString();
    const incident = data.kind === 'incident' ? cleanIncident(data.incident) : null;
    const doc: PhotoReport & Record<string, unknown> = {
      orgId, kind: data.kind, title, day, text, files: [], reportId, reportLabel,
      senderUid: caller.uid, senderName: myName, deleted: false,
      startedAt: at, senderRole: chatRole(me, orgId), lastAt: at, lastText: preview(text, 0) || title, lastByName: myName, replies: 0, seen: { [caller.uid]: at }, status: 'open',
      ...(incident ? { incident } : {}),
      createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    };
    await ref.set(doc);
    // Everyone else hears by email that a conversation has started (Andy, 2026-11-06); WhatsApp is the sender's one tap.
    const emailed: string[] = [];
    if (!reportId) {
      const m = mailer();
      if (!m) logger.warn('Hope photo reports: email is not set up.');
      else {
        for (const p of boardOf().filter((x) => plainName(x.name) !== plainName(myName) && EMAIL.test(x.email))) {
          const { subject, text: body } = storyStartEmail(doc, p.name.split(' ')[0] ?? p.name, `${appUrl()}/hope/photos?report=${ref.id}`, formatDateKey);
          try {
            const info = await m.transport.sendMail({ from: `"Freedom Hope Center" <${m.from}>`, replyTo: m.from, to: `"${p.name.replace(/"/g, '')}" <${p.email}>`, subject, text: body, ...(data.kind === 'incident' ? { priority: 'high' as const } : {}) });
            await keepTestMail(m.test, info, `hopestory-${ref.id}-${plainName(p.name)}`);
            emailed.push(p.name);
          } catch (err) { logger.warn(`Photo report email to ${p.email} failed`, err); }
        }
      }
    }
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_create', path: ref.path, collection: 'hopePhotoReports', docId: ref.id, orgId, note: `${data.kind}${emailed.length ? `, emailed ${emailed.length}` : ''}` });
    return { id: ref.id, emailed };
  }

  if (action === 'board') {
    if (!all) throw new HttpsError('permission-denied', 'Only the Director and the board send reports on.');
    return { people: boardOf().map(({ name, email, phone }) => ({ name, hasEmail: EMAIL.test(email), phone })) };
  }

  if (action === 'people') {
    // The people to tell on WhatsApp when a conversation starts: everyone but the sender.
    if (!canSendPhotoReport(me, orgId)) throw new HttpsError('permission-denied', 'You cannot send reports here.');
    return { people: boardOf().filter((p) => plainName(p.name) !== plainName(myName)).map(({ name, phone }) => ({ name, hasEmail: true, phone })) };
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
    const key = requireString(data.key, 'the file', { max: 40 });
    if (KEY.test(key)) {
      // A file sent in parts: the opening's or a reply's (not a deleted one). Big videos come back in parts.
      let f = r.files.find((x) => x.key === key);
      if (!f) {
        const holder = (await ref.collection('messages').where('fileKeys', 'array-contains', key).limit(1).get()).docs[0]?.data() as StoryMessage | undefined;
        f = holder && !holder.deleted ? holder.files.find((x) => x.key === key) : undefined;
      }
      if (!f) throw new HttpsError('not-found', 'This file was not found.');
      const part = Math.max(0, Math.floor(Number(data.part) || 0));
      const start = part * STORY_PART_BYTES;
      const [bytes] = await getStorage().bucket().file(replyFilePath(orgId, id, key)).download({ start, end: Math.min(f.size, start + STORY_PART_BYTES) - 1 });
      return { name: f.name, contentType: f.contentType, file: bytes.toString('base64'), parts: Math.max(1, Math.ceil(f.size / STORY_PART_BYTES)) };
    }
    const f = r.files.find((x) => x.key === key);
    if (!f) throw new HttpsError('not-found', 'This file was not found.');
    const [bytes] = await getStorage().bucket().file(photoFilePath(orgId, id, key)).download();
    return { name: f.name, contentType: f.contentType, file: bytes.toString('base64'), parts: 1 };
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

  const writer = canWriteInStory(me, caller.uid, r);
  const now = () => new Date().toISOString();

  if (action === 'messages') {
    const snap = await ref.collection('messages').orderBy('at').get();
    const messages = snap.docs.map((d) => shownMessage(d.id, d.data() as StoryMessage));
    const last = r.lastAt ?? r.startedAt ?? '';
    if (last && r.seen?.[caller.uid] !== last) await ref.update({ [`seen.${caller.uid}`]: last });
    return {
      report: shown(id, r), messages, me: caller.uid, writes: writer, keeps: canKeepAccounts(me), packages: canPackageStory(me, orgId),
      seesAll: all, deletes: deleter, now: Date.now(),
    };
  }

  if (action === 'uploadPart') {
    // A file goes up in parts of 5 MB, so a 50 MB video fits through calls of 10 MB (3A).
    if (!writer) throw new HttpsError('permission-denied', 'You cannot write in this conversation.');
    const upload = typeof data.upload === 'string' && KEY.test(data.upload) ? data.upload : randomUUID().replace(/-/g, '').slice(0, 20);
    const index = Math.floor(Number(data.index));
    if (!(index >= 0 && index < Math.ceil(STORY_VIDEO_MAX_BYTES / STORY_PART_BYTES))) throw new HttpsError('invalid-argument', 'That file is too big.');
    const bytes = Buffer.from(requireString(data.part, 'the file', { max: Math.ceil(STORY_PART_BYTES * 1.37) + 16 }), 'base64');
    if (bytes.length > STORY_PART_BYTES) throw new HttpsError('invalid-argument', 'That part is too big.');
    await getStorage().bucket().file(partPath(orgId, id, upload, index)).save(bytes, { resumable: false, metadata: { metadata: { uploader: caller.uid } } });
    return { upload };
  }

  if (action === 'uploadDone') {
    if (!writer) throw new HttpsError('permission-denied', 'You cannot write in this conversation.');
    const upload = typeof data.upload === 'string' && KEY.test(data.upload) ? data.upload : '';
    const parts = Math.floor(Number(data.parts));
    if (!upload || !(parts >= 1 && parts <= Math.ceil(STORY_VIDEO_MAX_BYTES / STORY_PART_BYTES))) throw new HttpsError('invalid-argument', 'The file did not arrive. Please add it again.');
    const name = typeof data.name === 'string' ? data.name.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) : '';
    const bucket = getStorage().bucket();
    const pieces = Array.from({ length: parts }, (_, i) => bucket.file(partPath(orgId, id, upload, i)));
    const metas = await Promise.all(pieces.map((f) => f.getMetadata().then(([m]) => m).catch(() => null)));
    if (metas.some((m) => !m || m.metadata?.uploader !== caller.uid)) throw new HttpsError('invalid-argument', 'The file did not arrive. Please add it again.');
    const size = metas.reduce((n, m) => n + Number(m?.size ?? 0), 0);
    const [head] = await pieces[0]!.download({ start: 0, end: 31 });
    const type = photoFileTypeOf(head, name);
    const clean = () => Promise.all(pieces.map((f) => f.delete().catch(() => undefined)));
    if (!type) { await clean(); throw new HttpsError('invalid-argument', 'Please send photos, videos, PDF, Word, Excel or PowerPoint files.'); }
    const max = type.video ? STORY_VIDEO_MAX_BYTES : type.photo ? PHOTO_FILE_MAX_BYTES : STORY_DOC_MAX_BYTES;
    if (size > max) { await clean(); throw new HttpsError('invalid-argument', `That file is larger than ${Math.round(max / 1048576)} MB.`); }
    const key = randomUUID().replace(/-/g, '').slice(0, 20);
    // The parts are joined here (at most 50 MB, well within the function's memory) and saved as one file.
    const whole = Buffer.concat(await Promise.all(pieces.map((f) => f.download().then(([b]) => b))));
    await bucket.file(replyFilePath(orgId, id, key)).save(whole, { contentType: type.contentType, resumable: false, metadata: { metadata: { uploader: caller.uid, ext: type.ext } } });
    await clean();
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || photoFileName(r.title, 1, type.ext).replace(/ 1\.[a-z0-9]+$/, '');
    const file: PhotoFile = { key, name: `${base}.${type.ext}`, contentType: type.contentType, size, photo: type.photo, ...(type.video ? { video: true } : {}) };
    return { file };
  }

  if (action === 'say') {
    if (!writer) throw new HttpsError('permission-denied', 'Only the Director, the sender, the board, Andy and Doreen write here.');
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, STORY_TEXT_MAX) : '';
    const wanted = Array.isArray(data.files) ? (data.files as PhotoFile[]).slice(0, STORY_FILES_MAX) : [];
    const bucket = getStorage().bucket();
    const files: PhotoFile[] = [];
    for (const f of wanted) {
      const key = typeof f?.key === 'string' && KEY.test(f.key) ? f.key : '';
      if (!key) continue;
      const [meta] = await bucket.file(replyFilePath(orgId, id, key)).getMetadata().catch(() => [null]);
      if (!meta || meta.metadata?.uploader !== caller.uid) throw new HttpsError('invalid-argument', 'A file could not be found. Please add it again.');
      const contentType = String(meta.contentType ?? 'application/octet-stream');
      files.push({ key, name: String(f.name ?? 'File').slice(0, 120), contentType, size: Number(meta.size ?? 0), photo: contentType.startsWith('image/'), ...(contentType.startsWith('video/') ? { video: true } : {}) });
    }
    if (data.opening === true) {
      // The opening's own photos, videos and files, added by the person who sent it.
      if (r.senderUid !== caller.uid) throw new HttpsError('permission-denied', 'Only the person who sent it adds files.');
      if (r.files.length + files.length > MAX_PHOTO_FILES) throw new HttpsError('failed-precondition', `A report takes up to ${MAX_PHOTO_FILES} files.`);
      if (files.length) await ref.update({ files: FieldValue.arrayUnion(...files), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      return { id: OPENING_ID, at: r.startedAt ?? '' };
    }
    if (!text && !files.length) throw new HttpsError('invalid-argument', 'Write a message or add a photo.');
    const at = now();
    const msg: StoryMessage & { fileKeys: string[] } = { text, byUid: caller.uid, byName: myName, byRole: chatRole(me, orgId), at, files, fileKeys: files.map((f) => f.key) };
    const mref = ref.collection('messages').doc();
    const batch = db.batch();
    batch.set(mref, msg);
    batch.update(ref, { lastAt: at, lastText: preview(text, files.length), lastByName: myName, replies: FieldValue.increment(1), [`seen.${caller.uid}`]: at, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await batch.commit();
    return { id: mref.id, at };
  }

  if (action === 'edit') {
    // Each person changes only their own words, at any time; the earlier words are kept (Andy, 2026-11-06).
    const mid = requireString(data.messageId, 'the message', { max: 40 });
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, mid === OPENING_ID ? PHOTO_TEXT_MAX : STORY_TEXT_MAX) : '';
    const at = now();
    if (mid === OPENING_ID) {
      if (r.senderUid !== caller.uid || r.deleted) throw new HttpsError('permission-denied', 'Only the person who wrote it changes it.');
      await ref.update({ text, editedAt: at, textHistory: FieldValue.arrayUnion({ text: r.text, at: r.editedAt ?? r.startedAt ?? '' }), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      return { ok: true };
    }
    const mref = ref.collection('messages').doc(mid);
    const m = (await mref.get()).data() as StoryMessage | undefined;
    if (!m) throw new HttpsError('not-found', 'This message was not found.');
    if (!canEditMessage(caller.uid, m)) throw new HttpsError('permission-denied', 'Only the person who wrote it changes it.');
    if (!text && !m.files.length) throw new HttpsError('invalid-argument', 'A message needs some words. To take it out, delete it instead.');
    await mref.update({ text, editedAt: at, history: FieldValue.arrayUnion({ text: m.text, at: m.editedAt ?? m.at }) });
    if (m.at === r.lastAt) await ref.update({ lastText: preview(text, m.files.length) });
    return { ok: true };
  }

  if (action === 'unsay') {
    // The writer takes a message out within five minutes; after that only Andy or Doreen (Andy, 2026-11-06).
    const mid = requireString(data.messageId, 'the message', { max: 40 });
    const mref = ref.collection('messages').doc(mid);
    const m = (await mref.get()).data() as StoryMessage | undefined;
    if (!m) throw new HttpsError('not-found', 'This message was not found.');
    if (!canUnsay(me, caller.uid, m)) {
      throw new HttpsError('permission-denied', m.byUid === caller.uid ? 'Five minutes have passed, so only Andy or Doreen can delete this message now. You can still change its words.' : 'Only Andy or Doreen delete other people\'s messages.');
    }
    await mref.update({ deleted: true, deletedByName: myName, deletedAt: now() });
    if (m.at === r.lastAt) await ref.update({ lastText: 'Message deleted' });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_message_delete', path: mref.path, collection: 'hopePhotoReports', docId: id, orgId, note: m.text.slice(0, 200) || undefined });
    return { ok: true };
  }

  if (action === 'decision') {
    if (!writer) throw new HttpsError('permission-denied', 'You cannot write in this conversation.');
    const mid = requireString(data.messageId, 'the message', { max: 40 });
    const mref = ref.collection('messages').doc(mid);
    const m = (await mref.get()).data() as StoryMessage | undefined;
    if (!m || m.deleted) throw new HttpsError('not-found', 'This message was not found.');
    await mref.update({ decision: data.on === true });
    return { ok: true };
  }

  if (action === 'package') {
    if (!canPackageStory(me, orgId) || r.deleted) throw new HttpsError('permission-denied', 'Only the Director, Andy or Doreen package a report for the board.');
    const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 3000) : '';
    await ref.update({ summary, packagedByName: myName, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { ok: true };
  }

  if (action === 'email') {
    // The packaged PDF to the chosen board members, by button only (6A).
    if (!canPackageStory(me, orgId) || r.deleted) throw new HttpsError('permission-denied', 'Only the Director, Andy or Doreen send the report to the board.');
    const names = new Set(requireStringArray(data.names, 'who to send to').map(plainName));
    const to = boardOf().filter((p) => names.has(plainName(p.name)) && EMAIL.test(p.email));
    if (!to.length) throw new HttpsError('invalid-argument', 'Please tick at least one person with an email address.');
    const pdf = Buffer.from(requireString(data.pdf, 'the PDF', { max: 14_000_000 }), 'base64');
    if (photoFileTypeOf(pdf)?.ext !== 'pdf') throw new HttpsError('invalid-argument', 'The report PDF could not be made.');
    const m = mailer();
    if (!m) throw new HttpsError('failed-precondition', 'Email is not set up for the Hope Center yet.');
    const orgName = String(org?.name || 'Freedom Hope Center');
    const label = r.kind === 'incident' ? 'Incident report' : 'Report';
    try {
      const info = await m.transport.sendMail({
        from: `"${orgName.replace(/"/g, '')}" <${m.from}>`, replyTo: m.from, to: to.map((p) => `"${p.name.replace(/"/g, '')}" <${p.email}>`).join(', '),
        subject: `${label}: ${r.title} (${orgName})`,
        text: [`Dear board,`, '', `Attached is the report "${r.title}" (${formatDateKey(r.day)}), sent by ${myName}.`, '', `Open the conversation in Insight-IQ: ${appUrl()}/hope/photos?report=${id}`, '', orgName].join('\n'),
        attachments: [{ filename: `${photoFileName(r.title, 1, 'pdf').replace(/ 1\.pdf$/, '')}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      await keepTestMail(m.test, info, `hopephoto-${id}`);
    } catch (err) {
      throw new HttpsError('unavailable', `The email could not be sent. ${err instanceof Error ? err.message.slice(0, 160) : ''}`);
    }
    const sentTo = to.map((p) => p.name);
    await ref.update({ emailedTo: sentTo, emailedOn: localDateKey(), status: 'sent', updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_email', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: sentTo.join(', ') });
    return { sentTo };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});
