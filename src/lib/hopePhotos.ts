import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { MAX_PHOTO_FILES, PHOTO_FILE_MAX_BYTES, type PhotoFile, type PhotoReport, type PhotoReportKind } from '../../functions/src/shared/hopePhotos';

export type StoredPhotoReport = PhotoReport & { id: string };
type Action = 'list' | 'create' | 'addFile' | 'file' | 'delete' | 'restore' | 'board' | 'email';
const call = <R,>(data: Record<string, unknown> & { orgId: string; action: Action }) =>
  httpsCallable<typeof data, R>(functions, 'hopePhotoReports', { timeout: 120_000 })(data).then((r) => r.data);

export interface PhotoList { reports: StoredPhotoReport[]; deleted: StoredPhotoReport[]; seesAll: boolean; deletes: boolean; sends: boolean }
export const listPhotoReports = (orgId: string, reportId?: string) => call<PhotoList>({ orgId, action: 'list', ...(reportId ? { reportId } : {}) });

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function decode(blob: Blob): Promise<HTMLImageElement | null> {
  const img = new Image();
  const url = URL.createObjectURL(blob);
  img.src = url;
  try { await img.decode(); return img; } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function toJpeg(img: HTMLImageElement, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be made smaller.'))), 'image/jpeg', quality));
}

export const isPhotoFile = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
export const isDocFile = (f: File) => /\.(pdf|docx?)$/i.test(f.name) || /pdf|msword|wordprocessing/.test(f.type);

/**
 * A photo is made smaller on the phone (4A): at most 1600 pixels across, as a JPG. A phone that cannot read the
 * photo itself (HEIC on some Android phones and computers) sends it as it is, if it is small enough.
 */
export async function shrinkForUpload(f: File): Promise<Blob> {
  if (isPhotoFile(f)) {
    const img = await decode(f);
    if (img) return toJpeg(img, 1600, 0.8);
    if (f.size <= PHOTO_FILE_MAX_BYTES) return f;
    throw new Error(`${f.name} could not be read on this phone and is too big to send as it is.`);
  }
  if (!isDocFile(f)) throw new Error(`${f.name}: please choose photos, PDF or Word files.`);
  if (f.size > PHOTO_FILE_MAX_BYTES) throw new Error(`${f.name} is larger than 4 MB.`);
  return f;
}

export interface NewPhotoReport { kind: PhotoReportKind; title: string; day: string; text: string; reportId?: string | null }

/** Sends the report, then each file one by one (so a slow phone connection only has one file to carry at a time). */
export async function sendPhotoReport(orgId: string, input: NewPhotoReport, files: File[], progress: (done: number, of: number) => void): Promise<{ id: string; failed: string[] }> {
  if (files.length > MAX_PHOTO_FILES) throw new Error(`Up to ${MAX_PHOTO_FILES} files per report.`);
  const ready: Blob[] = [];
  for (const f of files) ready.push(await shrinkForUpload(f));
  const { id } = await call<{ id: string }>({ orgId, action: 'create', ...input, reportId: input.reportId ?? null });
  const failed: string[] = [];
  for (let i = 0; i < ready.length; i++) {
    progress(i, ready.length);
    try { await call({ orgId, action: 'addFile', id, file: await toBase64(ready[i]!) }); } catch { failed.push(files[i]!.name); }
  }
  progress(ready.length, ready.length);
  return { id, failed };
}

/** Adds more files to a report the person sent. */
export async function addPhotoFiles(orgId: string, id: string, files: File[], progress: (done: number, of: number) => void): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(i, files.length);
    try { await call({ orgId, action: 'addFile', id, file: await toBase64(await shrinkForUpload(files[i]!)) }); } catch (err) { failed.push(`${files[i]!.name}${err instanceof Error ? ` (${err.message})` : ''}`); }
  }
  progress(files.length, files.length);
  return failed;
}

const cache = new Map<string, Promise<File>>();
/** One photo or document, kept for the visit so the grid and the PDF don't fetch it twice. */
export function photoFile(orgId: string, id: string, f: PhotoFile): Promise<File> {
  const k = `${orgId}/${id}/${f.key}`;
  let p = cache.get(k);
  if (!p) {
    p = call<{ name: string; contentType: string; file: string }>({ orgId, action: 'file', id, key: f.key })
      .then((r) => new File([Uint8Array.from(atob(r.file), (c) => c.charCodeAt(0))], r.name, { type: r.contentType }));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

/** A photo as a JPG the PDF can print, with its size; null when this device cannot read it. */
export async function photoForPdf(file: File): Promise<{ dataUrl: string; w: number; h: number } | null> {
  const img = await decode(file);
  if (!img) return null;
  const jpg = await toJpeg(img, 1400, 0.78);
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(jpg); });
  const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
  return { dataUrl, w: img.naturalWidth * scale, h: img.naturalHeight * scale };
}

export const deletePhotoReport = (orgId: string, id: string, reason: string) => call({ orgId, action: 'delete', id, reason });
export const restorePhotoReport = (orgId: string, id: string) => call({ orgId, action: 'restore', id });
export interface BoardPerson { name: string; hasEmail: boolean; phone: string }
export const loadBoard = (orgId: string) => call<{ people: BoardPerson[] }>({ orgId, action: 'board' }).then((r) => r.people);
export const emailPhotoReport = (orgId: string, id: string, names: string[]) => call<{ sentTo: string[] }>({ orgId, action: 'email', id, names }).then((r) => r.sentTo);
