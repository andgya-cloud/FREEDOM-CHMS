/**
 * Freedom Hope Centre photo reports (Andy, 2026-11-04, 1A-8A). Staff, helpers and the Director send a short report
 * from their phone (Good news, Activity, Incident or Other) with up to ten photos or documents. Only the Director,
 * the board, Andy and Doreen see the reports; everyone else sees only the ones they sent (3A). Photos can also be
 * added to a weekly or monthly report and are printed at the end of its PDF (5A). Sending to the board by email or
 * WhatsApp is a button, never automatic (7A). Only the Director, Andy and Doreen delete, and a deleted list keeps who
 * deleted what (8A). Files sit in Storage, reached only through the hopePhotoReports Cloud Function.
 */
import { can, canAccessOrg, canKeepAccounts, isReviewer, type AccessProfile } from './permissions.js';
import {
  circleApprover, circleKeeper, circleOf, circleReader, circleRef, circleSender, HOPE_BOARD_NAMES, isKindOf, KIND_EMOJI, kindLabel,
  type CircleKind, type CircleType,
} from './circles.js';

export { HOPE_BOARD_NAMES };
/** Hope's four kinds; ADIA adds "Exams and results" and the church "Pastoral care" (circles.ts). */
export type PhotoReportKind = CircleKind;
export const PHOTO_REPORT_KINDS: PhotoReportKind[] = ['win', 'activity', 'incident', 'other'];
export const PHOTO_REPORT_LABELS: Record<PhotoReportKind, string> = { win: 'Good news', activity: 'Activity or event', exams: 'Exams and results', care: 'Pastoral care', incident: 'Incident', other: 'Other' };
export const PHOTO_REPORT_EMOJI: Record<PhotoReportKind, string> = KIND_EMOJI;
export const isPhotoReportKind = (v: unknown, type: CircleType = 'ministry'): v is PhotoReportKind => isKindOf(v, type);

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
  /** A video (played in the app, linked in the PDF, never printed or emailed). */
  video?: boolean;
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
  /** The conversation (v192): when it started (ISO), its last message, how many replies, who has seen it. */
  startedAt?: string;
  senderRole?: string;
  lastAt?: string;
  lastText?: string;
  lastByName?: string;
  replies?: number;
  seen?: Record<string, string>;
  /** The opening words were changed by the sender. */
  editedAt?: string;
  /** An incident's details (7A). */
  incident?: IncidentDetails;
  /** "Package for the board" (5A, 6A): the summary on the PDF's first page, and when it was sent. */
  summary?: string;
  packagedByName?: string;
  status?: StoryStatus;
  /** The report's number, "FHC-2026-014" (v193, 4A). */
  ref?: string;
  /** Who has opened it (uid → name), for "Seen by" (5A). */
  seenNames?: Record<string, string>;
  /** The two approvals printed on the PDF (7A). */
  approvals?: Partial<Record<ApprovalSlot, Approval>>;
  /** Photos or files Andy or Doreen took out, kept to put back (1A). */
  removed?: RemovedFile[];
  /** Children named in the opening message (2A). */
  children?: StoryChild[];
  /** An incident's follow-up marked done, and the 48-hour reminder (8A). */
  followUpDoneAt?: string;
  followUpDoneByName?: string;
  reminderSentAt?: string;
  textHistory?: { text: string; at: string }[];
}

/** Open → Under review → Resolved → Sent to the board (6A). */
export type StoryStatus = 'open' | 'review' | 'resolved' | 'sent';
export const STORY_STATUSES: StoryStatus[] = ['open', 'review', 'resolved', 'sent'];
export const STORY_STATUS_LABELS: Record<StoryStatus, string> = { open: 'Open', review: 'Under review', resolved: 'Resolved', sent: 'Sent to the board' };
export const isStoryStatus = (v: unknown): v is StoryStatus => typeof v === 'string' && (STORY_STATUSES as string[]).includes(v);

/** The Director's approval and the board's (7A). */
export type ApprovalSlot = 'director' | 'board';
export const APPROVAL_LABELS: Record<ApprovalSlot, string> = { director: 'Director', board: 'For the board' };
export interface Approval { name: string; role: string; at: string }
/** The confirmed password must be this fresh to approve. */
export const APPROVAL_PROOF_MINUTES = 5;

