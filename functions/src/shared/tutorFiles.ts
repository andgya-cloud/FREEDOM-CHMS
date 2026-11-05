/**
 * ADIA Tutor Files (Andy, 2026-11-04, 1A-8A). The principal asks for a file (a report or a course outline) with a
 * deadline and the tutors it is for. Each tutor sends a PDF or Word file (or photos, made into a PDF on the phone).
 * A sent file is locked: the tutor taps "Ask to change" and the principal opens it again for a set number of
 * days. Sending after the deadline is allowed but marked Late; the principal approves it or sends it back with a
 * comment. Tutors also add a lesson plan after each class register. For the last five days the tutor's page turns
 * redder and ADIA's Gmail reminds them at 8am until they send.
 */
import { addDays } from './metrics.js';

// Andy, 2026-11-04 (1A): in this order. "Other" lets the principal type the type.
export type FileKind = 'course' | 'lesson' | 'report' | 'other';
export const FILE_KINDS: FileKind[] = ['course', 'lesson', 'report', 'other'];
export const FILE_KIND_LABELS: Record<FileKind, string> = { course: 'Course outline', lesson: 'Lesson plan', report: 'Report', other: 'Other' };

/** The type as shown: the typed word for "Other" (3A), for example "Timetable". */
export const kindLabel = (r: { kind: FileKind; otherKind?: string | null }) =>
  (r.kind === 'other' && r.otherKind?.trim()) || FILE_KIND_LABELS[r.kind] || 'Other';

/** What the principal asks for. Stored in organizations/{org}/fileRequests. */
export interface FileRequest {
  orgId: string;
  title: string;
  kind: FileKind;
  /** What "Other" is, typed by the principal. */
  otherKind?: string | null;
  /** "YYYY-MM-DD", the last day (Nairobi). */
  deadline: string;
  /** Departments it is for; empty means every tutor. */
  courseIds: string[];
  note: string;
  createdByName: string;
}

export type TutorFileStatus = 'sent' | 'approved' | 'returned';

/** A tutor's file (a requested file or a lesson plan). Written only by Cloud Functions. */
export interface TutorFile {
  orgId: string;
  kind: 'request' | 'lesson';
  requestId: string | null;
  eventId: string | null;
  /** The request's title, or the class name for a lesson plan. */
  title: string;
  /** The deadline, or the lesson's date. */
  day: string;
  tutorUid: string;
  tutorName: string;
  status: TutorFileStatus;
  fileName: string;
  contentType: string;
  size: number;
  /** "YYYY-MM-DD" it was last sent. */
  sentOn: string;
  late: boolean;
  version: number;
  reopenRequest: { reason: string; byName: string } | null;
  /** "YYYY-MM-DD": the tutor may send again until the end of this day. */
  reopenUntil: string | null;
  returnNote: string;
  approvedByName: string;
}

/** The largest file accepted: it has to fit in one upload (about 10 MB once encoded) and in an email. */
export const TUTOR_FILE_MAX_BYTES = 6 * 1024 * 1024;
export const REMINDER_DAYS = 5;

export const requestFileId = (requestId: string, uid: string) => `${requestId}_${uid}`;
export const lessonFileId = (eventId: string, uid: string) => `lesson_${eventId}_${uid}`.slice(0, 300);
/** Where a tutor's file is kept in Storage. Only Cloud Functions read or write it. */
export const tutorFilePath = (orgId: string, fileId: string) => `tutorFiles/${orgId}/${fileId}`;

/** PDF, Word (.docx) or old Word (.doc), by the first bytes, or null. */
export function fileTypeOf(bytes: Uint8Array): { ext: 'pdf' | 'docx' | 'doc'; contentType: string } | null {
  const b = bytes;
  if (b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { ext: 'pdf', contentType: 'application/pdf' };
  if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { ext: 'doc', contentType: 'application/msword' };
  return null;
}

/** Is the request for a tutor of these departments? An empty list is for everyone. */
export const isForTutor = (r: Pick<FileRequest, 'courseIds'>, tutorCourseIds: readonly string[]) =>
  !r.courseIds?.length || r.courseIds.some((id) => tutorCourseIds.includes(id));

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const daysLeft = (deadline: string, today: string) => daysBetween(today, deadline);

/** "Due in 3 days", "Due today", "2 days late". */
export function dueText(deadline: string, today: string): string {
  const n = daysLeft(deadline, today);
  if (n > 1) return `Due in ${n} days`;
  if (n === 1) return 'Due tomorrow';
  if (n === 0) return 'Due today';
  return `${-n} ${n === -1 ? 'day' : 'days'} late`;
}

/**
 * How red the tutor's card is (Andy, 2026-11-04: "the page turns towards red as the deadline closes in"):
 * 0 more than five days away, rising to 1 on the deadline and after it.
 */
export function urgency(deadline: string, today: string): number {
  const n = daysLeft(deadline, today);
  if (n > REMINDER_DAYS) return 0;
  if (n <= 0) return 1;
  return Math.round(((REMINDER_DAYS + 1 - n) / (REMINDER_DAYS + 1)) * 100) / 100;
}

/** May the tutor send (or send again)? Before the first send, after "Send back", or while reopened. */
export function canSend(file: Pick<TutorFile, 'status' | 'reopenUntil'> | null | undefined, today: string): boolean {
  if (!file) return true;
  if (file.status === 'returned') return true;
  return !!file.reopenUntil && today <= file.reopenUntil;
}

/** Reminder emails go once a day for the last five days, until the tutor sends. */
export const needsReminder = (deadline: string, today: string) => daysLeft(deadline, today) >= 0 && daysLeft(deadline, today) <= REMINDER_DAYS;

export const reopenUntilFor = (today: string, days: number) => addDays(today, Math.max(1, Math.min(30, Math.floor(days) || 1)) - 1);

/** The file's name when downloaded: "Term 1 report - Jane Achieng.pdf". */
export function downloadName(title: string, tutorName: string, ext: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${clean(title) || 'File'} - ${clean(tutorName) || 'Tutor'}.${ext}`;
}

export function reminderSubject(r: Pick<FileRequest, 'title' | 'deadline'>, today: string): string {
  return `Reminder: ${r.title} is ${dueText(r.deadline, today).toLowerCase()}`;
}

export function reminderText(r: Pick<FileRequest, 'title' | 'deadline' | 'note' | 'kind' | 'otherKind'>, today: string, firstName: string, link: string, formatDay: (k: string) => string): string {
  return [
    `Dear ${firstName},`,
    '',
    `This is a reminder that "${r.title}" (${kindLabel(r).toLowerCase()}) is ${dueText(r.deadline, today).toLowerCase()} (deadline ${formatDay(r.deadline)}).`,
    ...(r.note ? ['', `Note from the principal: ${r.note}`] : []),
    '',
    `Send it here as a PDF or Word file, or take photos of it: ${link}`,
    '',
    'ADIA Training Centre',
  ].join('\n');
}
