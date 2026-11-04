import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { createStamps, updateStamps } from './records';
import { trackWrite } from './sync';
import { downloadFile } from './givingPdf';
import { TUTOR_FILE_MAX_BYTES, type FileKind } from '../../functions/src/shared/tutorFiles';

type Action = 'send' | 'download' | 'ask' | 'reopen' | 'approve' | 'sendBack' | 'roster';
export interface Tutor { uid: string; name: string; phone: string; courseIds: string[]; registerClasses: string[] }
const call = <R,>(data: Record<string, unknown> & { orgId: string; action: Action }) =>
  httpsCallable<typeof data, R>(functions, 'tutorFiles', { timeout: 120_000 })(data).then((r) => r.data);

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name} is not a picture this phone can read.`));
    img.src = URL.createObjectURL(file);
  });
}

/** Photos of a handwritten page become one PDF, a page per photo, shrunk so the file stays small (7A). */
export async function photosToPdf(files: File[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 0; i < files.length; i++) {
    const img = await loadImage(files[i]!);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const jpg = c.toDataURL('image/jpeg', 0.72);
    if (i) pdf.addPage();
    const pw = 210; const ph = 297; const m = 8;
    const r = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
    const w = c.width * r; const h = c.height * r;
    pdf.addImage(jpg, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
    URL.revokeObjectURL(img.src);
  }
  return pdf.output('blob');
}

const isPicture = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name);

/** Sends a requested file or a lesson plan. Pictures are turned into one PDF first. */
export async function sendTutorFile(orgId: string, target: { requestId: string } | { eventId: string }, files: File[]): Promise<{ late: boolean }> {
  if (!files.length) throw new Error('Choose a file first.');
  let blob: Blob;
  if (files.every(isPicture)) blob = await photosToPdf(files);
  else if (files.length === 1 && /\.(pdf|docx?)$/i.test(files[0]!.name)) blob = files[0]!;
  else throw new Error('Choose one PDF or Word file, or one or more photos.');
  if (blob.size > TUTOR_FILE_MAX_BYTES) throw new Error('That file is larger than 6 MB. Try fewer photos or a smaller file.');
  return call<{ late: boolean }>({ orgId, action: 'send', ...target, file: await toBase64(blob) });
}

export async function downloadTutorFile(orgId: string, fileId: string) {
  const r = await call<{ fileName: string; contentType: string; file: string }>({ orgId, action: 'download', fileId });
  const bytes = Uint8Array.from(atob(r.file), (c) => c.charCodeAt(0));
  downloadFile(new File([bytes], r.fileName, { type: r.contentType }));
}

export const askToChange = (orgId: string, fileId: string, reason: string) => call({ orgId, action: 'ask', fileId, reason });
export const reopenFile = (orgId: string, fileId: string, days: number) => call<{ until: string }>({ orgId, action: 'reopen', fileId, days });
export const approveFile = (orgId: string, fileId: string) => call({ orgId, action: 'approve', fileId });
export const sendBackFile = (orgId: string, fileId: string, note: string) => call({ orgId, action: 'sendBack', fileId, note });
export const loadTutors = (orgId: string) => call<{ tutors: Tutor[] }>({ orgId, action: 'roster' }).then((r) => r.tutors);

export function askForFile(orgId: string, input: { title: string; kind: FileKind; deadline: string; courseIds: string[]; note: string; createdByName: string }) {
  return trackWrite(addDoc(collection(db, 'organizations', orgId, 'fileRequests'), {
    orgId, ...input, title: input.title.trim().slice(0, 120), note: input.note.trim().slice(0, 500), createdByName: input.createdByName.slice(0, 120), ...createStamps(),
  }));
}

export function changeRequest(orgId: string, id: string, change: Partial<{ deadline: string; deletedAt: unknown; deletedBy: string | null }>) {
  return trackWrite(updateDoc(doc(db, 'organizations', orgId, 'fileRequests', id), { ...change, ...updateStamps() }));
}
