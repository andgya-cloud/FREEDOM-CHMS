import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { CERTIFICATE_MAX_BYTES, type CertificateKind } from '../../functions/src/shared/certificateFiles';
import { downloadFile, newPdf } from './givingPdf';
import { printFile } from './printFile';

type Action = 'upload' | 'download' | 'email' | 'handover';
type Payload = { orgId: string; studentId: string; action: Action; pdf?: string; kind?: CertificateKind; on?: string | null };
const call = (data: Payload) =>
  httpsCallable<Payload, { size?: number; fileName?: string; pdf?: string; to?: string }>(functions, 'certificateFile', { timeout: 120_000 })(data).then((r) => r.data);

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const isImage = (f: File) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

/** A photo of a certificate becomes a one-page PDF on this device (Andy, 2026-11-19: "PDF or photo"). */
async function photoToPdf(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That photo could not be read.')); i.src = url; });
    // Scaled down so the PDF stays well under 5 MB.
    const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpg = canvas.toDataURL('image/jpeg', 0.82);
    const landscape = canvas.width > canvas.height;
    const pdf = await newPdf('a4', landscape ? 'landscape' : 'portrait');
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const k = Math.min((pw - 10) / canvas.width, (ph - 10) / canvas.height);
    const w = canvas.width * k, h = canvas.height * k;
    pdf.addImage(jpg, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
    return pdf.output('blob');
  } finally { URL.revokeObjectURL(url); }
}

/** Keeps a student's certificate copy, a PDF or a photo (replacing any earlier one). */
export async function uploadCertificate(orgId: string, studentId: string, file: File, kind: CertificateKind = 'final') {
  const pdf: Blob = isImage(file) ? await photoToPdf(file) : file;
  if (!isImage(file) && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Please choose a PDF or a photo.');
  if (pdf.size > CERTIFICATE_MAX_BYTES) throw new Error('That file is larger than 5 MB.');
  await call({ orgId, studentId, action: 'upload', kind, pdf: await toBase64(pdf) });
}

async function fetchCertificate(orgId: string, studentId: string, kind: CertificateKind) {
  const r = await call({ orgId, studentId, action: 'download', kind });
  const bytes = Uint8Array.from(atob(r.pdf ?? ''), (c) => c.charCodeAt(0));
  return new File([bytes], r.fileName ?? 'Certificate.pdf', { type: 'application/pdf' });
}

/** Saves the certificate copy to this device. */
export async function downloadCertificate(orgId: string, studentId: string, kind: CertificateKind = 'final') {
  downloadFile(await fetchCertificate(orgId, studentId, kind));
}

/** Opens the printer for the certificate copy. */
export async function printCertificate(orgId: string, studentId: string, kind: CertificateKind = 'final') {
  printFile(await fetchCertificate(orgId, studentId, kind));
}

/** Records the date the final certificate was handed over (Issued), or clears it (Not issued). */
export async function recordHandover(orgId: string, studentId: string, on: string | null) {
  await call({ orgId, studentId, action: 'handover', on });
}

/** Sends the certificate to the student's own email from ADIA's Gmail. Returns the address. */
export async function emailCertificate(orgId: string, studentId: string) {
  return (await call({ orgId, studentId, action: 'email' })).to ?? '';
}
