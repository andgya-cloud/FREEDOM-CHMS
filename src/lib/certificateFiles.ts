import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { CERTIFICATE_MAX_BYTES } from '../../functions/src/shared/certificateFiles';
import { downloadFile } from './givingPdf';

type Action = 'upload' | 'download' | 'email';
const call = (data: { orgId: string; studentId: string; action: Action; pdf?: string }) =>
  httpsCallable<typeof data, { size?: number; fileName?: string; pdf?: string; to?: string }>(functions, 'certificateFile', { timeout: 120_000 })(data).then((r) => r.data);

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Keeps a graduate's certificate PDF (replacing any earlier one). */
export async function uploadCertificate(orgId: string, studentId: string, file: File) {
  if (file.size > CERTIFICATE_MAX_BYTES) throw new Error('That PDF is larger than 5 MB.');
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
  await call({ orgId, studentId, action: 'upload', pdf: await toBase64(file) });
}

/** Saves the graduate's certificate to this device. */
export async function downloadCertificate(orgId: string, studentId: string) {
  const r = await call({ orgId, studentId, action: 'download' });
  const bytes = Uint8Array.from(atob(r.pdf ?? ''), (c) => c.charCodeAt(0));
  downloadFile(new File([bytes], r.fileName ?? 'Certificate.pdf', { type: 'application/pdf' }));
}

/** Sends the certificate to the student's own email from ADIA's Gmail. Returns the address. */
export async function emailCertificate(orgId: string, studentId: string) {
  return (await call({ orgId, studentId, action: 'email' })).to ?? '';
}
