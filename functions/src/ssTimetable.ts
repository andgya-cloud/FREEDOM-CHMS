import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { appUrl } from './circleKit.js';
import { canAccessOrg } from './shared/permissions.js';
import { localDateKey } from './shared/datetime.js';
import { ssEditor, SS_TEACHER_ROLE_ID } from './shared/circles.js';
import { cleanFileName, LESSON_CHUNK_BYTES, LESSON_MAX_BYTES, LESSON_MAX_PARTS } from './shared/lessonPlans.js';
import { phoneOfLogin } from './shared/phone.js';
import { loadChurch, loadSsClasses } from './serviceCounters.js';
import type { SsClass } from './shared/sundaySchool.js';
import {
  cleanDay, cleanLink, dayPlanned, groupReminderText, isDateKey, isSunday, nextYearDate, reminderText, seriesDates, ssDayLabel, ssFileType, sundayFrom,
  SS_DRIVE_FOLDER, SS_FIRST_DAY, SS_MAX_FILES, type SsDay, type SsFile,
} from './shared/ssTimetable.js';

/**
 * The Sunday school teaching timetable (Andy, 2026-11-24, 1A-10A). Every teacher reads it straight from the
 * database; every change comes through here, where only Dorothy, Andy and Doreen are let in. Files go up in 4 MB
 * pieces like the lesson plans, and anyone at the church downloads them.
 */
const UPLOAD_ID = /^[a-z0-9]{8,32}$/;
const bucket = () => getStorage().bucket();
const dayRef = (orgId: string, date: string) => db.doc(`organizations/${orgId}/ssTimetable/${date}`);
const settingsRef = (orgId: string) => db.doc(`organizations/${orgId}/sundaySchool/settings`);
const partPath = (orgId: string, uid: string, uploadId: string, n: number) => `ssParts/${orgId}/${uid}/${uploadId}/${n}`;
const filePath = (orgId: string, date: string, id: string) => `ssLessons/${orgId}/${date}/${id}`;

export async function driveFolderOf(orgId: string): Promise<string> {
  return String((await settingsRef(orgId).get()).get('driveFolder') || SS_DRIVE_FOLDER);
}

async function loadDay(orgId: string, date: string): Promise<SsDay | null> {
  const s = await dayRef(orgId, date).get();
  return s.exists ? (s.data() as SsDay) : null;
}

/** The Sunday the reminders are for: today on a Sunday, else the coming one. */
export const reminderSunday = (today: string) => sundayFrom(today);

type Teacher = { uid: string; name: string; phone: string; classId: string };
async function teachersOf(orgId: string): Promise<Teacher[]> {
  const snap = await db.collection('users').where('roleId', '==', SS_TEACHER_ROLE_ID).get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserProfile & { ssClassId?: string; allOrgs?: boolean }) }))
    .filter((u) => u.active && canAccessOrg(u, orgId) && u.ssClassId && u.ssClassId !== 'all')
    .map((u) => ({ uid: u.uid, name: u.displayName || '', phone: u.phone || phoneOfLogin(u.email), classId: String(u.ssClassId) }));
}

/** Who teaches each class on the day (6A) and their WhatsApp number, with the message ready (8A, 9A). */
export async function remindersFor(orgId: string, date: string, classes: SsClass[], day: SsDay | null) {
  const [teachers, drive] = await Promise.all([teachersOf(orgId), driveFolderOf(orgId)]);
  const first = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const app = appUrl();
  const list = classes.map((c) => {
    const who = day?.lessons[c.id]?.teacher || c.leader;
    // The stand-in by name among the teachers, else the class's own teacher.
    const t = (who && teachers.find((x) => first(x.name) === first(who))) || teachers.find((x) => x.classId === c.id) || null;
    const name = who || t?.name || '';
    return {
      classId: c.id, className: c.name, teacher: name, phone: t?.phone ?? '',
      text: reminderText({ first: name.split(/\s+/)[0] ?? '', day, date, className: c.name, classId: c.id, leader: c.leader, app, drive }),
    };
  });
  return { date, list, group: groupReminderText({ day, date, classes, app, drive }) };
}

