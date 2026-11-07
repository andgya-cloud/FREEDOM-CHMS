/**
 * The conversation reporting system for each organization (Andy, 2026-11-07, 1A-10A). Freedom Hope Center had it
 * first (Photos and wins, and the conversations about a child); ADIA Training Centre and Freedom Church now have the
 * same, with their own readers, words, report types, reference numbers, sign-off and colours. Everything that differs
 * between the three lives here, so the screens, the server and the emails say the same thing.
 */
import { can, canAccessOrg, canKeepAccounts, type AccessProfile } from './permissions.js';

export type CircleType = 'ministry' | 'college' | 'church_campus';
export const isCircleType = (t: unknown): t is CircleType => t === 'ministry' || t === 'college' || t === 'church_campus';

type Profile = (AccessProfile & { displayName?: string; roleId?: string }) | null | undefined;
const plain = (n: string) => (n || '').toLowerCase().replace(/[^a-z]/g, '');

export interface Circle {
  type: CircleType;
  orgName: string;
  /** "FHC-2026-014" and "FHC-C-2026-007"; "ADIA-…" and "FCN-…" (7A). */
  refPrefix: string;
  /** Where the pages are. A conversation about a person opens at `${chatsPath}/${id}`. */
  photosPath: string;
  chatsPath: string;
  vaultPath: string;
  personPath: (id: string) => string;
  /** The people conversations are about (5A). */
  person: string;
  people: string;
  personEmoji: string;
  codeLabel: string;
  /** Who reads everything (3A, 4A), in words. */
  readers: string;
  /** Who changes the status, packages and deletes. */
  keepers: string;
  /** The first and second approval on the PDF (10A). */
  firstApproval: string;
  secondApproval: string;
  /** "the board" in sentences like "Send to the board". */
  board: string;
  /** Who is reminded when an incident or a conversation waits. */
  lead: string;
}

export const CIRCLES: Record<CircleType, Circle> = {
  ministry: {
    type: 'ministry', orgName: 'Freedom Hope Center', refPrefix: 'FHC',
    photosPath: '/hope/photos', chatsPath: '/hope/chats', vaultPath: '/hope/records?show=chats', personPath: (id) => `/hope/children/${id}`,
    person: 'child', people: 'children', personEmoji: '👧', codeLabel: 'HC code',
    readers: 'the Director, the board, Andy and Doreen', keepers: 'the Director, Andy or Doreen',
    firstApproval: 'Director', secondApproval: 'For the board', board: 'the board', lead: 'Director',
  },
  college: {
    type: 'college', orgName: 'ADIA Training Centre', refPrefix: 'ADIA',
    photosPath: '/school/updates', chatsPath: '/school/conversations', vaultPath: '/school/conversations', personPath: (id) => `/school/students/${id}`,
    person: 'student', people: 'students', personEmoji: '🎓', codeLabel: 'admission number',
    readers: 'the Head, the Principal, the ADIA board, Andy and Doreen', keepers: 'the Head, the Principal, Andy or Doreen',
    firstApproval: 'Principal', secondApproval: 'Head or board', board: 'the ADIA board', lead: 'Head',
  },
  church_campus: {
    type: 'church_campus', orgName: 'Freedom Church', refPrefix: 'FCN',
    photosPath: '/updates', chatsPath: '/conversations', vaultPath: '/conversations', personPath: (id) => `/people/${id}`,
    person: 'member', people: 'members', personEmoji: '🙂', codeLabel: '',
    readers: 'Andy, Doreen and the church leaders', keepers: 'Andy, Doreen or a church leader',
    firstApproval: 'Pastor', secondApproval: 'Doreen or a leader', board: 'the church leaders', lead: 'church leader',
  },
};
export const circleOf = (type: unknown): Circle => CIRCLES[isCircleType(type) ? type : 'ministry'];

/** "FHC-2026-014" or, for a conversation about a person, "FHC-C-2026-007". */
export const circleRef = (type: CircleType, year: number, n: number, person = false) => `${CIRCLES[type].refPrefix}-${person ? 'C-' : ''}${year}-${String(n).padStart(3, '0')}`;

/** The Freedom Hope Centre board (Andy, 2026-11-04; 2026-11-06 Dorothy Mohat in place of Ronald Awili). */
export const HOPE_BOARD_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya', 'Elias Omondi', "Daniel Ojwang'", 'Dorothy Mohat', 'Dorothy Mohart'] as const;
/** ADIA's readers by name (3A): the board, Andy and Doreen, and the Head and Principal whatever role their account has. */
export const ADIA_BOARD_NAMES = ['Elias Omondi', "Daniel Ojwang'", 'Ronald Awili', 'Andrew Guya', 'Doreen Mayaka', 'Doreen Guya'] as const;
const ADIA_HEAD_NAMES = ['Elizabeth Mutuku'];
const ADIA_PRINCIPAL_NAMES = ['Flavier Akinyi'];
/** Freedom Church's readers by name (4A): Andy and Doreen; the church leaders by their role. */
export const CHURCH_BOARD_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya'] as const;