/** A child named in a message (2A): the details are kept as they were that day. */
export interface StoryChild { id: string; name: string; code: string; className: string }
export const STORY_CHILDREN_MAX = 10;

export interface RemovedFile { messageId: string; file: PhotoFile; removedByName: string; removedAt: string }

/** An incident's severity (8A). */
export type Severity = 'low' | 'medium' | 'high';
export const SEVERITY_LABELS: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const isSeverity = (v: unknown): v is Severity => v === 'low' || v === 'medium' || v === 'high';
/** The Director is reminded when an incident's follow-up is not done after this long. */
export const FOLLOW_UP_HOURS = 48;

/** "FHC-2026-014", "ADIA-2026-003", "FCN-2026-001" (7A). */
export const storyRef = (year: number, n: number, type: CircleType = 'ministry') => circleRef(type, year, n);
/** The approval labels for this organization (10A): Hope's Director and board; ADIA's Principal; the church's Pastor. */
export function approvalLabels(type: CircleType = 'ministry'): Record<ApprovalSlot, string> {
  const c = circleOf(type);
  return { director: c.firstApproval, board: c.secondApproval };
}

/** What an incident report records (7A). */
export interface IncidentDetails {
  /** "14:30". */
  time: string;
  place: string;
  hurt: string;
  action: string;
  /** Were the parents or guardians told? null when not answered yet. */
  parentsTold: boolean | null;
  followUp: string;
  severity?: Severity | null;
}
export const INCIDENT_FIELD_MAX = 300;
export function cleanIncident(v: unknown): IncidentDetails | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, INCIDENT_FIELD_MAX) : '');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s(o.time)) ? s(o.time) : '';
  return {
    time, place: s(o.place), hurt: s(o.hurt), action: s(o.action), parentsTold: typeof o.parentsTold === 'boolean' ? o.parentsTold : null, followUp: s(o.followUp),
    severity: isSeverity(o.severity) ? o.severity : null,
  };
}

/** A reply in a report's conversation, organizations/{org}/hopePhotoReports/{id}/messages/{messageId}. */
export interface StoryMessage {
  text: string;
  byUid: string;
  byName: string;
  byRole: string;
  /** ISO time it was sent. */
  at: string;
  files: PhotoFile[];
  /** Changed by the person who wrote it; the earlier words are kept. */
  editedAt?: string;
  history?: { text: string; at: string }[];
  /** Taken out: by the writer within five minutes, after that only by Andy or Doreen (Andy, 2026-11-06). */
  deleted?: boolean;
  deletedByName?: string;
  deletedAt?: string;
  /** Marked as a decision or next step, printed on the PDF's "Decisions and next steps". */
  decision?: boolean;
  /** Children named in it (2A). */
  children?: StoryChild[];
  /** A line the app writes itself: a status change, an approval, a removed photo. */
  system?: boolean;
}

/** The opening message's id in the conversation (the report itself). */
export const OPENING_ID = 'opening';
export const STORY_TEXT_MAX = 2000;
/** Each reply takes up to ten files, like the opening. */
export const STORY_FILES_MAX = 10;
/** A document (PDF, Word, Excel, PowerPoint) up to 10 MB; a video up to 50 MB (3A). Photos are shrunk on the phone. */
export const STORY_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const STORY_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Files go up in parts small enough for one call. */
export const STORY_PART_BYTES = 5 * 1024 * 1024;
/** The writer may take a message out within five minutes of sending it (Andy, 2026-11-06). */
export const UNSAY_MINUTES = 5;

/** Writes in a report's conversation (4A): the Director, the sender, the board, Andy and Doreen. */
export function canWriteInStory(p: Profile, uid: string, r: Pick<PhotoReport, 'orgId' | 'senderUid' | 'deleted'>, type: CircleType = 'ministry'): boolean {
  if (r.deleted) return false;
  return canSeeAllPhotoReports(p, r.orgId, type) || (r.senderUid === uid && canAccessOrg(p, r.orgId));
}

/** Who may take a message out, and until when (Andy, 2026-11-06): the writer within five minutes; after that only Andy or Doreen. */
export function canUnsay(p: Profile, uid: string, m: Pick<StoryMessage, 'byUid' | 'at' | 'deleted'>, now = Date.now()): boolean {
  if (m.deleted) return false;
  if (canKeepAccounts(p)) return true;
  const sent = Date.parse(m.at);
  return m.byUid === uid && Number.isFinite(sent) && now - sent <= UNSAY_MINUTES * 60_000;
}
/** Only the writer changes their own words, at any time. */
export const canEditMessage = (uid: string, m: Pick<StoryMessage, 'byUid' | 'deleted'>) => !m.deleted && !!uid && m.byUid === uid;

