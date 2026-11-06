import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import {
  MAX_PHOTO_FILES, PHOTO_FILE_MAX_BYTES, STORY_DOC_MAX_BYTES, STORY_PART_BYTES, STORY_VIDEO_MAX_BYTES,
  type ApprovalSlot, type IncidentDetails, type StoryChild, type StoryStatus, type PhotoFile, type PhotoReport, type PhotoReportKind, type StoryMessage,
} from '../../functions/src/shared/hopePhotos';

export type StoredPhotoReport = PhotoReport & { id: string };
export type StoredStoryMessage = StoryMessage & { id: string };
type Action = 'list' | 'create' | 'addFile' | 'file' | 'delete' | 'restore' | 'board' | 'email' | 'people' | 'messages' | 'uploadPart' | 'uploadDone' | 'say' | 'edit' | 'unsay' | 'decision' | 'package' | 'faces' | 'setFace' | 'children' | 'removeFile' | 'restoreFile' | 'status' | 'followUp' | 'approve';
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

export interface NewPhotoReport { kind: PhotoReportKind; title: string; day: string; text: string; reportId?: string | null; incident?: IncidentDetails | null; childIds?: string[] }

/** Photos, videos and documents for a conversation (3A): JPG, PNG, HEIC, WebP, MP4, MOV, PDF, Word, Excel, PowerPoint. */
export const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|3gp)$/i.test(f.name);
export const isOfficeFile = (f: File) => /\.(pdf|docx?|xlsx?|pptx?)$/i.test(f.name);
export const isStoryFile = (f: File) => isPhotoFile(f) || isVideoFile(f) || isOfficeFile(f);
export const STORY_ACCEPT = 'image/*,video/*,.heic,.heif,.mp4,.mov,.m4v,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

/** Photos are made smaller on the phone; a video up to 50 MB and a document up to 10 MB go as they are. */
export async function prepareStoryFile(f: File): Promise<Blob> {
  if (isPhotoFile(f)) return shrinkForUpload(f);
  if (isVideoFile(f)) {
    if (f.size > STORY_VIDEO_MAX_BYTES) throw new Error(`${f.name} is larger than 50 MB. Please send a shorter video.`);
    return f;
  }
  if (!isOfficeFile(f)) throw new Error(`${f.name}: please choose photos, videos, PDF, Word, Excel or PowerPoint files.`);
  if (f.size > STORY_DOC_MAX_BYTES) throw new Error(`${f.name} is larger than 10 MB.`);
  return f;
}

/** Sends one file in parts of 5 MB (a 50 MB video is ten parts), then joins them on the server. */
async function uploadStoryFile(orgId: string, id: string, f: File, onPart?: (frac: number) => void): Promise<PhotoFile> {
  return uploadInParts('hopePhotoReports', orgId, id, f, onPart);
}

/** The same upload for the photo conversations and the conversations about a child (v197). */
export async function uploadInParts(fn: 'hopePhotoReports' | 'hopeChats', orgId: string, id: string, f: File, onPart?: (frac: number) => void): Promise<PhotoFile> {
  const call = <R,>(data: Record<string, unknown>) => httpsCallable<typeof data, R>(functions, fn, { timeout: 120_000 })(data).then((r) => r.data);
  const blob = await prepareStoryFile(f);
  const parts = Math.max(1, Math.ceil(blob.size / STORY_PART_BYTES));
  let upload: string | undefined;
  for (let i = 0; i < parts; i++) {
    onPart?.(i / parts);
    const r = await call<{ upload: string }>({ orgId, action: 'uploadPart', id, index: i, part: await toBase64(blob.slice(i * STORY_PART_BYTES, (i + 1) * STORY_PART_BYTES)), ...(upload ? { upload } : {}) });
    upload = r.upload;
  }
  const name = blob === f ? f.name : f.name.replace(/\.[a-z0-9]+$/i, '.jpg');
  const { file } = await call<{ file: PhotoFile }>({ orgId, action: 'uploadDone', id, upload, parts, name });
  onPart?.(1);
  return file;
}

async function uploadAll(orgId: string, id: string, files: File[], progress?: (done: number, of: number) => void) {
  const up: PhotoFile[] = [];
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress?.(i, files.length);
    try { up.push(await uploadStoryFile(orgId, id, files[i]!)); } catch (err) { failed.push(`${files[i]!.name}${err instanceof Error ? ` (${err.message})` : ''}`); }
  }
  progress?.(files.length, files.length);
  return { up, failed };
}

