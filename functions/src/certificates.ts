import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import nodemailer from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit } from './common.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import {
  CERTIFICATE_MAX_BYTES, certificateEmailHtml, certificateEmailSubject, certificateEmailText, certificateFileName, certificatePath, looksLikePdf,
} from './shared/certificateFiles.js';

// ADIA's Gmail and its app password, the same ones petty cash and Exam Records emails go from.
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');

/**
 * A graduate's certificate file (Andy, 2026-10-26, 4A-8A): "upload" keeps a PDF for a certificate that
 * has been issued, "download" hands it back, and "email" sends it to the student's own email from
 * ADIA's Gmail when someone presses Send to email. Files sit in Storage, which the app cannot reach
 * directly, so every read and write is checked here.
 */
export const certificateFile = onCall({ invoker: 'public', secrets: [PETTY_EMAIL_APP_PASSWORD], memory: '512MiB' }, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const studentId = requireString(data.studentId, 'the student', { max: 80 });
  const action = data.action === 'upload' ? 'upload' : data.action === 'email' ? 'email' : 'download';
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const manage = can(caller.profile, 'school.manage') || can(caller.profile, 'settings.manage');
  const read = manage || can(caller.profile, 'people.read') || can(caller.profile, 'attendance.write');
  if (action === 'download' ? !read : !manage) throw new HttpsError('permission-denied', 'Only the principal or an administrator can do that.');

  const certRef = db.doc(`organizations/${orgId}/certificates/${studentId}`);
  const cert = (await certRef.get()).data();
  if (!cert || cert.deletedAt) throw new HttpsError('failed-precondition', 'Issue the certificate first.');
  const file = getStorage().bucket().file(certificatePath(orgId, studentId));
  const [person, student] = await Promise.all([
    db.doc(`organizations/${orgId}/people/${studentId}`).get().then((s) => s.data() ?? {}),
    db.doc(`organizations/${orgId}/students/${studentId}`).get().then((s) => s.data() ?? {}),
  ]);
  const name = String(person.fullName || [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Graduate');
  const fileName = certificateFileName(name, student.admissionNo as string | null);

  if (action === 'upload') {
    const b64 = requireString(data.pdf, 'the file', { max: Math.ceil(CERTIFICATE_MAX_BYTES * 1.4) });
    const bytes = Buffer.from(b64, 'base64');
    if (!looksLikePdf(bytes)) throw new HttpsError('invalid-argument', 'That file is not a PDF.');
    if (bytes.length > CERTIFICATE_MAX_BYTES) throw new HttpsError('invalid-argument', 'That PDF is larger than 5 MB.');
    await file.save(bytes, { contentType: 'application/pdf', resumable: false });
    await certRef.update({ file: { size: bytes.length, uploadedAt: FieldValue.serverTimestamp(), uploadedBy: caller.uid }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'certificate_upload', path: certRef.path, collection: 'certificates', docId: studentId, orgId, note: `${bytes.length} bytes` });
    return { size: bytes.length };
  }

  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'No certificate has been uploaded for this graduate yet.');
  const [bytes] = await file.download();
  if (action === 'download') return { fileName, pdf: bytes.toString('base64') };

  const to = String(person.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpsError('failed-precondition', 'This student has no email address. Add one on their details first.');
  const last = (cert.emailedAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - last < 2 * 60_000) throw new HttpsError('already-exists', 'This was emailed a moment ago. Please wait a couple of minutes before sending again.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data() ?? {};
  const from = letterheadFor({ type: org.type as string, name: (org.name as string) ?? '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) throw new HttpsError('failed-precondition', 'Email is not set up for this organization.');
  const course = cert.courseId ? (await db.doc(`organizations/${orgId}/courses/${cert.courseId}`).get()).data() : undefined;
  const msg = { studentName: name, programme: String(course?.name ?? ''), serial: (cert.serial as string | undefined) ?? null };
  // In local tests the emails are written to files instead of being sent.
  const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  try {
    const info = await transport.sendMail({
      from: `"ADIA Training Centre" <${from}>`, to: `"${name.replace(/"/g, '')}" <${to}>`, replyTo: from,
      subject: certificateEmailSubject(msg), text: certificateEmailText(msg), html: certificateEmailHtml(msg),
      attachments: [{ filename: fileName, content: bytes, contentType: 'application/pdf' }],
    });
    if (test) {
      await mkdir(test, { recursive: true });
      await writeFile(join(test, `${Date.now()}-certificate-${studentId}.json`), String((info as { message?: unknown }).message ?? ''));
    }
  } catch (err) {
    logger.warn(`Certificate email for ${studentId} failed`, err);
    const e = err as { code?: string; responseCode?: number; message?: string };
    throw new HttpsError('unavailable', e?.code === 'EAUTH' || e?.responseCode === 535 ? 'Gmail refused the app password for ADIA\'s address.' : `The email could not be sent. Gmail said: ${String(e?.message ?? err).slice(0, 160)}`);
  }
  await certRef.update({ emailedAt: FieldValue.serverTimestamp(), emailedTo: to });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'certificate_email', path: certRef.path, collection: 'certificates', docId: studentId, orgId, note: `to ${to}` });
  return { to };
});
