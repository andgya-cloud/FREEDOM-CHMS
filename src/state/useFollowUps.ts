import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useMemo, useSyncExternalStore } from 'react';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/useQuery';
import { useAuth } from './AuthContext';
import { localDateKey } from '../../functions/src/shared/datetime';
import {
  FOLLOW_UP_REASONS,
  isEscalated,
  isOverdue,
  SENSITIVE_REASONS,
  withDefaults,
  type FollowUpReason,
  type MessageTemplate,
} from '../../functions/src/shared/followups';

export interface FollowUp {
  id: string;
  orgId: string;
  personId: string;
  personName: string;
  reason: FollowUpReason;
  templateId?: string;
  status: 'open' | 'done';
  assignedTo: string | null;
  assignedName?: string | null;
  dueAt: Timestamp;
  outcome: string | null;
  note?: string;
  doneAt?: Timestamp | null;
  doneBy?: string | null;
  lastMessageAt?: Timestamp | null;
  absentSince?: string | null;
  deletedAt: Timestamp | null;
  createdAt?: Timestamp;
  createdBy: string;
}

export interface StaffMember {
  id: string;
  displayName: string;
  active: boolean;
  allOrgs: boolean;
  orgIds: string[];
  followUps: boolean;
}

export interface MessageLog {
  id: string;
  personId: string;
  toName: string;
  viaGuardian: boolean;
  templateId: string;
  templateName: string;
  followUpId: string | null;
  giftId: string | null;
  senderName: string;
  createdAt?: Timestamp;
  createdBy: string;
}

/** Reasons staff without pastoral access may see. The server rules require this filter. */
export const EVERYDAY_REASONS = FOLLOW_UP_REASONS.filter((r) => !SENSITIVE_REASONS.includes(r));

const tasks = (orgId: string) => collection(db, 'organizations', orgId, 'followUps');
const byDue = (a: FollowUp, b: FollowUp) => (a.dueAt?.toMillis() ?? 0) - (b.dueAt?.toMillis() ?? 0);

/** Every open follow-up in the organization, soonest due first. */
export function useOpenFollowUps(orgId: string) {
  const { can } = useAuth();
  const pastoral = can('pastoral.read');
  const { rows, loading, error } = useLiveQuery<FollowUp>(() => {
    if (!orgId || !can('followups.manage')) return null;
    const open = where('status', '==', 'open');
    return pastoral ? query(tasks(orgId), open) : query(tasks(orgId), open, where('reason', 'in', EVERYDAY_REASONS));
  }, [orgId, pastoral]);
  const open = useMemo(() => rows.filter((r) => !r.deletedAt).sort(byDue), [rows]);
  return { open, loading, error };
}

/** Today's numbers for the home screen: due now (today or overdue), and escalated to the pastor. */
export function useFollowUpCounts(orgId: string, timeZone: string) {
  const { user } = useAuth();
  const { open } = useOpenFollowUps(orgId);
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const due = open.filter((t) => t.dueAt && localDateKey(t.dueAt.toDate(), timeZone) <= today);
  return {
    due: due.length,
    mine: due.filter((t) => t.assignedTo === user?.uid).length,
    escalated: open.filter((t) => isEscalated(t.dueAt?.toDate(), now)).length,
  };
}

export function useFollowUpsForPerson(orgId: string, personId: string) {
  const { can } = useAuth();
  const pastoral = can('pastoral.read');
  const { rows, loading } = useLiveQuery<FollowUp>(() => {
    if (!orgId || !personId || !can('followups.manage')) return null;
    const mine = where('personId', '==', personId);
    return pastoral ? query(tasks(orgId), mine) : query(tasks(orgId), mine, where('reason', 'in', EVERYDAY_REASONS));
  }, [orgId, personId, pastoral]);
  const list = useMemo(() => rows.filter((r) => !r.deletedAt), [rows]);
  return {
    open: list.filter((r) => r.status === 'open').sort(byDue),
    done: list.filter((r) => r.status === 'done').sort((a, b) => (b.doneAt?.toMillis() ?? 0) - (a.doneAt?.toMillis() ?? 0)),
    loading,
  };
}

/** Messages sent about this person, newest first. */
export function useMessagesForPerson(orgId: string, personId: string) {
  const { can } = useAuth();
  const pastoral = can('pastoral.read');
  const { rows } = useLiveQuery<MessageLog>(() => {
    if (!orgId || !personId || !(can('followups.manage') || can('gifts.write'))) return null;
    const base = collection(db, 'organizations', orgId, 'messages');
    const mine = where('personId', '==', personId);
    return pastoral ? query(base, mine) : query(base, mine, where('sensitive', '==', false));
  }, [orgId, personId, pastoral]);
  return useMemo(() => [...rows].sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())), [rows]);
}

/**
 * Active staff who can work follow-ups in this organization, for assigning.
 * The pastor reads the accounts themselves; other staff read the short
 * directory a Cloud Function keeps (accounts are private).
 */
export function useStaff(orgId: string): StaffMember[] {
  const { can } = useAuth();
  const accounts = can('users.manage');
  const { rows } = useLiveQuery<StaffMember & { permissions?: string[] }>(() => collection(db, accounts ? 'users' : 'staff'), [accounts]);
  return useMemo(
    () => rows
      .map((s) => (accounts ? { ...s, followUps: !!s.permissions?.includes('followups.manage') } : s))
      .filter((s) => s.active && s.followUps && (s.allOrgs || s.orgIds?.includes(orgId)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [rows, orgId, accounts],
  );
}

// One listener for the whole app, so a message sheet has the pastor's words
// the moment it opens rather than briefly showing the starting ones.
let savedTemplates: MessageTemplate[] | null = null;
let templatesListening = false;
const templateSubscribers = new Set<() => void>();

function listenToTemplates() {
  if (templatesListening) return;
  templatesListening = true;
  onSnapshot(doc(db, 'settings', 'whatsappTemplates'), (snap) => {
    savedTemplates = (snap.get('templates') as MessageTemplate[] | undefined) ?? [];
    templateSubscribers.forEach((f) => f());
  }, () => {
    // Signed out, or not allowed yet: try again next time someone needs them.
    templatesListening = false;
  });
}

/** The WhatsApp templates: the pastor's edited ones, and the starting ones not yet edited. */
export function useTemplates(): { templates: MessageTemplate[]; ready: boolean } {
  const { profile } = useAuth();
  const saved = useSyncExternalStore(
    (onChange) => {
      templateSubscribers.add(onChange);
      if (profile?.active) listenToTemplates();
      return () => { templateSubscribers.delete(onChange); };
    },
    () => savedTemplates,
  );
  return useMemo(() => ({ templates: withDefaults(saved), ready: saved !== null }), [saved]);
}

export function dueLabel(task: Pick<FollowUp, 'dueAt'>, timeZone: string, now = new Date()): { text: string; tone: '' | 'warn' | 'danger' } {
  const due = task.dueAt?.toDate();
  if (!due) return { text: '', tone: '' };
  if (isEscalated(due, now)) return { text: `Overdue ${Math.floor((now.getTime() - due.getTime()) / 86_400_000)} days: escalated to the pastor`, tone: 'danger' };
  if (isOverdue(due, now)) return { text: 'Overdue', tone: 'warn' };
  const days = Math.round((Date.parse(localDateKey(due, timeZone)) - Date.parse(localDateKey(now, timeZone))) / 86_400_000);
  return { text: days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`, tone: '' };
}