/** Takes out any photo or file, and puts it back (v193, 1A): Andy and Doreen. */
export const canRemoveFiles = (p: Profile) => canKeepAccounts(p);

/** Who may give each approval (7A): the Director's is Diana's; the board's is a board member's, Andy's or Doreen's. */
export function canApprove(p: Profile, orgId: string, slot: ApprovalSlot, type: CircleType = 'ministry'): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  if (type !== 'ministry') return circleApprover(p, orgId, slot, type);
  return slot === 'director' ? isHopeDirector(p, orgId) : isHopeBoardName(p?.displayName) || canKeepAccounts(p);
}

/** The key a stakeholder's photo is kept under: their name, plain. */
export const faceKey = (name: string) => (name || '').toLowerCase().replace(/[^a-z]/g, '');

/** An incident whose follow-up is overdue (8A): not done, not reminded yet, more than 48 hours old. */
export function needsFollowUpReminder(r: Pick<PhotoReport, 'kind' | 'deleted' | 'followUpDoneAt' | 'reminderSentAt' | 'startedAt' | 'status'>, now = Date.now()): boolean {
  if (r.kind !== 'incident' || r.deleted || r.followUpDoneAt || r.reminderSentAt || !r.startedAt) return false;
  if (r.status === 'resolved' || r.status === 'sent') return false;
  const t = Date.parse(r.startedAt);
  return Number.isFinite(t) && now - t >= FOLLOW_UP_HOURS * 3_600_000;
}

/** The record of changes printed at the end of the PDF (9A): edits, deletions and removed files, oldest first. */
export function storyChanges(r: Pick<PhotoReport, 'senderName' | 'editedAt' | 'removed' | 'textHistory'>, replies: StoryMessage[]): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  if (r.editedAt) out.push({ at: r.editedAt, text: `${r.senderName} edited the opening message${r.textHistory?.length ? ` (${r.textHistory.length} earlier ${r.textHistory.length === 1 ? 'version' : 'versions'} kept)` : ''}.` });
  for (const m of replies) {
    if (m.system) continue;
    if (m.editedAt && !m.deleted) out.push({ at: m.editedAt, text: `${m.byName} edited a message sent ${m.at.slice(0, 16).replace('T', ' ')}${m.history?.length ? ` (${m.history.length} earlier ${m.history.length === 1 ? 'version' : 'versions'} kept)` : ''}.` });
    if (m.deleted) out.push({ at: m.deletedAt ?? m.at, text: `${m.deletedByName ?? 'Someone'} deleted a message from ${m.byName}.` });
  }
  for (const x of r.removed ?? []) out.push({ at: x.removedAt, text: `${x.removedByName} took out the file "${x.file.name}".` });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Packages the conversation for the board (6A): the Director, Andy or Doreen. */
export const canPackageStory = (p: Profile, orgId: string, type: CircleType = 'ministry') => (type === 'ministry' ? isHopeDirector(p, orgId) || (canAccessOrg(p, orgId) && canKeepAccounts(p)) : circleKeeper(p, orgId, type));

/** Each person's glass tint (2A): the known people always have the same colour; anyone else gets one from their id. */
const KNOWN_TINTS: [string, string][] = [
  ['diana', '#038241'], ['andrew', '#1f2a5c'], ['doreen', '#c99a3c'], ['daniel', '#7c3a8a'], ['dorothy', '#c2410c'], ['elias', '#0e7490'],
];
const OTHER_TINTS = ['#2747a8', '#8a2b7d', '#0d6f7b', '#b0301f', '#5b3aa6', '#5a6b14', '#a2620a', '#374151'];
export function storyTint(name: string, uid = ''): string {
  const first = (name || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/)[0] ?? '';
  const known = KNOWN_TINTS.find(([n]) => n === first);
  if (known) return known[1];
  const key = uid || name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return OTHER_TINTS[h % OTHER_TINTS.length]!;
}