/** Starts a conversation (1A): the report and its opening photos. The others get an email; WhatsApp is one tap after. */
export async function startStory(orgId: string, input: NewPhotoReport, files: File[], progress: (done: number, of: number) => void): Promise<{ id: string; emailed: string[]; failed: string[] }> {
  if (files.length > MAX_PHOTO_FILES) throw new Error(`Up to ${MAX_PHOTO_FILES} files per message.`);
  for (const f of files) if (!isStoryFile(f)) throw new Error(`${f.name}: please choose photos, videos, PDF, Word, Excel or PowerPoint files.`);
  const { id, emailed } = await call<{ id: string; emailed: string[] }>({ orgId, action: 'create', ...input, reportId: input.reportId ?? null, incident: input.incident ?? null });
  const { up, failed } = await uploadAll(orgId, id, files, progress);
  if (up.length) await call({ orgId, action: 'say', id, opening: true, files: up });
  return { id, emailed: emailed ?? [], failed };
}

export interface StoryOpen {
  report: StoredPhotoReport; messages: StoredStoryMessage[]; me: string; writes: boolean; keeps: boolean; packages: boolean; seesAll: boolean; deletes: boolean; now: number;
  childPhotos: Record<string, string>; faces: Record<string, string>; removes: boolean; approves: Record<ApprovalSlot, boolean>;
}
export const openStory = (orgId: string, id: string) => call<StoryOpen>({ orgId, action: 'messages', id });
/** A reply, with its photos, videos or files. */
export async function sayInStory(orgId: string, id: string, text: string, files: File[], progress?: (done: number, of: number) => void, childIds: string[] = []) {
  const { up, failed } = await uploadAll(orgId, id, files, progress);
  if (failed.length && !up.length && !text.trim() && !childIds.length) throw new Error(failed.join(', '));
  await call({ orgId, action: 'say', id, text, files: up, childIds });
  return failed;
}
export const editStoryMessage = (orgId: string, id: string, messageId: string, text: string) => call({ orgId, action: 'edit', id, messageId, text });
export const unsayStoryMessage = (orgId: string, id: string, messageId: string) => call({ orgId, action: 'unsay', id, messageId });
export const markDecision = (orgId: string, id: string, messageId: string, on: boolean) => call({ orgId, action: 'decision', id, messageId, on });
export const saveStorySummary = (orgId: string, id: string, summary: string) => call({ orgId, action: 'package', id, summary });
export const storyPeople = (orgId: string) => call<{ people: BoardPerson[] }>({ orgId, action: 'people' }).then((r) => r.people);
export async function emailStoryPdf(orgId: string, id: string, names: string[], pdf: File) {
  return call<{ sentTo: string[] }>({ orgId, action: 'email', id, names, pdf: await toBase64(pdf) }).then((r) => r.sentTo);
}

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
    p = (async () => {
      const bin = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const first = await call<{ name: string; contentType: string; file: string; parts?: number }>({ orgId, action: 'file', id, key: f.key });
      const chunks: Uint8Array<ArrayBuffer>[] = [bin(first.file)];
      for (let i = 1; i < (first.parts ?? 1); i++) chunks.push(bin((await call<{ file: string }>({ orgId, action: 'file', id, key: f.key, part: i })).file));
      return new File(chunks, first.name, { type: first.contentType });
    })();
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

/** The stakeholders' photos (3A), by plain name. */
export const loadFaces = (orgId: string) => call<{ faces: Record<string, string> }>({ orgId, action: 'faces' }).then((r) => r.faces);
/** A person's photo, made small (256 px) on the phone. Without a name, your own. */
export async function setFace(orgId: string, file: File | null, name?: string) {
  let photo: string | null = null;
  if (file) {
    const img = await decode(file);
    if (!img) throw new Error('This photo could not be read on this device.');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    photo = c.toDataURL('image/jpeg', 0.82);
  }
  await call({ orgId, action: 'setFace', photo, ...(name ? { name } : {}) });
}
let kids: Promise<StoryChild[]> | null = null;
/** The children to name in a message (2A), loaded once per visit. */
export function storyChildren(orgId: string): Promise<StoryChild[]> {
  kids ??= call<{ children: StoryChild[] }>({ orgId, action: 'children' }).then((r) => r.children);
  kids.catch(() => { kids = null; });
  return kids;
}
export const removeStoryFile = (orgId: string, id: string, key: string) => call({ orgId, action: 'removeFile', id, key });
export const restoreStoryFile = (orgId: string, id: string, key: string) => call({ orgId, action: 'restoreFile', id, key });
export const setStoryStatus = (orgId: string, id: string, status: StoryStatus) => call({ orgId, action: 'status', id, status });
export const setFollowUp = (orgId: string, id: string, done: boolean) => call({ orgId, action: 'followUp', id, done });
export const approveStory = (orgId: string, id: string, slot: ApprovalSlot, proof: string, undo = false) => call({ orgId, action: 'approve', id, slot, proof, undo });
