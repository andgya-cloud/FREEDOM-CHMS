/**
 * Freedom Hope Centre photo reports (Andy, 2026-11-04, 1A-8A). Staff, helpers and the Director send a short report
 * from their phone (Good news, Activity, Incident or Other) with up to ten photos or documents. Only the Director,
 * the board, Andy and Doreen see the reports; everyone else sees only the ones they sent (3A). Photos can also be
 * added to a weekly or monthly report and are printed at the end of its PDF (5A). Sending to the board by email or
 * WhatsApp is a button, never automatic (7A). Only the Director, Andy and Doreen delete, and a deleted list keeps who
 * deleted what (8A). Files sit in Storage, reached only through the hopePhotoReports Cloud Function.
 */
import { can, canAccessOrg, canKeepAccounts, type AccessProfile } from './permissions.js';

export type PhotoReportKind = 'win' | 'activity' | 'incident' | 'other';
export const PHOTO_REPORT_KINDS: PhotoReportKind[] = ['win', 'activity', 'incident', 'other'];
export const PHOTO_REPORT_LABELS: Record<PhotoReportKind, string> = { win: 'Good news', activity: 'Activity or event', incident: 'Incident', other: 'Other' };
export const PHOTO_REPORT_EMOJI: Record<PhotoReportKind, string> = { win: '🌟', activity: '📅', incident: '⚠️', other: '📝' };
export const isPhotoReportKind = (v: unknown): v is PhotoReportKind => typeof v === 'string' && (PHOTO_REPORT_KINDS as string[]).includes(v);

export const MAX_PHOTO_FILES = 10;
/** Each file, after the phone has shrunk the photos. Ten of them still fit in one email. */
export const PHOTO_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_TITLE_MAX = 120;
export const PHOTO_TEXT_MAX = 2000;

export interface PhotoFile {
  /** Its place in Storage under the report, "1" to "10". */
  key: string;
  name: string;
  contentType: string;
  size: number;
  /** A photo (shown and printed) or a document (downloaded). */
  photo: boolean;
}

/** A photo report, organizations/{org}/hopePhotoReports/{id}. Written only by Cloud Functions. */
export interface PhotoReport {
  orgId: string;
  kind: PhotoReportKind;
  title: string;
  /** "YYYY-MM-DD", the day it happened. */
  day: string;
  text: string;
  files: PhotoFile[];
  /** The weekly or monthly report these photos support, if any. */
  reportId: string | null;
  reportLabel: string | null;
  senderUid: string;
  senderName: string;
  deleted: boolean;
  deletedByName?: string;
  deletedOn?: string;
  deleteReason?: string;
  /** Who it was emailed to, and when ("YYYY-MM-DD"). */
  emailedTo?: string[];
  emailedOn?: string;
}

export const photoFilePath = (orgId: string, reportId: string, key: string) => `hopePhotoReports/${orgId}/${reportId}/${key}`;

/** The board of Freedom Hope Centre (Andy, 2026-11-04, 7A): the stakeholders besides the Director. */
export const HOPE_BOARD_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya', 'Elias Omondi', "Daniel Ojwang'", 'Ronald Awili'] as const;
const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
export const isHopeBoardName = (name: string | undefined) => !!name && HOPE_BOARD_NAMES.some((n) => plain(n) === plain(name));

type Profile = (AccessProfile & { displayName?: string; roleId?: string }) | null | undefined;

/** The Director is the Hope Centre's organization head. */
export function isHopeDirector(p: Profile, orgId: string): boolean {
  return canAccessOrg(p, orgId) && (p?.roleId === 'head' || can(p, 'team.manage'));
}

/** Anyone who works at the Hope Centre may send one: the Director, staff and helpers (2A). */
export function canSendPhotoReport(p: Profile, orgId: string): boolean {
  return canAccessOrg(p, orgId) && (can(p, 'people.read') || can(p, 'attendance.write'));
}

/** Sees every report: the Director, the board, Andy and Doreen; not the Hope staff (3A). */
export function canSeeAllPhotoReports(p: Profile, orgId: string): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  return can(p, 'users.manage') || isHopeDirector(p, orgId) || isHopeBoardName(p?.displayName);
}

/** Only the Director, Andy and Doreen delete (8A). */
export function canDeletePhotoReport(p: Profile, orgId: string): boolean {
  return isHopeDirector(p, orgId) || (canAccessOrg(p, orgId) && canKeepAccounts(p));
}

export function canSeePhotoReport(p: Profile, uid: string, r: Pick<PhotoReport, 'orgId' | 'senderUid' | 'deleted'>): boolean {
  if (r.deleted) return canDeletePhotoReport(p, r.orgId);
  return canSeeAllPhotoReports(p, r.orgId) || (r.senderUid === uid && canAccessOrg(p, r.orgId));
}

/** What a sent file is, by its first bytes: a photo (JPG, PNG, WebP, HEIC) or a document (PDF, Word). */
export function photoFileTypeOf(b: Uint8Array): { ext: string; contentType: string; photo: boolean } | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', contentType: 'image/jpeg', photo: true };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { ext: 'png', contentType: 'image/png', photo: true };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', contentType: 'image/webp', photo: true };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { ext: 'heic', contentType: 'image/heic', photo: true };
  }
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { ext: 'pdf', contentType: 'application/pdf', photo: false };
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', photo: false };
  if (at(0, 0xd0, 0xcf, 0x11, 0xe0)) return { ext: 'doc', contentType: 'application/msword', photo: false };
  return null;
}

/** A safe file name: "Sports day 3.jpg". */
export function photoFileName(title: string, index: number, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Photo report';
  return `${clean} ${index}.${ext}`;
}

/** The email to the board. */
export function photoReportEmail(r: Pick<PhotoReport, 'kind' | 'title' | 'day' | 'text' | 'senderName' | 'reportLabel' | 'files'>, orgName: string, link: string, formatDay: (k: string) => string) {
  const label = PHOTO_REPORT_LABELS[r.kind];
  const subject = `${r.kind === 'incident' ? 'Incident' : label}: ${r.title} (${orgName})`;
  const text = [
    `${PHOTO_REPORT_EMOJI[r.kind]} ${label}: ${r.title}`,
    `${formatDay(r.day)} · sent by ${r.senderName}${r.reportLabel ? ` · for the report ${r.reportLabel}` : ''}`,
    '',
    r.text || '(No words, photos only.)',
    '',
    `${r.files.length} ${r.files.length === 1 ? 'file is' : 'files are'} attached.`,
    `Open it in Insight-IQ: ${link}`,
    '',
    orgName,
  ].join('\n');
  return { subject, text };
}

/** The WhatsApp message (the photos are shared with it from the phone). */
export function photoReportWhatsApp(r: Pick<PhotoReport, 'kind' | 'title' | 'day' | 'text' | 'senderName'>, link: string, formatDay: (k: string) => string): string {
  return [
    `${PHOTO_REPORT_EMOJI[r.kind]} *${PHOTO_REPORT_LABELS[r.kind]}: ${r.title}*`,
    `${formatDay(r.day)} · ${r.senderName}`,
    ...(r.text ? ['', r.text] : []),
    '',
    `Photos: ${link}`,
  ].join('\n');
}

/**
 * Taking, uploading or removing a child's photo needs the password of the Director, Andy or Doreen (Andy, 2026-11-05).
 * The same three people as those who delete photo reports.
 */
export const isPhotoApprover = canDeletePhotoReport;
/** How long one typed password lasts, so a whole batch of photos can be uploaded with it. */
export const PHOTO_PROOF_MINUTES = 20;
