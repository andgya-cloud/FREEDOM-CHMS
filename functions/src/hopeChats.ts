import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { proofAge } from './directorProof.js';
import { childrenOf } from './hopeKids.js';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, requireStringArray, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg } from './shared/permissions.js';
import { hopeBoardContacts, plainName } from './pettyContacts.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { localDateKey } from './shared/datetime.js';
import {
  APPROVAL_LABELS, APPROVAL_PROOF_MINUTES, canApprove, isHopeDirector, isSeverity, PHOTO_FILE_MAX_BYTES, photoFileName, photoFileTypeOf, SEVERITY_LABELS,
  STORY_DOC_MAX_BYTES, STORY_PART_BYTES, STORY_VIDEO_MAX_BYTES, type ApprovalSlot, type PhotoFile, type RemovedFile,
} from './shared/hopePhotos.js';
import {
  canCloseChat, canEditChatMessage, canRaiseWorry, canRemoveChatFiles, canUseChats, CHAT_FILES_MAX, CHAT_REPLY_HOURS, CHAT_STATUS_LABELS, CHAT_TEXT_MAX, chatFilePath,
  chatRef, chatRole, isChatStatus, isUnread, needsReplyReminder, urgentEmail, type ChatMessage, type HopeChat,
} from './shared/hopeChats.js';

