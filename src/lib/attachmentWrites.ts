import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { downloadFile } from './givingPdf';
import { printFile } from './printFile';
import { isImage, photoToPdf, toBase64 } from './certificateFiles';
import { CERTIFICATE_MAX_BYTES } from '../../functions/src/shared/certificateFiles';
import { blankAttachment, type Attachment, type AttachmentFileKind } from '../../functions/src/shared/attachment';

const ref = (orgId: string, studentId: string) => doc(db, 'organizations', orgId, 'attachments', studentId);
/** Records started on this device, so a second quick change updates rather than starts again. */
const started = new Set<string>();

/**
 * Saves a change to a student's attachment (Andy, 2026-11-19). The first change starts the record with
 * everything else blank. Works offline, like the rest of School.
 */
export function saveAttachment(orgId: string, studentId: string, cohort: string, exists: boolean, changes: Partial<Attachment>) {
  const key = `${orgId}/${studentId}`;
  if (exists || started.has(key)) return updateRecord(ref(orgId, studentId), changes);
  started.add(key);
  return trackWrite(setDoc(ref(orgId, studentId), { ...blankAttachment(orgId, studentId, cohort), ...changes, ...createStamps() }));
}

type Payload = { orgId: string; studentId: string; action: 'upload' | 'download'; kind: AttachmentFileKind; pdf?: string };
const call = (data: Payload) =>
  httpsCallable<Payload, { size?: number; fileName?: string; pdf?: string }>(functions, 'attachmentFile', { timeout: 120_000 })(data).then((r) => r.data);

/** Keeps the log book or the assessment form, a PDF or a photo (replacing any earlier one). Needs the internet. */
export async function uploadAttachmentFile(orgId: string, studentId: string, kind: AttachmentFileKind, file: File) {
  if (!isImage(file) && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Please choose a PDF or a photo.');
  const pdf: Blob = isImage(file) ? await photoToPdf(file) : file;
  if (pdf.size > CERTIFICATE_MAX_BYTES) throw new Error('That file is larger than 5 MB.');
  await call({ orgId, studentId, action: 'upload', kind, pdf: await toBase64(pdf) });
}

async function fetchFile(orgId: string, studentId: string, kind: AttachmentFileKind) {
  const r = await call({ orgId, studentId, action: 'download', kind });
  const bytes = Uint8Array.from(atob(r.pdf ?? ''), (c) => c.charCodeAt(0));
  return new File([bytes], r.fileName ?? 'Attachment.pdf', { type: 'application/pdf' });
}

export async function downloadAttachmentFile(orgId: string, studentId: string, kind: AttachmentFileKind) {
  downloadFile(await fetchFile(orgId, studentId, kind));
}
export async function printAttachmentFile(orgId: string, studentId: string, kind: AttachmentFileKind) {
  printFile(await fetchFile(orgId, studentId, kind));
}
