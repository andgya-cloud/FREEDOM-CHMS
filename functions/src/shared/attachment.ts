/**
 * Industrial attachment (Andy, 2026-11-19, 1A-10A + Doreen): one record per student of a cohort with the
 * log book (Issued / Not issued), where they stand (Not placed, Placed, Ongoing, Completed), and the
 * assessment (Assessed / Not assessed) with a mark out of 100 that goes on the transcript.
 */
import { gradeFor, type ExamSettings } from './exams.js';

export const ATTACHMENT_STATUSES = ['not_placed', 'placed', 'ongoing', 'completed'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];
export const ATTACHMENT_STATUS_LABELS: Record<AttachmentStatus, string> = { not_placed: 'Not placed', placed: 'Placed', ongoing: 'Ongoing', completed: 'Completed' };

/** The two copies kept for each student: the log book and the assessment form (6A, 7A). */
export type AttachmentFileKind = 'logbook' | 'form';
export const ATTACHMENT_FILE_LABELS: Record<AttachmentFileKind, string> = { logbook: 'Log book', form: 'Assessment form' };

export interface Attachment {
  orgId: string;
  studentId: string;
  cohort: string;
  logBook: boolean;
  logBookOn: string | null;
  status: AttachmentStatus;
  assessed: boolean;
  mark: number | null;
  company: string;
  location: string;
  supervisor: string;
  supervisorPhone: string;
  from: string | null;
  to: string | null;
}

/** A student with nothing recorded yet. */
export const blankAttachment = (orgId: string, studentId: string, cohort: string): Attachment => ({
  orgId, studentId, cohort, logBook: false, logBookOn: null, status: 'not_placed', assessed: false, mark: null,
  company: '', location: '', supervisor: '', supervisorPhone: '', from: null, to: null,
});

/** 8A: a placed student whose start date has come is due to be Ongoing; an ongoing one past the end date is due to be Completed. */
export function statusHint(a: Pick<Attachment, 'status' | 'from' | 'to'> | null | undefined, today: string): AttachmentStatus | null {
  if (!a) return null;
  if (a.status === 'placed' && a.from && a.from <= today) return a.to && a.to < today ? 'completed' : 'ongoing';
  if (a.status === 'ongoing' && a.to && a.to < today) return 'completed';
  return null;
}

export interface AttachmentCounts { placed: number; notPlaced: number; ongoing: number; completed: number; logBooks: number; assessed: number }

/** 3A: the counts at the top. A student with no record counts as Not placed. */
export function attachmentCounts(studentIds: readonly string[], records: Record<string, Pick<Attachment, 'status' | 'logBook' | 'assessed'> | undefined>): AttachmentCounts {
  const c: AttachmentCounts = { placed: 0, notPlaced: 0, ongoing: 0, completed: 0, logBooks: 0, assessed: 0 };
  for (const id of studentIds) {
    const a = records[id];
    const s = a?.status ?? 'not_placed';
    if (s === 'placed') c.placed++; else if (s === 'ongoing') c.ongoing++; else if (s === 'completed') c.completed++; else c.notPlaced++;
    if (a?.logBook) c.logBooks++;
    if (a?.assessed) c.assessed++;
  }
  return c;
}

/** A typed mark: empty, or a number from 0 to 100 (one decimal place at most). */
export function markProblem(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d{1,3}(\.\d)?$/.test(t)) return 'Type a number from 0 to 100.';
  return Number(t) > 100 ? 'The mark is out of 100.' : null;
}

/** 10A: finished means completed and assessed. */
export const attachmentDone = (a: Pick<Attachment, 'status' | 'assessed'> | null | undefined) => !!a && a.status === 'completed' && a.assessed;

/** 7A: the transcript line, e.g. "78 · Credit". Empty until the student is assessed with a mark. */
export function attachmentLine(a: Pick<Attachment, 'assessed' | 'mark'> | null | undefined, settings: Pick<ExamSettings, 'bands'>): string {
  if (!a?.assessed || a.mark == null) return '';
  return `${a.mark} · ${gradeFor(a.mark, settings).grade}`;
}

/** Phone numbers kept as typed, without odd characters. */
export const cleanPhone = (v: string) => v.replace(/[^0-9+ ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);

/** Where an attachment copy is kept in Storage. Only Cloud Functions read or write it. */
export const attachmentPath = (orgId: string, studentId: string, kind: AttachmentFileKind) => `attachments/${orgId}/${studentId}-${kind}.pdf`;

/** "Log book - Jane Achieng - ADIA-ICT-014-2026.pdf". */
export function attachmentFileName(name: string, admissionNo: string | null | undefined, kind: AttachmentFileKind): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${ATTACHMENT_FILE_LABELS[kind]} - ${clean(name) || 'Student'}${admissionNo ? ` - ${clean(admissionNo).replace(/\s+/g, '-')}` : ''}.pdf`;
}
