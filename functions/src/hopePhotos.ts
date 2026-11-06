import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuth } from 'firebase-admin/auth';
import { proofAge } from './directorProof.js';
import { classOf } from './shared/hopeClasses.js';
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
  APPROVAL_LABELS, APPROVAL_PROOF_MINUTES, canApprove, canRemoveFiles, faceKey, FOLLOW_UP_HOURS, isHopeDirector, isStoryStatus, needsFollowUpReminder,
  STORY_CHILDREN_MAX, STORY_STATUS_LABELS, storyRef, type ApprovalSlot, type RemovedFile, type StoryChild,
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
/** The next report number for this year, "FHC-2026-014" (v193, 4A). */
async function nextRef(orgId: string): Promise<string> {
  const year = Number(localDateKey().slice(0, 4));
  const counter = db.doc(`organizations/${orgId}/counters/hopePhotoReports`);
  const n = await db.runTransaction(async (tx) => {
    const c = (await tx.get(counter)).data() as { year?: number; n?: number } | undefined;
    const next = c?.year === year ? (c.n ?? 0) + 1 : 1;
    tx.set(counter, { year, n: next });
    return next;
  });
  return storyRef(year, n);
}

/** The children named in a message (2A), checked and kept as they are today: name, HC code and class. */
async function childrenOf(orgId: string, ids: unknown): Promise<StoryChild[]> {
  const list = [...new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,120}$/.test(x)) : [])].slice(0, STORY_CHILDREN_MAX);
  if (!list.length) return [];
  const today = localDateKey();
  const out: StoryChild[] = [];
  for (const cid of list) {
    const [c, p] = await Promise.all([db.doc(`organizations/${orgId}/children/${cid}`).get(), db.doc(`organizations/${orgId}/people/${cid}`).get()]);
    if (!c.exists || c.data()?.deletedAt) continue;
    const person = p.data() ?? {};
    out.push({ id: cid, name: String(person.fullName ?? 'Child'), code: String(c.data()?.code ?? ''), className: classOf(person.dateOfBirth as string | null, today)?.name ?? '' });
  }
  return out;
}

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
    const children = await childrenOf(orgId, data.childIds);
    const number = await nextRef(orgId);
    const doc: PhotoReport & Record<string, unknown> = {
      ref: number, seenNames: { [caller.uid]: myName }, ...(children.length ? { children } : {}),
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
    return { id: ref.id, emailed, ref: number };
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

  if (action === 'faces') {
    // The stakeholders' photos (3A), by plain name.
    const snap = await db.collection('stakeholderFaces').get();
    return { faces: Object.fromEntries(snap.docs.map((d) => [d.id, String(d.data().photo ?? '')])) };
  }

  if (action === 'setFace') {
    // Each person adds their own photo; Andy and Doreen can set anyone's on the board list (3A).
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : myName;
    const key = faceKey(name);
    if (!key) throw new HttpsError('invalid-argument', 'Whose photo is it?');
    if (key !== faceKey(myName)) {
      if (!canKeepAccounts(me)) throw new HttpsError('permission-denied', 'Only Andy and Doreen set other people\'s photos.');
      if (!boardOf().some((p) => faceKey(p.name) === key)) throw new HttpsError('invalid-argument', 'That name is not on the list.');
    }
    const photo = data.photo;
    if (photo === null) { await db.doc(`stakeholderFaces/${key}`).delete(); return { ok: true }; }
    if (typeof photo !== 'string' || photo.length > 200_000 || !photo.startsWith('data:image/jpeg;base64,')) throw new HttpsError('invalid-argument', 'The photo is too big or not a picture.');
    await db.doc(`stakeholderFaces/${key}`).set({ name, photo, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { ok: true };
  }

  if (action === 'children') {
    // The children to name in a message (2A): name, HC code and class only.
    if (!canSendPhotoReport(me, orgId) && !all) throw new HttpsError('permission-denied', 'You cannot write here.');
    const today = localDateKey();
    const kids = (await db.collection(`organizations/${orgId}/children`).get()).docs.filter((d) => !d.data().deletedAt && d.data().status !== 'left');
    const people = kids.length ? await db.getAll(...kids.map((d) => db.doc(`organizations/${orgId}/people/${d.id}`))) : [];
    const names = new Map(people.map((p) => [p.id, p.data() ?? {}]));
    return {
      children: kids.map((d) => {
        const p = names.get(d.id) ?? {};
        return { id: d.id, name: String(p.fullName ?? ''), code: String(d.data().code ?? ''), className: classOf(p.dateOfBirth as string | null, today)?.name ?? '' };
      }).filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name)),
    };
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
      if (!f && canRemoveFiles(me)) f = r.removed?.find((x) => x.file.key === key)?.file;
      if (!f) throw new HttpsError('not-found', 'This file was not found.');
      const part = Math.max(0, Math.floor(Number(data.part) || 0));
      const start = part * STORY_PART_BYTES;
      const [bytes] = await getStorage().bucket().file(replyFilePath(orgId, id, key)).download({ start, end: Math.min(f.size, start + STORY_PART_BYTES) - 1 });
      return { name: f.name, contentType: f.contentType, file: bytes.toString('base64'), parts: Math.max(1, Math.ceil(f.size / STORY_PART_BYTES)) };
    }
    const f = r.files.find((x) => x.key === key) ?? (canRemoveFiles(me) ? r.removed?.find((x) => x.file.key === key)?.file : undefined);
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
    const change: Record<string, unknown> = {};
    if (last && r.seen?.[caller.uid] !== last) { change[`seen.${caller.uid}`] = last; change[`seenNames.${caller.uid}`] = myName; }
    if (!r.ref && !r.deleted) { r.ref = await nextRef(orgId); change.ref = r.ref; }
    if (Object.keys(change).length) await ref.update(change);
    if (last) { r.seen = { ...r.seen, [caller.uid]: last }; r.seenNames = { ...r.seenNames, [caller.uid]: myName }; }
    // The children's photos (only those with photo consent have one) and the stakeholders' photos.
    const kidIds = [...new Set([...(r.children ?? []), ...messages.flatMap((m) => ('children' in m && m.children) || [])].map((c) => c.id))];
    const kidPhotos = kidIds.length ? await db.getAll(...kidIds.map((k) => db.doc(`organizations/${orgId}/childPhotos/${k}`))) : [];
    const faces = (await db.collection('stakeholderFaces').get()).docs;
    return {
      childPhotos: Object.fromEntries(kidPhotos.filter((d) => d.exists).map((d) => [d.id, String(d.data()?.photo ?? '')])),
      faces: Object.fromEntries(faces.map((d) => [d.id, String(d.data().photo ?? '')])),
      removes: canRemoveFiles(me), approves: { director: canApprove(me, orgId, 'director'), board: canApprove(me, orgId, 'board') },
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
    const children = await childrenOf(orgId, data.childIds);
    if (!text && !files.length && !children.length) throw new HttpsError('invalid-argument', 'Write a message or add a photo.');
    const at = now();
    const msg: StoryMessage & { fileKeys: string[] } = { text, byUid: caller.uid, byName: myName, byRole: chatRole(me, orgId), at, files, fileKeys: files.map((f) => f.key), ...(children.length ? { children } : {}) };
    const mref = ref.collection('messages').doc();
    const batch = db.batch();
    batch.set(mref, msg);
    batch.update(ref, { lastAt: at, lastText: preview(text, files.length) || `👧 ${children.map((c) => c.name.split(' ')[0]).join(', ')}`, lastByName: myName, replies: FieldValue.increment(1), [`seen.${caller.uid}`]: at, [`seenNames.${caller.uid}`]: myName, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
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
    if (m.system || !canEditMessage(caller.uid, m)) throw new HttpsError('permission-denied', 'Only the person who wrote it changes it.');
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
    if (m.system) throw new HttpsError('permission-denied', 'This line is part of the record.');
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

  /** A line the app writes in the conversation itself. */
  async function systemLine(text: string, extra: Record<string, unknown> = {}) {
    const at = now();
    const batch = db.batch();
    batch.set(ref.collection('messages').doc(), { text, byUid: caller.uid, byName: myName, byRole: chatRole(me, orgId), at, files: [], system: true } satisfies StoryMessage);
    batch.update(ref, { ...extra, lastAt: at, lastText: text.slice(0, 90), lastByName: myName, [`seen.${caller.uid}`]: at, [`seenNames.${caller.uid}`]: myName, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await batch.commit();
  }

  if (action === 'removeFile' || action === 'restoreFile') {
    // Andy and Doreen take out any photo or file; it is kept with who did it, and can be put back (v193, 1A).
    if (!canRemoveFiles(me)) throw new HttpsError('permission-denied', 'Only Andy and Doreen take out photos.');
    const key = requireString(data.key, 'the file', { max: 40 });
    const at = now();
    if (action === 'removeFile') {
      let messageId = OPENING_ID;
      let file = r.files.find((f) => f.key === key);
      if (file) await ref.update({ files: r.files.filter((f) => f.key !== key) });
      else {
        const holder = (await ref.collection('messages').where('fileKeys', 'array-contains', key).limit(1).get()).docs[0];
        const m = holder?.data() as (StoryMessage & { fileKeys?: string[] }) | undefined;
        file = m?.files.find((f) => f.key === key);
        if (!holder || !m || !file) throw new HttpsError('not-found', 'This file was not found.');
        messageId = holder.id;
        await holder.ref.update({ files: m.files.filter((f) => f.key !== key) });
      }
      const entry: RemovedFile = { messageId, file, removedByName: myName, removedAt: at };
      await ref.update({ removed: FieldValue.arrayUnion(entry), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_file_remove', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: file.name });
      return { ok: true };
    }
    const entry = r.removed?.find((x) => x.file.key === key);
    if (!entry) throw new HttpsError('not-found', 'This file was not found.');
    if (entry.messageId === OPENING_ID) await ref.update({ files: FieldValue.arrayUnion(entry.file) });
    else await ref.collection('messages').doc(entry.messageId).update({ files: FieldValue.arrayUnion(entry.file) });
    await ref.update({ removed: (r.removed ?? []).filter((x) => x.file.key !== key), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_file_restore', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: entry.file.name });
    return { ok: true };
  }

  if (action === 'status') {
    // Open → Under review → Resolved → Sent to the board (6A); the change is written in the conversation.
    if (!canPackageStory(me, orgId) || r.deleted) throw new HttpsError('permission-denied', 'Only the Director, Andy or Doreen change the status.');
    if (!isStoryStatus(data.status) || data.status === 'sent') throw new HttpsError('invalid-argument', 'Please choose the status.');
    if ((r.status ?? 'open') === data.status) return { ok: true };
    await systemLine(`${myName} marked this ${STORY_STATUS_LABELS[data.status]}.`, { status: data.status });
    return { ok: true };
  }

  if (action === 'followUp') {
    if (!canPackageStory(me, orgId) || r.kind !== 'incident') throw new HttpsError('permission-denied', 'Only the Director, Andy or Doreen mark the follow-up.');
    const done = data.done !== false;
    await systemLine(done ? `${myName} marked the follow-up done.` : `${myName} marked the follow-up not done yet.`,
      done ? { followUpDoneAt: now(), followUpDoneByName: myName } : { followUpDoneAt: FieldValue.delete(), followUpDoneByName: FieldValue.delete() });
    return { ok: true };
  }

  if (action === 'approve') {
    // The Director's and the board's approval, each with that person's own password (7A), printed on the PDF.
    const slot = data.slot === 'director' || data.slot === 'board' ? data.slot as ApprovalSlot : null;
    if (!slot || r.deleted) throw new HttpsError('invalid-argument', 'Please choose the approval.');
    if (!canApprove(me, orgId, slot)) throw new HttpsError('permission-denied', slot === 'director' ? 'Only the Director gives this approval.' : 'Only a board member, Andy or Doreen gives the board\'s approval.');
    const proof = typeof data.proof === 'string' && data.proof.startsWith('idtoken:') ? data.proof.slice(8) : '';
    const token = proof ? await getAuth().verifyIdToken(proof).catch(() => null) : null;
    if (!token || token.uid !== caller.uid || (await proofAge(token)) > APPROVAL_PROOF_MINUTES * 60) throw new HttpsError('permission-denied', 'The password could not be confirmed. Please type it again.');
    if (data.undo === true) {
      await systemLine(`${myName} took back the ${APPROVAL_LABELS[slot].toLowerCase()} approval.`, { [`approvals.${slot}`]: FieldValue.delete() });
      return { ok: true };
    }
    await systemLine(`✅ Approved by ${myName} (${APPROVAL_LABELS[slot]}).`, { [`approvals.${slot}`]: { name: myName, role: chatRole(me, orgId), at: now() } });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_approve', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: slot });
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
        subject: `${label}${r.ref ? ` ${r.ref}` : ''}: ${r.title} (${orgName})`,
        text: [`Dear board,`, '', `Attached is the report "${r.title}" (${formatDateKey(r.day)}), sent by ${myName}.`, '', `Open the conversation in Insight-IQ: ${appUrl()}/hope/photos?report=${id}`, '', orgName].join('\n'),
        attachments: [{ filename: `${photoFileName(r.title, 1, 'pdf').replace(/ 1\.pdf$/, '')}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      await keepTestMail(m.test, info, `hopephoto-${id}`);
    } catch (err) {
      throw new HttpsError('unavailable', `The email could not be sent. ${err instanceof Error ? err.message.slice(0, 160) : ''}`);
    }
    const sentTo = to.map((p) => p.name);
    await systemLine(`${myName} emailed the report to ${sentTo.join(', ')}.`, { emailedTo: sentTo, emailedOn: localDateKey(), status: 'sent' });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_photo_report_email', path: ref.path, collection: 'hopePhotoReports', docId: id, orgId, note: sentTo.join(', ') });
    return { sentTo };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

/**
 * The 48-hour incident reminder (v193, 8A): when an incident's follow-up has not been marked done two days after it
 * was reported, the Director gets one email (Andy and Doreen are copied) with the link. Checked every two hours.
 */
export async function sendFollowUpReminders(now = Date.now()): Promise<number> {
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  let sent = 0;
  for (const o of orgs.docs) {
    const snap = await db.collection(`organizations/${o.id}/hopePhotoReports`).where('kind', '==', 'incident').get();
    const due = snap.docs.filter((d) => needsFollowUpReminder(d.data() as PhotoReport, now));
    if (!due.length) continue;
    const users = (await db.collection('users').where('active', '==', true).get()).docs.map((d) => d.data() as UserProfile);
    const directors = users.filter((u) => isHopeDirector(u, o.id) && !u.allOrgs);
    const contacts = boardOf();
    const emailOf = (name: string, fallback: string) => contacts.find((c) => plainName(c.name) === plainName(name))?.email || fallback;
    const to = [...new Set(directors.map((u) => emailOf(u.displayName, u.email)).filter((e) => EMAIL.test(e)))];
    const cc = [...new Set(contacts.filter((c) => ['andrewguya', 'doreenmayaka'].includes(plainName(c.name))).map((c) => c.email).filter((e) => EMAIL.test(e)))];
    const m = mailer();
    if (!m || !to.length) { logger.warn('Incident reminders: no email or no Director address.'); continue; }
    for (const d of due) {
      const r = d.data() as PhotoReport;
      const link = `${appUrl()}/hope/photos?report=${d.id}`;
      try {
        const info = await m.transport.sendMail({
          from: `"Freedom Hope Center" <${m.from}>`, replyTo: m.from, to: to.join(', '), cc: cc.join(', '), priority: 'high',
          subject: `Reminder: follow-up for the incident ${r.ref ?? ''} "${r.title}"`.replace(/\s+/g, ' '),
          text: [
            'Dear Director,', '',
            `The incident "${r.title}" (${formatDateKey(r.day)}) was reported more than ${FOLLOW_UP_HOURS} hours ago and its follow-up is not marked done yet.`,
            r.incident?.followUp ? `Follow-up planned: ${r.incident.followUp}` : '', '',
            `Please open it, and tap "Follow-up done" when it is done: ${link}`, '', 'Freedom Hope Center',
          ].filter((x, i, a) => x || a[i - 1]).join('\n'),
        });
        await keepTestMail(m.test, info, `hopeincident-${d.id}`);
        await d.ref.update({ reminderSentAt: new Date(now).toISOString() });
        sent++;
      } catch (err) { logger.warn('Incident reminder failed', err); }
    }
  }
  return sent;
}

export const hopeIncidentReminders = onSchedule(
  { schedule: 'every 2 hours', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, memory: '256MiB', secrets: [HOPE_EMAIL_APP_PASSWORD] },
  async () => { await sendFollowUpReminders(); },
);
