/**
 * Conversations about a child at Freedom Hope Centre (Andy, 2026-11-04: 1A 2 3A 5A 6A 7A 8A 9A 10A). Like a WhatsApp
 * group about one child: the Director, the board, Andy and Doreen read and write; each person has their own bubble
 * colour and signature (name, role, date and time). Messages are never edited or deleted, so the record stays true.
 * Photos and files go with messages. Open, Being handled or Closed; only the Director, Andy and Doreen close, with a
 * note. When a conversation starts the others get an URGENT email (Andy's own request). Staff who are worried about a
 * child can still raise it; it starts a conversation they cannot read further. Everything is kept in the vault
 * (Reports → Conversations). Reached only through the hopeChats Cloud Function.
 */
import { canDeletePhotoReport, canSeeAllPhotoReports, isHopeBoardName, isHopeDirector, type PhotoFile } from './hopePhotos.js';
import { can, canAccessOrg, type AccessProfile } from './permissions.js';

export type ChatStatus = 'open' | 'handling' | 'closed';
export const CHAT_STATUSES: ChatStatus[] = ['open', 'handling', 'closed'];
export const CHAT_STATUS_LABELS: Record<ChatStatus, string> = { open: 'Open', handling: 'Being handled', closed: 'Closed' };
export const isChatStatus = (v: unknown): v is ChatStatus => typeof v === 'string' && (CHAT_STATUSES as string[]).includes(v);

export const CHAT_TEXT_MAX = 4000;
export const CHAT_FILES_MAX = 10;

/** A conversation, organizations/{org}/hopeChats/{id}. */
export interface HopeChat {
  orgId: string;
  childId: string;
  childName: string;
  childCode: string;
  status: ChatStatus;
  startedByUid: string;
  startedByName: string;
  /** "board" when one of the readers started it; "staff" when a staff member raised a worry. */
  startedVia: 'board' | 'staff';
  /** ISO time of the last message, and a short preview of it. */
  lastAt: string;
  lastText: string;
  lastByName: string;
  messageCount: number;
  /** When each reader last opened it (ISO), for the "new messages" count. */
  seen: Record<string, string>;
  closeNote?: string;
  closedByName?: string;
  closedOn?: string;
  /** The old safeguarding note this came from (10A). */
  fromConcernId?: string;
}

/** A message, organizations/{org}/hopeChats/{id}/messages/{messageId}. Never changed once written. */
export interface ChatMessage {
  text: string;
  byUid: string;
  byName: string;
  byRole: string;
  /** ISO time it was sent. */
  at: string;
  files: PhotoFile[];
  /** A line the app writes itself, such as "Diana Kiunga closed this conversation". */
  system?: boolean;
}

export const chatFilePath = (orgId: string, chatId: string, messageId: string, key: string) => `hopeChats/${orgId}/${chatId}/${messageId}/${key}`;

type Profile = (AccessProfile & { displayName?: string; roleId?: string }) | null | undefined;

/** Reads and writes every conversation: the Director, the board, Andy and Doreen (1A, 2). */
export const canUseChats = (p: Profile, orgId: string) => canSeeAllPhotoReports(p, orgId);
/** Closes a conversation: the Director, Andy and Doreen. */
export const canCloseChat = (p: Profile, orgId: string) => canDeletePhotoReport(p, orgId);
/** Staff who see the children may raise a worry, which starts a conversation for the readers. */
export const canRaiseWorry = (p: Profile, orgId: string) => canAccessOrg(p, orgId) && (can(p, 'people.write') || can(p, 'attendance.write') || can(p, 'people.read'));

const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');

/** The role printed in each signature. */
export function chatRole(p: Profile, orgId: string): string {
  const name = plain(p?.displayName ?? '');
  if (name === 'andrewguya' && can(p, 'users.manage')) return 'Pastor';
  if (isHopeDirector(p, orgId)) return 'Director';
  if (isHopeBoardName(p?.displayName)) return 'Board member';
  if (can(p, 'users.manage')) return 'Administrator';
  return p?.roleId === 'helper' ? 'Helper' : 'Staff';
}

/** Each person's own bubble colour (3A), the same on every device and in the PDF: [bubble, name]. */
export const CHAT_COLOURS: [string, string][] = [
  ['#e7f6ec', '#03733a'], ['#e8eefc', '#2747a8'], ['#fdf0dc', '#a2620a'], ['#f6e6f4', '#8a2b7d'],
  ['#e2f4f6', '#0d6f7b'], ['#fde7e4', '#b0301f'], ['#efeafc', '#5b3aa6'], ['#eef3e1', '#5a6b14'],
];
export function chatColour(uid: string): [string, string] {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return CHAT_COLOURS[h % CHAT_COLOURS.length]!;
}

/** "4 Nov 2026, 09:15" in Nairobi. */
export function chatTime(iso: string, timeZone = 'Africa/Nairobi'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d);
  return `${day}, ${time}`;
}

/** The signature under a message: "Diana Kiunga · Director · 4 Nov 2026, 09:15". */
export const chatSignature = (m: Pick<ChatMessage, 'byName' | 'byRole' | 'at'>, timeZone?: string) => `${m.byName} · ${m.byRole} · ${chatTime(m.at, timeZone)}`;

/** How many messages someone has not seen yet: none once they have opened it after the last message. */
export const isUnread = (c: Pick<HopeChat, 'lastAt' | 'seen' | 'lastByName'>, uid: string) => !c.seen?.[uid] || c.seen[uid]! < c.lastAt;

/** The URGENT email when a conversation starts. Only the child's first name and code, never what was written. */
export function urgentEmail(c: Pick<HopeChat, 'childName' | 'childCode' | 'startedByName'>, firstName: string, link: string) {
  const child = `${c.childName.split(' ')[0] || 'a child'}${c.childCode ? ` (${c.childCode})` : ''}`;
  return {
    subject: `URGENT: your response is needed about ${child}`,
    text: [
      `Dear ${firstName},`,
      '',
      `${c.startedByName} has started a conversation about ${child} at Freedom Hope Center. Your URGENT response is needed.`,
      '',
      `Please open it and reply here: ${link}`,
      '',
      'For the child\'s safety, what was written is only in Insight-IQ, not in this email.',
      '',
      'Freedom Hope Center',
    ].join('\n'),
  };
}