const named = (list: readonly string[], name: string | undefined) => !!name && list.some((n) => plain(n) === plain(name));
export const boardNamesOf = (type: CircleType): readonly string[] => (type === 'college' ? ADIA_BOARD_NAMES : type === 'church_campus' ? CHURCH_BOARD_NAMES : HOPE_BOARD_NAMES);
export const isBoardName = (type: CircleType, name: string | undefined) => named(boardNamesOf(type), name);

const isHead = (p: Profile) => p?.roleId === 'head' || can(p, 'team.manage');
export const isPrincipal = (p: Profile, orgId: string) => canAccessOrg(p, orgId) && (p?.roleId === 'principal' || named(ADIA_PRINCIPAL_NAMES, p?.displayName));

/**
 * The organization's own lead: Hope's Director; ADIA's Head and Principal; Freedom Church's leaders (its
 * organization heads).
 */
export function isCircleLead(p: Profile, orgId: string, type: CircleType): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  if (type === 'college') return isHead(p) || named(ADIA_HEAD_NAMES, p?.displayName) || isPrincipal(p, orgId);
  return isHead(p);
}

/** Reads and writes everything (3A, 4A). */
export function circleReader(p: Profile, orgId: string, type: CircleType): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  return can(p, 'users.manage') || isCircleLead(p, orgId, type) || isBoardName(type, p?.displayName);
}

/** Changes the status, packages for the board, closes and deletes: the lead, Andy and Doreen. */
export const circleKeeper = (p: Profile, orgId: string, type: CircleType) => isCircleLead(p, orgId, type) || (canAccessOrg(p, orgId) && canKeepAccounts(p));

/** Anyone who works there sends a report (ADIA's trainers too); they see only their own (3A, 4A). */
export function circleSender(p: Profile, orgId: string, type: CircleType): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  if (can(p, 'people.read') || can(p, 'attendance.write')) return true;
  if (type === 'college') return can(p, 'exams.mark') || can(p, 'exams.manage');
  if (type === 'church_campus') return can(p, 'gifts.write');
  return false;
}

/** The two approvals on the PDF (10A). */
export function circleApprover(p: Profile, orgId: string, slot: 'director' | 'board', type: CircleType): boolean {
  if (!canAccessOrg(p, orgId)) return false;
  if (type === 'college') {
    if (slot === 'director') return isPrincipal(p, orgId);
    return isHead(p) || named(ADIA_HEAD_NAMES, p?.displayName) || isBoardName('college', p?.displayName) || canKeepAccounts(p);
  }
  if (type === 'church_campus') {
    if (slot === 'director') return plain(p?.displayName ?? '') === 'andrewguya';
    return named(['Doreen Mayaka', 'Doreen Guya'], p?.displayName) || isHead(p);
  }
  return false;
}

/** The role printed beside each name. */
export function circleRole(p: Profile, orgId: string, type: CircleType): string {
  const name = plain(p?.displayName ?? '');
  if (name === 'andrewguya' && can(p, 'users.manage')) return 'Pastor';
  if (type === 'college') {
    if (isPrincipal(p, orgId)) return 'Principal';
    if (isHead(p) || named(ADIA_HEAD_NAMES, p?.displayName)) return 'Head';
    if (isBoardName('college', p?.displayName)) return 'Board member';
    if (can(p, 'users.manage')) return 'Administrator';
    return p?.roleId === 'trainer' ? 'Trainer' : 'Staff';
  }
  if (type === 'church_campus') {
    if (isHead(p)) return 'Church leader';
    if (can(p, 'users.manage')) return 'Administrator';
    return p?.roleId === 'usher' ? 'Usher' : p?.roleId === 'finance' ? 'Finance' : 'Staff';
  }
  return 'Staff';
}

/** The report types (2A): the same four as Hope, with ADIA's exams and the church's pastoral care. */
export type CircleKind = 'win' | 'activity' | 'exams' | 'care' | 'incident' | 'other';
export const KINDS_OF: Record<CircleType, CircleKind[]> = {
  ministry: ['win', 'activity', 'incident', 'other'],
  college: ['win', 'activity', 'exams', 'incident', 'other'],
  church_campus: ['win', 'activity', 'care', 'incident', 'other'],
};
const KIND_LABELS: Record<CircleType, Partial<Record<CircleKind, string>>> = {
  ministry: { win: 'Good news', activity: 'Activity or event', incident: 'Incident', other: 'Other' },
  college: { win: 'Good news', activity: 'Class activity', exams: 'Exams and results', incident: 'Incident', other: 'Other' },
  church_campus: { win: 'Testimony', activity: 'Event or service', care: 'Pastoral care', incident: 'Incident', other: 'Other' },
};
export const KIND_EMOJI: Record<CircleKind, string> = { win: '🌟', activity: '📅', exams: '📊', care: '🤝', incident: '⚠️', other: '📝' };
export const kindLabel = (kind: string, type: CircleType = 'ministry') => KIND_LABELS[type][kind as CircleKind] ?? KIND_LABELS.ministry[kind as CircleKind] ?? 'Report';
export const isKindOf = (kind: unknown, type: CircleType): kind is CircleKind => typeof kind === 'string' && (KINDS_OF[type] as string[]).includes(kind);