/** "Diana Kiunga started a conversation" email to the others (Andy, 2026-11-06), with the link to reply. */
export function storyStartEmail(r: Pick<PhotoReport, 'kind' | 'title' | 'day' | 'senderName'>, firstName: string, link: string, formatDay: (k: string) => string, type: CircleType = 'ministry', orgName = circleOf(type).orgName) {
  const label = kindLabel(r.kind, type);
  return {
    subject: `${r.kind === 'incident' ? 'Incident' : label}: ${r.title} (${orgName})`,
    text: [
      `Dear ${firstName},`,
      '',
      `${r.senderName} has started a conversation at ${orgName}: ${PHOTO_REPORT_EMOJI[r.kind]} ${label}, "${r.title}" (${formatDay(r.day)}).`,
      '',
      r.kind === 'incident' ? 'Please open it and respond as soon as you can:' : 'Please open it to see the photos and reply:',
      link,
      '',
      orgName,
    ].join('\n'),
  };
}

/** The one-tap WhatsApp note when a conversation starts (Andy, 2026-11-06). */
export function storyStartWhatsApp(r: Pick<PhotoReport, 'kind' | 'title' | 'senderName'>, link: string, type: CircleType = 'ministry'): string {
  return [
    `${PHOTO_REPORT_EMOJI[r.kind]} *${kindLabel(r.kind, type)}: ${r.title}*`,
    `${r.senderName} started a conversation in Insight-IQ. Please open it and reply:`,
    link,
  ].join('\n');
}

export const photoFilePath = (orgId: string, reportId: string, key: string) => `hopePhotoReports/${orgId}/${reportId}/${key}`;

const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
export const isHopeBoardName = (name: string | undefined) => !!name && HOPE_BOARD_NAMES.some((n) => plain(n) === plain(name));

type Profile = (AccessProfile & { displayName?: string; roleId?: string }) | null | undefined;

/** The Director is the Hope Centre's organization head. */
export function isHopeDirector(p: Profile, orgId: string): boolean {
  return canAccessOrg(p, orgId) && (p?.roleId === 'head' || can(p, 'team.manage'));
}

/** Anyone who works at the Hope Centre may send one: the Director, staff and helpers (2A). */
export function canSendPhotoReport(p: Profile, orgId: string, type: CircleType = 'ministry'): boolean {
  if (type !== 'ministry') return circleSender(p, orgId, type);
  return canAccessOrg(p, orgId) && (can(p, 'people.read') || can(p, 'attendance.write'));
}

/** Sees every report: the Director, the board, Andy and Doreen; not the Hope staff (3A). */
export function canSeeAllPhotoReports(p: Profile, orgId: string, type: CircleType = 'ministry'): boolean {
  if (type !== 'ministry') return circleReader(p, orgId, type);
  if (!canAccessOrg(p, orgId)) return false;
  return can(p, 'users.manage') || isHopeDirector(p, orgId) || isHopeBoardName(p?.displayName);
}

/** A Reviewer reads every report and win, look-only (Andy, 2026-11-11); never the private conversations. */
export const canReviewPhotoReports = (p: Profile, orgId: string) => isReviewer(p) && canAccessOrg(p, orgId);

/** Only the Director, Andy and Doreen delete (8A). */
export function canDeletePhotoReport(p: Profile, orgId: string, type: CircleType = 'ministry'): boolean {
  if (type !== 'ministry') return circleKeeper(p, orgId, type);
  return isHopeDirector(p, orgId) || (canAccessOrg(p, orgId) && canKeepAccounts(p));
}

export function canSeePhotoReport(p: Profile, uid: string, r: Pick<PhotoReport, 'orgId' | 'senderUid' | 'deleted'>, type: CircleType = 'ministry'): boolean {
  if (r.deleted) return canDeletePhotoReport(p, r.orgId, type);
  return canSeeAllPhotoReports(p, r.orgId, type) || canReviewPhotoReports(p, r.orgId) || (r.senderUid === uid && canAccessOrg(p, r.orgId));
}

/**
 * What a sent file is, by its first bytes (and, for Office files, which share one format, by its name): a photo
 * (JPG, PNG, WebP, HEIC), a document (PDF, Word, Excel, PowerPoint) or a video (MP4, MOV, WebM, 3GP).
 */