export const ssTimetable = onCall({ memory: '1GiB', timeoutSeconds: 120, maxInstances: 10 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the church', { max: 60 });
  const action = String(data.action ?? '');
  const church = await loadChurch(orgId);
  const caller = await requireCaller(request, undefined, { reviewerOk: action === 'download' });
  const me = caller.profile;
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this church.');
  const today = localDateKey(new Date(), church.tz);
  const edits = ssEditor(me, orgId);
  const editorOnly = () => { if (!edits) throw new HttpsError('permission-denied', 'Only Dorothy, Andy and Doreen change the timetable.'); };
  const classes = await loadSsClasses(orgId);
  const ids = classes.map((c) => c.id);

  if (action === 'download') {
    const date = isDateKey(data.date) ? data.date : '';
    const day = date ? await loadDay(orgId, date) : null;
    const item = day?.files?.find((f) => f.id === data.itemId);
    if (!item) throw new HttpsError('not-found', 'This file is no longer on the timetable.');
    const start = Math.max(0, Math.floor(Number(data.start) || 0));
    if (start >= item.size) return { name: item.name, contentType: item.contentType, size: item.size, data: '' };
    const end = Math.min(item.size, start + LESSON_CHUNK_BYTES) - 1;
    const [bytes] = await bucket().file(filePath(orgId, date, item.id)).download({ start, end });
    return { name: item.name, contentType: item.contentType, size: item.size, data: bytes.toString('base64') };
  }

  if (action === 'reminders') {
    editorOnly();
    const date = isDateKey(data.date) ? data.date : reminderSunday(today);
    return remindersFor(orgId, date, classes, await loadDay(orgId, date));
  }

  editorOnly();
  const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid, updatedByName: me.displayName || me.email };
  const audit = (what: string, docId: string, note?: string) => writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `ss_timetable_${what}`, path: `organizations/${orgId}/ssTimetable/${docId}`, collection: 'ssTimetable', docId, orgId, ...(note ? { note } : {}) });

  if (action === 'drive') {
    const link = cleanLink(data.link);
    if (data.link && !link) throw new HttpsError('invalid-argument', 'Paste the whole Google Drive link, starting with https://');
    await settingsRef(orgId).set({ driveFolder: link || SS_DRIVE_FOLDER, ...stamp }, { merge: true });
    await audit('drive', 'settings');
    return { driveFolder: link || SS_DRIVE_FOLDER };
  }

  if (action === 'save') {
    const day = cleanDay(data.day, ids);
    if (!day.date || day.date < SS_FIRST_DAY) throw new HttpsError('invalid-argument', 'Pick a date from December 2026 on.');
    if (day.kind === 'special' && !day.title) throw new HttpsError('invalid-argument', 'Give the event a name, e.g. Vacation Bible School or Midweek class.');
    const ref = dayRef(orgId, day.date);
    // A day moved to another date on the calendar (Andy, 2026-11-24): its files go with it.
    const moveFrom = isDateKey(data.moveFrom) && data.moveFrom !== day.date ? data.moveFrom : '';
    if (moveFrom) {
      const old = await loadDay(orgId, moveFrom);
      if (old) {
        if (await loadDay(orgId, day.date)) throw new HttpsError('already-exists', `${ssDayLabel(day.date)} already has something on the timetable. Pick another date, or change that day.`);
        const files = old.files ?? [];
        await Promise.all(files.map((f) => bucket().file(filePath(orgId, moveFrom, f.id)).copy(bucket().file(filePath(orgId, day.date, f.id)))));
        await ref.set({ ...day, files, orgId, ...stamp, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
        await dayRef(orgId, moveFrom).delete();
        await Promise.all(files.map((f) => bucket().file(filePath(orgId, moveFrom, f.id)).delete({ ignoreNotFound: true })));
        await audit('move', day.date, `from ${moveFrom}`);
        return { date: day.date };
      }
    }
    const before = await loadDay(orgId, day.date);
    if (!dayPlanned({ ...day, files: before?.files ?? [] })) {
      if (before) await ref.delete();
      await audit('clear', day.date);
      return { date: day.date, removed: true };
    }
    await ref.set({ ...day, files: before?.files ?? [], orgId, ...stamp, ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }) });
    await audit('save', day.date);
    return { date: day.date };
  }

  if (action === 'remove') {
    const date = isDateKey(data.date) ? data.date : '';
    const before = date ? await loadDay(orgId, date) : null;
    if (!before) return { ok: true };
    await Promise.all((before.files ?? []).map((f) => bucket().file(filePath(orgId, date, f.id)).delete({ ignoreNotFound: true })));
    await dayRef(orgId, date).delete();
    await audit('remove', date);
    return { ok: true };
  }

  // A series in one go (7A): the next `weeks` Sundays with Sunday school get the series name, and "Week n" as the
  // theme where no theme is typed yet. Lessons already planned are kept.
  if (action === 'fill') {
    const start = isDateKey(data.start) ? data.start : '';
    const series = String(data.series ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const weeks = Math.floor(Number(data.weeks));
    if (!start || start < SS_FIRST_DAY || !series || !(weeks >= 1 && weeks <= 52)) throw new HttpsError('invalid-argument', 'Type the series name, the first Sunday and how many Sundays.');
    const span = await db.collection(`organizations/${orgId}/ssTimetable`).where('date', '>=', start).where('date', '<=', `${Number(start.slice(0, 4)) + 2}-01-01`).get();
    const existing = new Map(span.docs.map((d) => [d.id, d.data() as SsDay]));
    const noClass = new Set([...existing.values()].filter((d) => d.noClass).map((d) => d.date));
    const dates = seriesDates(start, weeks, noClass);
    const batch = db.batch();
    dates.forEach((date, i) => {
      const before = existing.get(date);
      const theme = before?.theme || `${series}: week ${i + 1}`;
      batch.set(dayRef(orgId, date), {
        date, kind: 'sunday', title: before?.title ?? '', noClass: false, theme, series, note: before?.note ?? '', time: before?.time ?? '', link: before?.link ?? '',
        lessons: before?.lessons ?? {}, files: before?.files ?? [], orgId, ...stamp, ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid }),
      });
    });
    await batch.commit();
    await audit('fill', dates[0]!, `${series}, ${dates.length} Sundays`);
    return { dates };
  }

  // Copy last year (7A): each planned day moves to the same Sunday a year on. Days already planned there are kept;
  // files stay with the old year (they are in the Drive folder or can be uploaded again).
  if (action === 'copyYear') {
    const from = Math.floor(Number(data.from));
    if (!(from >= 2026 && from <= 2100)) throw new HttpsError('invalid-argument', 'Pick the year to copy.');
    const src = await db.collection(`organizations/${orgId}/ssTimetable`).where('date', '>=', `${from}-01-01`).where('date', '<=', `${from}-12-31`).get();
    const dst = await db.collection(`organizations/${orgId}/ssTimetable`).where('date', '>=', `${from + 1}-01-01`).where('date', '<=', `${from + 1}-12-31`).get();
    const taken = new Set(dst.docs.map((d) => d.id));
    const batch = db.batch();
    let copied = 0;
    for (const d of src.docs) {
      const day = d.data() as SsDay;
      // Sundays move to the Sunday 52 weeks on; a special day keeps its calendar date if it stays in the next year.
      const date = day.kind === 'sunday' || isSunday(day.date) ? nextYearDate(day.date) : `${from + 1}${day.date.slice(4)}`;
      if (!date.startsWith(String(from + 1)) || taken.has(date) || !isDateKey(date)) continue;
      batch.set(dayRef(orgId, date), { ...cleanDay({ ...day, date }, ids), files: [], orgId, ...stamp, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
      copied += 1;
    }
    if (copied) await batch.commit();
    await audit('copy_year', `${from + 1}`, `${copied} days from ${from}`);
    return { copied };
  }

  if (action === 'part') {
    const uploadId = requireString(data.uploadId, 'the upload', { max: 32 });
    const n = Number(data.n);
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(n) || n < 0 || n >= LESSON_MAX_PARTS) throw new HttpsError('invalid-argument', 'This upload is not valid.');
    const bytes = Buffer.from(requireString(data.data, 'the file', { max: Math.ceil(LESSON_CHUNK_BYTES * 1.37) + 16 }), 'base64');
    if (bytes.length > LESSON_CHUNK_BYTES) throw new HttpsError('invalid-argument', 'This piece is too large.');
    await bucket().file(partPath(orgId, caller.uid, uploadId, n)).save(bytes, { resumable: false, contentType: 'application/octet-stream' });
    return { ok: true };
  }

  if (action === 'addFile') {
    const date = isDateKey(data.date) ? data.date : '';
    const classId = typeof data.classId === 'string' && ids.includes(data.classId) ? data.classId : '';
    const uploadId = requireString(data.uploadId, 'the upload', { max: 32 });
    const parts = Number(data.parts);
    const name = cleanFileName(requireString(data.name, 'the file name', { max: 200 }));
    if (!date || date < SS_FIRST_DAY) throw new HttpsError('invalid-argument', 'Pick a day on the timetable first.');
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(parts) || parts < 1 || parts > LESSON_MAX_PARTS) throw new HttpsError('invalid-argument', 'This upload is not valid.');
    const before = await loadDay(orgId, date);
    if ((before?.files?.length ?? 0) >= SS_MAX_FILES) throw new HttpsError('failed-precondition', `A day holds up to ${SS_MAX_FILES} files. Remove one first, or put the rest in the Google Drive folder.`);
    const pieces = Array.from({ length: parts }, (_, n) => bucket().file(partPath(orgId, caller.uid, uploadId, n)));
    const cleanup = () => Promise.all(pieces.map((p) => p.delete({ ignoreNotFound: true }))).catch((err) => logger.warn('Timetable pieces not removed', err));
    try {
      const sizes = await Promise.all(pieces.map((p) => p.getMetadata().then(([m]) => Number(m.size)).catch(() => -1)));
      if (sizes.some((s) => s < 0)) throw new HttpsError('failed-precondition', 'Part of the file did not arrive. Please try again.');
      const size = sizes.reduce((a, b) => a + b, 0);
      if (size > LESSON_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 20 MB. Put it in the Google Drive folder and paste its link instead.');
      const whole = Buffer.concat(await Promise.all(pieces.map((p) => p.download().then(([b]) => b))));
      const type = ssFileType(name, /\.(txt|csv)$/i.test(name) ? whole : whole.subarray(0, 32));
      if (!type) throw new HttpsError('invalid-argument', 'This file is not a PDF, Word, PowerPoint, Excel, photo, video or song.');
      const id = randomBytes(8).toString('hex');
      await bucket().file(filePath(orgId, date, id)).save(whole, { resumable: false, contentType: type.contentType });
      const item: SsFile = { id, name, contentType: type.contentType, size, classId, uploadedOn: today };
      if (before) await dayRef(orgId, date).update({ files: FieldValue.arrayUnion(item), ...stamp });
      else {
        await dayRef(orgId, date).set({
          ...cleanDay({ date }, ids), files: [item], orgId, ...stamp, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid,
        });
      }
      await audit('file_add', date, `${name}, ${size} bytes`);
      return { item };
    } finally { await cleanup(); }
  }

  if (action === 'removeFile') {
    const date = isDateKey(data.date) ? data.date : '';
    const before = date ? await loadDay(orgId, date) : null;
    const item = before?.files?.find((f) => f.id === data.itemId);
    if (!before || !item) return { ok: true };
    await bucket().file(filePath(orgId, date, item.id)).delete({ ignoreNotFound: true });
    const files = before.files.filter((f) => f.id !== item.id);
    if (!dayPlanned({ ...before, files })) await dayRef(orgId, date).delete();
    else await dayRef(orgId, date).update({ files, ...stamp });
    await audit('file_remove', date, item.name);
    return { ok: true };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});
