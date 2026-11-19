import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { db, FieldValue, requireCaller, requireString, writeAudit } from './common.js';
import { can, canAccessOrg, isAttachmentKeeper } from './shared/permissions.js';
import { CERTIFICATE_MAX_BYTES, looksLikePdf } from './shared/certificateFiles.js';
import { attachmentFileName, attachmentPath, type AttachmentFileKind } from './shared/attachment.js';

/**
 * A student's industrial attachment copies (Andy, 2026-11-19, 6A 7A): the log book and the assessment form,
 * each a PDF (photos become PDFs on the phone first). "upload" keeps or replaces one, "download" hands it
 * back. Files sit in Storage, which the app cannot reach directly, so every read and write is checked here.
 */
export const attachmentFile = onCall({ invoker: 'public', memory: '512MiB' }, async (request) => {
  const caller = await requireCaller(request, undefined, { reviewerOk: (request.data as { action?: unknown } | null)?.action !== 'upload' });
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const studentId = requireString(data.studentId, 'the student', { max: 80 });
  const action = data.action === 'upload' ? 'upload' : 'download';
  const kind: AttachmentFileKind = data.kind === 'form' ? 'form' : 'logbook';
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const read = isAttachmentKeeper(caller.profile) || can(caller.profile, 'people.read') || can(caller.profile, 'attendance.write');
  if (action === 'upload' ? !isAttachmentKeeper(caller.profile) : !read) throw new HttpsError('permission-denied', 'Only the principal or an administrator can do that.');

  const [person, student] = await Promise.all([
    db.doc(`organizations/${orgId}/people/${studentId}`).get().then((s) => s.data() ?? {}),
    db.doc(`organizations/${orgId}/students/${studentId}`).get().then((s) => s.data()),
  ]);
  if (!student || student.deletedAt) throw new HttpsError('not-found', 'This student was not found.');
  const file = getStorage().bucket().file(attachmentPath(orgId, studentId, kind));
  const metaRef = db.doc(`organizations/${orgId}/attachmentFiles/${studentId}`);

  if (action === 'upload') {
    const b64 = requireString(data.pdf, 'the file', { max: Math.ceil(CERTIFICATE_MAX_BYTES * 1.4) });
    const bytes = Buffer.from(b64, 'base64');
    if (!looksLikePdf(bytes)) throw new HttpsError('invalid-argument', 'That file is not a PDF.');
    if (bytes.length > CERTIFICATE_MAX_BYTES) throw new HttpsError('invalid-argument', 'That file is larger than 5 MB.');
    await file.save(bytes, { contentType: 'application/pdf', resumable: false });
    await metaRef.set({ orgId, studentId, [kind]: { size: bytes.length, uploadedAt: FieldValue.serverTimestamp(), uploadedBy: caller.uid }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `attachment_${kind}_upload`, path: metaRef.path, collection: 'attachmentFiles', docId: studentId, orgId, note: `${bytes.length} bytes` });
    return { size: bytes.length };
  }

  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', kind === 'form' ? 'No assessment form has been uploaded for this student yet.' : 'No log book copy has been uploaded for this student yet.');
  const [bytes] = await file.download();
  const name = String(person.fullName || [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Student');
  return { fileName: attachmentFileName(name, (student.admissionNo as string | null | undefined) ?? null, kind), pdf: bytes.toString('base64') };
});