const HOPE_EMAIL_APP_PASSWORD = defineSecret('HOPE_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const boardOf = () => hopeBoardContacts().map((c) => ({ name: c.name, email: c.email, phone: c.phone }));

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
const shown = (id: string, c: HopeChat) => ({ id, ...c, createdAt: undefined, updatedAt: undefined });
const KEY = /^[a-f0-9]{20}$/;
const partPath = (orgId: string, chatId: string, upload: string, i: number) => `hopeChats/${orgId}/${chatId}/parts/${upload}/${i}`;

/** The next conversation number for this year, "FHC-C-2026-007" (v197, 6A). */
async function nextChatRef(orgId: string): Promise<string> {
  const year = Number(localDateKey().slice(0, 4));
  const counter = db.doc(`organizations/${orgId}/counters/hopeChats`);
  const n = await db.runTransaction(async (tx) => {
    const c = (await tx.get(counter)).data() as { year?: number; n?: number } | undefined;
    const next = c?.year === year ? (c.n ?? 0) + 1 : 1;
    tx.set(counter, { year, n: next });
    return next;
  });
  return chatRef(year, n);
}

/**
 * Conversations about a child (Andy, 2026-11-04). Every read and write is checked here:
 * - "summary" (the urgent banner), "list" (the vault, or one child's), "messages" (opens one and marks it seen)
 * - "start" (the readers) or "raise" (staff who are worried), each with the first message; the others get an URGENT email
 * - "upload" a photo or file, then "send" a message with it; messages are never changed
 * - "status": Being handled (any reader), Closed with a note or Open again (the Director, Andy, Doreen)
 * - "file", "board" and "email" (the conversation's PDF to the chosen board members)
 * The old safeguarding notes are moved in the first time a reader opens the list (10A).
 */
export const hopeChats = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 120, secrets: [HOPE_EMAIL_APP_PASSWORD] }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as UserProfile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (org?.type !== 'ministry') throw new HttpsError('failed-precondition', 'Conversations are for the Hope Center.');
  const col = db.collection(`organizations/${orgId}/hopeChats`);
  const action = String(data.action ?? '');
  const reader = canUseChats(me, orgId);
  const myName = me.displayName || me.email;
  const myRole = chatRole(me, orgId);
  const now = () => new Date().toISOString();

  async function childOf(childId: string) {
    const [c, p] = await Promise.all([db.doc(`organizations/${orgId}/children/${childId}`).get(), db.doc(`organizations/${orgId}/people/${childId}`).get()]);
    if (!c.exists || c.data()?.deletedAt) throw new HttpsError('not-found', 'This child was not found.');
    return { childName: String(p.data()?.fullName ?? 'Child'), childCode: String(c.data()?.code ?? '') };
  }

  /** The URGENT email to everyone else on the board list (Andy: "notify the rest that their URGENT response is needed"). */
  async function notifyStart(chatId: string, c: HopeChat): Promise<string[]> {
    const m = mailer();
    if (!m) { logger.warn('Hope conversations: email is not set up.'); return []; }
    const to = boardOf().filter((p) => plainName(p.name) !== plainName(myName) && EMAIL.test(p.email));
    const sent: string[] = [];
    for (const p of to) {
      const { subject, text } = urgentEmail(c, p.name.split(' ')[0] ?? p.name, `${appUrl()}/hope/chats/${chatId}`);
      try {
        const info = await m.transport.sendMail({ from: `"Freedom Hope Center" <${m.from}>`, replyTo: m.from, to: `"${p.name.replace(/"/g, '')}" <${p.email}>`, subject, text, priority: 'high' });
        await keepTestMail(m.test, info, `hopechat-${chatId}-${plainName(p.name)}`);
        sent.push(p.name);
      } catch (err) { logger.warn(`Urgent conversation email to ${p.email} failed`, err); }
    }
    return sent;
  }

  /** Moves the old safeguarding notes into conversations, once each (10A). */
  async function moveOldNotes() {
    const old = await db.collection(`organizations/${orgId}/safeguardingConcerns`).get();
    for (const d of old.docs) {
      if (d.data().movedToChat) continue;
      const ref = col.doc(`concern_${d.id}`);
      if ((await ref.get()).exists) continue;
      const c = d.data();
      const who = c.createdBy ? (await db.doc(`users/${c.createdBy}`).get()).data() as UserProfile | undefined : undefined;
      let kid = { childName: 'Child', childCode: '' };
      try { kid = await childOf(String(c.childId)); } catch { /* the child was removed; keep the note */ }
      const at = (c.createdAt?.toDate?.() as Date | undefined)?.toISOString() ?? now();
      const byName = who?.displayName || who?.email || 'Staff member';
      const chat: HopeChat & Record<string, unknown> = {
        orgId, childId: String(c.childId), ...kid, status: c.status === 'closed' ? 'closed' : 'open', startedByUid: String(c.createdBy ?? ''), startedByName: byName,
        startedVia: 'staff', lastAt: at, lastText: preview(String(c.summary ?? ''), 0), lastByName: byName, messageCount: 1, seen: {}, fromConcernId: d.id,
        ...(c.status === 'closed' ? { closeNote: String(c.closingNote ?? ''), closedByName: 'Pastor', closedOn: localDateKey((c.closedAt?.toDate?.() as Date | undefined) ?? new Date()) } : {}),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      };
      const first: ChatMessage = { text: String(c.summary ?? ''), byUid: String(c.createdBy ?? ''), byName, byRole: who ? chatRole(who, orgId) : 'Staff', at, files: [] };
      const batch = db.batch();
      batch.set(ref, chat);
      batch.set(ref.collection('messages').doc(), first);
      if (c.status === 'closed') {
        batch.set(ref.collection('messages').doc(), { text: `Closed by the pastor${c.closingNote ? `: ${c.closingNote}` : '.'}`, byUid: '', byName: 'Pastor', byRole: 'Pastor', at: new Date(Date.parse(at) + 1000).toISOString(), files: [], system: true } satisfies ChatMessage);
      }
      // The old note is closed where it was, pointing to its conversation, so it no longer shows as open anywhere.
      if (c.status !== 'closed') batch.update(d.ref, { status: 'closed', closingNote: 'Moved to the conversations about this child.', movedToChat: ref.id });
      else batch.update(d.ref, { movedToChat: ref.id });
      await batch.commit();
    }
  }

  if (action === 'summary') {
    if (!reader) return { reader: false, urgent: 0, unread: 0 };
    const snap = await col.where('status', 'in', ['open', 'handling']).get();
    const rows = snap.docs.map((d) => d.data() as HopeChat);
    return {
      reader: true,
      urgent: rows.filter((c) => c.status === 'open' && !c.seen?.[caller.uid]).length,
      unread: rows.filter((c) => isUnread(c, caller.uid)).length,
    };
  }

  if (action === 'list') {
    const childId = typeof data.childId === 'string' && data.childId ? data.childId.slice(0, 120) : null;
    if (reader) await moveOldNotes();
    let q: FirebaseFirestore.Query = col;
    if (childId) q = q.where('childId', '==', childId);
    const rows = (await q.get()).docs.map((d) => shown(d.id, d.data() as HopeChat))
      .filter((c) => reader || c.startedByUid === caller.uid)
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    // Staff see only that they raised it and whether it is being dealt with, never the conversation.
    return {
      reader, closer: canCloseChat(me, orgId), raiser: canRaiseWorry(me, orgId),
      chats: reader ? rows : rows.map((c) => ({ id: c.id, childId: c.childId, childName: c.childName, childCode: c.childCode, status: c.status, lastAt: c.lastAt, startedByUid: c.startedByUid, startedByName: c.startedByName, startedVia: c.startedVia })),
    };
  }

  if (action === 'start' || action === 'raise') {
    if (action === 'start' ? !reader : !canRaiseWorry(me, orgId)) throw new HttpsError('permission-denied', 'You cannot start a conversation here.');
    const childId = requireString(data.childId, 'the child', { max: 120 });
    const text = requireString(data.text, 'the message', { max: CHAT_TEXT_MAX });
    const kid = await childOf(childId);
    const ref = col.doc();
    const at = now();
    const chat: HopeChat = {
      orgId, childId, ...kid, status: 'open', startedByUid: caller.uid, startedByName: myName, startedVia: reader ? 'board' : 'staff',
      lastAt: at, lastText: preview(text, 0), lastByName: myName, messageCount: 1, seen: reader ? { [caller.uid]: at } : {},
      ref: await nextChatRef(orgId), startedAt: at, seenNames: reader ? { [caller.uid]: myName } : {}, ...(isSeverity(data.severity) ? { severity: data.severity } : {}),
    };
    const batch = db.batch();
    batch.set(ref, { ...chat, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp() });
    batch.set(ref.collection('messages').doc(), { text, byUid: caller.uid, byName: myName, byRole: myRole, at, files: [] } satisfies ChatMessage);
    await batch.commit();
    const emailed = await notifyStart(ref.id, chat);
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `hope_chat_${action}`, path: ref.path, collection: 'hopeChats', docId: ref.id, orgId, note: `urgent email to ${emailed.length}` });
    return { id: ref.id, emailed };
  }

  if (action === 'board') {
    if (!reader) throw new HttpsError('permission-denied', 'Only the Director and the board send conversations on.');
    return { people: boardOf().map(({ name, email, phone }) => ({ name, hasEmail: EMAIL.test(email), phone })) };
  }

  const id = requireString(data.id, 'the conversation', { max: 120 });
  const ref = col.doc(id);
  const chat = (await ref.get()).data() as HopeChat | undefined;
  if (!chat) throw new HttpsError('not-found', 'This conversation was not found.');
  if (!reader) throw new HttpsError('permission-denied', 'Only the Director, the board, Andy and Doreen read conversations.');

  if (action === 'messages') {
    const msgs = (await ref.collection('messages').orderBy('at').get()).docs.map((d) => ({ id: d.id, ...(d.data() as ChatMessage) }));
    const change: Record<string, unknown> = {};
    if (chat.seen?.[caller.uid] !== chat.lastAt) { change[`seen.${caller.uid}`] = chat.lastAt; change[`seenNames.${caller.uid}`] = myName; }
    if (!chat.ref) { chat.ref = await nextChatRef(orgId); change.ref = chat.ref; }
    if (Object.keys(change).length) await ref.update(change);
    chat.seen = { ...chat.seen, [caller.uid]: chat.lastAt }; chat.seenNames = { ...chat.seenNames, [caller.uid]: myName };
    // The children's photos (the child it is about and any named, 3A) and the stakeholders' photos (1A).
    const kidIds = [...new Set([chat.childId, ...msgs.flatMap((m) => m.children ?? []).map((c) => c.id)])];
    const kidPhotos = await db.getAll(...kidIds.map((k) => db.doc(`organizations/${orgId}/childPhotos/${k}`)));
    const faces = (await db.collection('stakeholderFaces').get()).docs;
    return {
      chat: shown(id, chat), messages: msgs, closer: canCloseChat(me, orgId), me: caller.uid, keeps: canRemoveChatFiles(me),
      childPhotos: Object.fromEntries(kidPhotos.filter((d) => d.exists).map((d) => [d.id, String(d.data()?.photo ?? '')])),
      faces: Object.fromEntries(faces.map((d) => [d.id, String(d.data().photo ?? '')])),
      approves: { director: canApprove(me, orgId, 'director'), board: canApprove(me, orgId, 'board') },
    };
  }

  if (action === 'upload') {
    const b64 = requireString(data.file, 'the file', { max: Math.ceil(PHOTO_FILE_MAX_BYTES * 1.37) + 16 });
    const bytes = Buffer.from(b64, 'base64');
    const type = photoFileTypeOf(bytes);
    if (!type) throw new HttpsError('invalid-argument', 'Please send photos (JPG, PNG, WebP, HEIC), PDF or Word files.');
    if (bytes.length > PHOTO_FILE_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 4 MB.');
    const key = randomUUID().replace(/-/g, '').slice(0, 20);
    await getStorage().bucket().file(chatFilePath(orgId, id, 'f', key)).save(bytes, { contentType: type.contentType, resumable: false, metadata: { metadata: { uploader: caller.uid } } });
    const file: PhotoFile = { key, name: photoFileName(`${chat.childName} conversation`, 1, type.ext).replace(/ 1\./, `-${key.slice(0, 4)}.`), contentType: type.contentType, size: bytes.length, photo: type.photo };
    return { file };
  }

  if (action === 'uploadPart') {
    // Files go up in parts of 5 MB, so a 50 MB video fits (2A).
    const upload = typeof data.upload === 'string' && KEY.test(data.upload) ? data.upload : randomUUID().replace(/-/g, '').slice(0, 20);
    const index = Math.floor(Number(data.index));
    if (!(index >= 0 && index < Math.ceil(STORY_VIDEO_MAX_BYTES / STORY_PART_BYTES))) throw new HttpsError('invalid-argument', 'That file is too big.');
    const bytes = Buffer.from(requireString(data.part, 'the file', { max: Math.ceil(STORY_PART_BYTES * 1.37) + 16 }), 'base64');
    if (bytes.length > STORY_PART_BYTES) throw new HttpsError('invalid-argument', 'That part is too big.');
    await getStorage().bucket().file(partPath(orgId, id, upload, index)).save(bytes, { resumable: false, metadata: { metadata: { uploader: caller.uid } } });
    return { upload };
  }

  if (action === 'uploadDone') {
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
    const whole = Buffer.concat(await Promise.all(pieces.map((f) => f.download().then(([b]) => b))));
    await bucket.file(chatFilePath(orgId, id, 'f', key)).save(whole, { contentType: type.contentType, resumable: false, metadata: { metadata: { uploader: caller.uid, ext: type.ext } } });
    await clean();
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || `${chat.childName} conversation`;
    const file: PhotoFile = { key, name: `${base}.${type.ext}`, contentType: type.contentType, size, photo: type.photo, ...(type.video ? { video: true } : {}) };
    return { file };
  }

  if (action === 'send') {
    if (chat.status === 'closed') throw new HttpsError('failed-precondition', 'This conversation is closed. The Director, Andy or Doreen can open it again.');
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, CHAT_TEXT_MAX) : '';
    const wanted = Array.isArray(data.files) ? (data.files as PhotoFile[]).slice(0, CHAT_FILES_MAX) : [];
    const bucket = getStorage().bucket();
    const files: PhotoFile[] = [];
    for (const f of wanted) {
      const key = typeof f?.key === 'string' && /^[a-f0-9]{20}$/.test(f.key) ? f.key : '';
      if (!key) continue;
      const [meta] = await bucket.file(chatFilePath(orgId, id, 'f', key)).getMetadata().catch(() => [null]);
      if (!meta || meta.metadata?.uploader !== caller.uid) throw new HttpsError('invalid-argument', 'A file could not be found. Please add it again.');
      const contentType = String(meta.contentType ?? 'application/octet-stream');
      files.push({ key, name: String(f.name ?? 'File').slice(0, 120), contentType, size: Number(meta.size ?? 0), photo: contentType.startsWith('image/'), ...(contentType.startsWith('video/') ? { video: true } : {}) });
    }
    const children = await childrenOf(orgId, data.childIds);
    if (!text && !files.length && !children.length) throw new HttpsError('invalid-argument', 'Write a message or add a photo.');
    const at = now();
    const batch = db.batch();
    batch.set(ref.collection('messages').doc(), { text, byUid: caller.uid, byName: myName, byRole: myRole, at, files, fileKeys: files.map((f) => f.key), ...(children.length ? { children } : {}) } satisfies ChatMessage);
    batch.update(ref, {
      lastAt: at, lastText: preview(text, files.length) || `👧 ${children.map((c) => c.name.split(' ')[0]).join(', ')}`, lastByName: myName, messageCount: FieldValue.increment(1),
      [`seen.${caller.uid}`]: at, [`seenNames.${caller.uid}`]: myName, ...(caller.uid !== chat.startedByUid && !chat.repliedAt ? { repliedAt: at } : {}), updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { at };
  }

  if (action === 'file') {
    const key = requireString(data.key, 'the file', { max: 40 });
    const [bytes] = await getStorage().bucket().file(chatFilePath(orgId, id, 'f', key)).download().catch(() => { throw new HttpsError('not-found', 'This file was not found.'); });
    const [meta] = await getStorage().bucket().file(chatFilePath(orgId, id, 'f', key)).getMetadata();
    return { contentType: String(meta.contentType ?? ''), file: bytes.toString('base64') };
  }

  /** A line the app writes in the conversation itself. */
  async function systemLine(text: string, extra: Record<string, unknown> = {}) {
    const at = now();
    const batch = db.batch();
    batch.set(ref.collection('messages').doc(), { text, byUid: caller.uid, byName: myName, byRole: myRole, at, files: [], system: true } satisfies ChatMessage);
    batch.update(ref, { ...extra, lastAt: at, lastText: text.slice(0, 90), lastByName: myName, messageCount: FieldValue.increment(1), [`seen.${caller.uid}`]: at, [`seenNames.${caller.uid}`]: myName, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }

  if (action === 'edit') {
    // Each person changes only their own words; the earlier words are kept and listed in the PDF (4A).
    const mid = requireString(data.messageId, 'the message', { max: 40 });
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, CHAT_TEXT_MAX) : '';
    const mref = ref.collection('messages').doc(mid);
    const m = (await mref.get()).data() as ChatMessage | undefined;
    if (!m) throw new HttpsError('not-found', 'This message was not found.');
    if (!canEditChatMessage(caller.uid, m)) throw new HttpsError('permission-denied', 'Only the person who wrote it changes it.');
    if (!text && !m.files.length) throw new HttpsError('invalid-argument', 'A message needs some words.');
    if (text === m.text) return { ok: true };
    const at = now();
    await mref.update({ text, editedAt: at, history: FieldValue.arrayUnion({ text: m.text, at: m.editedAt ?? m.at }) });
    if (m.at === chat.lastAt) await ref.update({ lastText: preview(text, m.files.length) });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_chat_edit', path: mref.path, collection: 'hopeChats', docId: id, orgId, note: m.text.slice(0, 200) || undefined });
    return { ok: true };
  }

  if (action === 'removeFile' || action === 'restoreFile') {
    // Andy and Doreen take out any photo or file; it is kept with who did it, and can be put back (5A).
    if (!canRemoveChatFiles(me)) throw new HttpsError('permission-denied', 'Only Andy and Doreen take out files.');
    const key = requireString(data.key, 'the file', { max: 40 });
    if (action === 'removeFile') {
      let holder: FirebaseFirestore.QueryDocumentSnapshot | undefined = (await ref.collection('messages').where('fileKeys', 'array-contains', key).limit(1).get()).docs[0];
      // Older messages have no list of keys: look through them.
      if (!holder) holder = (await ref.collection('messages').get()).docs.find((d) => ((d.data() as ChatMessage).files ?? []).some((f) => f.key === key));
      const m = holder?.data() as ChatMessage | undefined;
      const file = m?.files.find((f) => f.key === key);
      if (!holder || !m || !file) throw new HttpsError('not-found', 'This file was not found.');
      await holder.ref.update({ files: m.files.filter((f) => f.key !== key) });
      const entry: RemovedFile = { messageId: holder.id, file, removedByName: myName, removedAt: now() };
      await ref.update({ removed: FieldValue.arrayUnion(entry), updatedAt: FieldValue.serverTimestamp() });
      await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_chat_file_remove', path: ref.path, collection: 'hopeChats', docId: id, orgId, note: file.name });
      return { ok: true };
    }
    const entry = chat.removed?.find((x) => x.file.key === key);
    if (!entry) throw new HttpsError('not-found', 'This file was not found.');
    await ref.collection('messages').doc(entry.messageId).update({ files: FieldValue.arrayUnion(entry.file) });
    await ref.update({ removed: (chat.removed ?? []).filter((x) => x.file.key !== key), updatedAt: FieldValue.serverTimestamp() });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_chat_file_restore', path: ref.path, collection: 'hopeChats', docId: id, orgId, note: entry.file.name });
    return { ok: true };
  }

  if (action === 'severity') {
    // Low, Medium or High (8A): any reader sets it; the change is written in the conversation.
    const sev = isSeverity(data.severity) ? data.severity : null;
    if (!sev) throw new HttpsError('invalid-argument', 'Please choose Low, Medium or High.');
    if (chat.severity === sev) return { ok: true };
    await systemLine(`${myName} set the urgency to ${SEVERITY_LABELS[sev]}.`, { severity: sev });
    return { ok: true };
  }

  if (action === 'approve') {
    // The Director's and the board's approval of the outcome, each with that person's own password (7A).
    const slot = data.slot === 'director' || data.slot === 'board' ? data.slot as ApprovalSlot : null;
    if (!slot) throw new HttpsError('invalid-argument', 'Please choose the approval.');
    if (!canApprove(me, orgId, slot)) throw new HttpsError('permission-denied', slot === 'director' ? 'Only the Director gives this approval.' : 'Only a board member, Andy or Doreen gives the board\'s approval.');
    const proof = typeof data.proof === 'string' && data.proof.startsWith('idtoken:') ? data.proof.slice(8) : '';
    const token = proof ? await getAuth().verifyIdToken(proof).catch(() => null) : null;
    if (!token || token.uid !== caller.uid || (await proofAge(token)) > APPROVAL_PROOF_MINUTES * 60) throw new HttpsError('permission-denied', 'The password could not be confirmed. Please type it again.');
    if (data.undo === true) {
      await systemLine(`${myName} took back the ${APPROVAL_LABELS[slot].toLowerCase()} approval.`, { [`approvals.${slot}`]: FieldValue.delete() });
      return { ok: true };
    }
    await systemLine(`✅ Approved by ${myName} (${APPROVAL_LABELS[slot]}).`, { [`approvals.${slot}`]: { name: myName, role: myRole, at: now() } });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_chat_approve', path: ref.path, collection: 'hopeChats', docId: id, orgId, note: slot });
    return { ok: true };
  }

  if (action === 'status') {
    if (!isChatStatus(data.status) || data.status === 'sent') throw new HttpsError('invalid-argument', 'Please choose the status.');
    const status = data.status;
    if (status !== 'handling' && !canCloseChat(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, Andy and Doreen close or reopen a conversation.');
    const note = typeof data.note === 'string' ? data.note.trim().slice(0, 1000) : '';
    if (status === 'closed' && !note) throw new HttpsError('invalid-argument', 'Please write a short note on how it was resolved.');
    const at = now();
    const line = status === 'closed' ? `${myName} marked this resolved: ${note}` : status === 'handling' ? `${myName} marked this as being handled.${note ? ` ${note}` : ''}` : `${myName} opened this conversation again.`;
    const batch = db.batch();
    batch.set(ref.collection('messages').doc(), { text: line, byUid: caller.uid, byName: myName, byRole: myRole, at, files: [], system: true } satisfies ChatMessage);
    batch.update(ref, {
      status, lastAt: at, lastText: `${CHAT_STATUS_LABELS[status]}`, lastByName: myName, messageCount: FieldValue.increment(1), [`seen.${caller.uid}`]: at, [`seenNames.${caller.uid}`]: myName,
      ...(status === 'closed' ? { closeNote: note, closedByName: myName, closedOn: localDateKey() } : { closeNote: FieldValue.delete(), closedByName: FieldValue.delete(), closedOn: FieldValue.delete() }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `hope_chat_${status}`, path: ref.path, collection: 'hopeChats', docId: id, orgId, note: note || undefined });
    return { ok: true };
  }

  if (action === 'email') {
    const names = new Set(requireStringArray(data.names, 'who to send to').map(plainName));
    const to = boardOf().filter((p) => names.has(plainName(p.name)) && EMAIL.test(p.email));
    if (!to.length) throw new HttpsError('invalid-argument', 'Please tick at least one person with an email address.');
    const pdf = Buffer.from(requireString(data.pdf, 'the PDF', { max: 14_000_000 }), 'base64');
    if (photoFileTypeOf(pdf)?.ext !== 'pdf') throw new HttpsError('invalid-argument', 'The conversation PDF could not be made.');
    const m = mailer();
    if (!m) throw new HttpsError('failed-precondition', 'Email is not set up for the Hope Center yet.');
    const child = `${chat.childName}${chat.childCode ? ` (${chat.childCode})` : ''}`;
    try {
      const info = await m.transport.sendMail({
        from: `"Freedom Hope Center" <${m.from}>`, replyTo: m.from, to: to.map((p) => `"${p.name.replace(/"/g, '')}" <${p.email}>`).join(', '),
        subject: `${chat.ref ? `${chat.ref} · ` : ''}Conversation about ${child} (${CHAT_STATUS_LABELS[chat.status]})`,
        text: [`Attached is the conversation about ${child}, sent by ${myName}.`, '', `Open it in Insight-IQ: ${appUrl()}/hope/chats/${id}`, '', 'Please keep it private.', '', 'Freedom Hope Center'].join('\n'),
        attachments: [{ filename: `Conversation - ${chat.childName.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      await keepTestMail(m.test, info, `hopechatpdf-${id}`);
    } catch (err) {
      throw new HttpsError('unavailable', `The email could not be sent. ${err instanceof Error ? err.message.slice(0, 160) : ''}`);
    }
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'hope_chat_email', path: ref.path, collection: 'hopeChats', docId: id, orgId, note: to.map((p) => p.name).join(', ') });
    // Once it has gone to the board, the status says so (6A).
    await systemLine(`${myName} sent this to the board: ${to.map((p) => p.name).join(', ')}.`, { status: 'sent' });
    return { sentTo: to.map((p) => p.name) };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

/**
 * The reply reminder (v197, 8A): a conversation that nobody else has answered a day after it started gets one email to
 * the Director (Andy and Doreen copied). Run with the incident reminders, every two hours.
 */
export async function sendChatReminders(now = Date.now()): Promise<number> {
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  let sent = 0;
  for (const o of orgs.docs) {
    const snap = await db.collection(`organizations/${o.id}/hopeChats`).where('status', 'in', ['open', 'handling']).get();
    const due = snap.docs.filter((d) => needsReplyReminder(d.data() as HopeChat, now));
    if (!due.length) continue;
    const users = (await db.collection('users').where('active', '==', true).get()).docs.map((d) => d.data() as UserProfile);
    const contacts = boardOf();
    const emailOf = (name: string, fallback: string) => contacts.find((c) => plainName(c.name) === plainName(name))?.email || fallback;
    const to = [...new Set(users.filter((u) => isHopeDirector(u, o.id) && !u.allOrgs).map((u) => emailOf(u.displayName, u.email)).filter((e) => EMAIL.test(e)))];
    const cc = [...new Set(contacts.filter((c) => ['andrewguya', 'doreenmayaka'].includes(plainName(c.name))).map((c) => c.email).filter((e) => EMAIL.test(e)))];
    const m = mailer();
    if (!m || !to.length) { logger.warn('Conversation reminders: no email or no Director address.'); continue; }
    for (const d of due) {
      const c = d.data() as HopeChat;
      const child = `${c.childName.split(' ')[0] || 'a child'}${c.childCode ? ` (${c.childCode})` : ''}`;
      try {
        const info = await m.transport.sendMail({
          from: `"Freedom Hope Center" <${m.from}>`, replyTo: m.from, to: to.join(', '), cc: cc.join(', '), priority: 'high',
          subject: `Reminder: no reply yet about ${child}${c.ref ? ` (${c.ref})` : ''}`,
          text: [
            'Dear Director,', '',
            `${c.startedByName} started a conversation about ${child} more than ${CHAT_REPLY_HOURS} hours ago and nobody has replied yet.`, '',
            `Please open it and reply: ${appUrl()}/hope/chats/${d.id}`, '',
            'For the child\'s safety, what was written is only in Insight-IQ, not in this email.', '', 'Freedom Hope Center',
          ].join('\n'),
        });
        await keepTestMail(m.test, info, `hopechat-reminder-${d.id}`);
        await d.ref.update({ reminderSentAt: new Date(now).toISOString() });
        sent++;
      } catch (err) { logger.warn('Conversation reminder failed', err); }
    }
  }
  return sent;
}
