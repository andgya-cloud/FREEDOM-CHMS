import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { downloadFile } from './givingPdf';
import {
  extOf, LESSON_CHUNK_BYTES, LESSON_MAX_BYTES, LESSON_TYPES, LESSON_TYPES_TEXT, zipPath, type LessonItem, type TeachingCourse,
} from '../../functions/src/shared/lessonPlans';

export interface LessonTeacher { uid: string; name: string; phone: string; courses: TeachingCourse[] }

const call = <R,>(data: Record<string, unknown> & { orgId: string; action: string }) =>
  httpsCallable<typeof data, R>(functions, 'lessonPlans', { timeout: 180_000 })(data).then((r) => r.data);

export const myCourses = (orgId: string) => call<{ courses: TeachingCourse[] }>({ orgId, action: 'courses' }).then((r) => r.courses);
export const lessonRoster = (orgId: string) => call<{ teachers: LessonTeacher[] }>({ orgId, action: 'roster' }).then((r) => r.teachers);
export const removeLessonFile = (orgId: string, fileId: string, itemId: string) => call({ orgId, action: 'remove', fileId, itemId });

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** A phone photo taken from the camera may have no name ending; give it one from its type. */
function nameFor(file: File): string {
  if (extOf(file.name) in LESSON_TYPES) return file.name;
  const ext = Object.entries(LESSON_TYPES).find(([, t]) => t === file.type)?.[0];
  return ext ? `${file.name || 'Photo'}.${ext}` : file.name;
}

/** Why a file can't go, before it is sent, or null. */
export function checkFile(file: File): string | null {
  if (!(extOf(nameFor(file)) in LESSON_TYPES)) return `${file.name} is not a ${LESSON_TYPES_TEXT} file.`;
  if (file.size > LESSON_MAX_BYTES) return `${file.name} is larger than 20 MB.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

/** Uploads one file into a week's plan, in 4 MB pieces. onProgress gets 0 to 1. */
export async function uploadLessonFile(orgId: string, courseKey: string, week: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
  const parts = Math.max(1, Math.ceil(file.size / LESSON_CHUNK_BYTES));
  for (let n = 0; n < parts; n++) {
    const piece = file.slice(n * LESSON_CHUNK_BYTES, (n + 1) * LESSON_CHUNK_BYTES);
    await call({ orgId, action: 'part', uploadId, n, data: await toBase64(piece) });
    onProgress?.((n + 1) / (parts + 1));
  }
  await call({ orgId, action: 'add', courseKey, week, uploadId, parts, name: nameFor(file) });
  onProgress?.(1);
}

/** Fetches one file of a plan, piece by piece. */
export async function fetchLessonFile(orgId: string, fileId: string, item: Pick<LessonItem, 'id'>): Promise<File> {
  const chunks: Uint8Array[] = [];
  let start = 0; let name = 'Lesson plan'; let type = 'application/octet-stream'; let size = 1;
  while (start < size) {
    const r = await call<{ name: string; contentType: string; size: number; data: string }>({ orgId, action: 'download', fileId, itemId: item.id, start });
    name = r.name; type = r.contentType; size = r.size;
    if (!r.data) break;
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    chunks.push(bytes); start += bytes.length;
  }
  return new File(chunks as BlobPart[], name, { type });
}

export async function downloadLessonFile(orgId: string, fileId: string, item: Pick<LessonItem, 'id'>) {
  downloadFile(await fetchLessonFile(orgId, fileId, item));
}

/** "Download all" for a week (9A): one zip, a folder per teacher and course. */
export async function downloadWeekZip(orgId: string, zipName: string, plans: { fileId: string; tutorName: string; title: string; files: LessonItem[] }[], onProgress?: (done: number, of: number) => void) {
  const { zipSync } = await import('fflate');
  const all = plans.flatMap((p) => p.files.map((f) => ({ p, f })));
  const taken = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  let done = 0;
  for (const { p, f } of all) {
    const file = await fetchLessonFile(orgId, p.fileId, f);
    entries[zipPath(p.tutorName, p.title, f.name, taken)] = new Uint8Array(await file.arrayBuffer());
    onProgress?.(++done, all.length);
  }
  const zip = zipSync(entries, { level: 0 });
  downloadFile(new File([zip as BlobPart], zipName, { type: 'application/zip' }));
}