export function photoFileTypeOf(b: Uint8Array, name = ''): { ext: string; contentType: string; photo: boolean; video?: boolean } | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  const ext = (name.toLowerCase().match(/\.([a-z0-9]{2,5})$/) ?? [])[1] ?? '';
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', contentType: 'image/jpeg', photo: true };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { ext: 'png', contentType: 'image/png', photo: true };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', contentType: 'image/webp', photo: true };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { ext: 'heic', contentType: 'image/heic', photo: true };
    if (brand === 'qt  ') return { ext: 'mov', contentType: 'video/quicktime', photo: false, video: true };
    if (/^3g/.test(brand)) return { ext: '3gp', contentType: 'video/3gpp', photo: false, video: true };
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |M4VH|M4VP|dash|MSNV|f4v |XAVC|mmp4)$/.test(brand)) return { ext: 'mp4', contentType: 'video/mp4', photo: false, video: true };
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { ext: 'webm', contentType: 'video/webm', photo: false, video: true };
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { ext: 'pdf', contentType: 'application/pdf', photo: false };
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) {
    if (ext === 'xlsx') return { ext, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', photo: false };
    if (ext === 'pptx') return { ext, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', photo: false };
    return { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', photo: false };
  }
  if (at(0, 0xd0, 0xcf, 0x11, 0xe0)) {
    if (ext === 'xls') return { ext, contentType: 'application/vnd.ms-excel', photo: false };
    if (ext === 'ppt') return { ext, contentType: 'application/vnd.ms-powerpoint', photo: false };
    return { ext: 'doc', contentType: 'application/msword', photo: false };
  }
  return null;
}

/** A safe file name: "Sports day 3.jpg". */
export function photoFileName(title: string, index: number, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Photo report';
  return `${clean} ${index}.${ext}`;
}

/** The email to the board. */
export function photoReportEmail(r: Pick<PhotoReport, 'kind' | 'title' | 'day' | 'text' | 'senderName' | 'reportLabel' | 'files'>, orgName: string, link: string, formatDay: (k: string) => string, type: CircleType = 'ministry') {
  const label = kindLabel(r.kind, type);
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
export function photoReportWhatsApp(r: Pick<PhotoReport, 'kind' | 'title' | 'day' | 'text' | 'senderName'>, link: string, formatDay: (k: string) => string, type: CircleType = 'ministry'): string {
  return [
    `${PHOTO_REPORT_EMOJI[r.kind]} *${kindLabel(r.kind, type)}: ${r.title}*`,
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

/** The whole conversation in order: the report's own words and photos first, then each reply. */
export function storyTimeline(r: PhotoReport & { id?: string }, replies: (StoryMessage & { id: string })[]): (StoryMessage & { id: string; opening?: boolean })[] {
  const opening = {
    id: OPENING_ID, opening: true, text: r.text, byUid: r.senderUid, byName: r.senderName, byRole: r.senderRole ?? '',
    at: r.startedAt ?? `${r.day}T09:00:00.000Z`, files: r.files, ...(r.editedAt ? { editedAt: r.editedAt } : {}), ...(r.children?.length ? { children: r.children } : {}),
  };
  return [opening, ...[...replies].sort((a, b) => a.at.localeCompare(b.at))];
}

/** The incident details as rows for the screen and the PDF (7A). */
export function incidentRows(i: IncidentDetails | undefined): [string, string][] {
  if (!i) return [];
  return [
    ['Time', i.time],
    ['Where', i.place],
    ['Who was hurt', i.hurt],
    ['What was done', i.action],
    ['Parents told', i.parentsTold === null ? '' : i.parentsTold ? 'Yes' : 'No'],
    ['Follow-up', i.followUp],
  ].filter(([, v]) => v) as [string, string][];
}

/**
 * The stakeholders' own photos, built into the app (Andy, 2026-11-06), so every bubble shows the person speaking,
 * in old conversations too. A photo added in the app replaces it. Each name and its other spellings.
 */
const BUILT_IN_FACES: [string, string[]][] = [
  ['dianakiunga', ['dianakiunga']],
  ['danielojwang', ['danielojwang']],
  ['doreenmayaka', ['doreenmayaka', 'doreenguya']],
  ['eliasomondi', ['eliasomondi']],
  ['andrewguya', ['andrewguya']],
  ['dorothymohat', ['dorothymohat', 'dorothymohart']],
];
/** "/people/dianakiunga.jpg", or '' for someone without one. */
export function builtInFace(name: string): string {
  const k = faceKey(name);
  const hit = BUILT_IN_FACES.find(([, names]) => names.includes(k));
  return hit ? `/people/${hit[0]}.jpg` : '';
}
