import { formatMoney } from './giving.js';
import { PERSON_STATUS_LABELS, type PersonStatus } from './people.js';
import { formatDateKey } from './datetime.js';
import type { OrganizationType } from './organizations.js';

/**
 * Clean-up (Andy, 2026-10-30): Andrew Guya and Doreen remove test data and clutter from any organization.
 * A removed entry, with everything linked to it, goes to the Recycle Bin for 30 days and can be put back;
 * after that it moves to Forever, which only they can see, and can still be put back from there.
 * Money and official records need the Director (Andy) and his password, with a reason.
 * Nothing is erased: entries are marked deleted (deletedAt), so totals, ledgers and lists leave them out.
 */
export const CLEANUP_KINDS = ['person', 'event', 'gift', 'followUp', 'programme', 'group', 'team', 'examSheet', 'examResult', 'inventoryCount', 'payrollStaff', 'payrollRun'] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

export const BIN_DAYS = 30;
export const MAX_ITEMS = 200;
export const MAX_LINKED = 5000;
export const TEST_WORDS = ['test', 'demo', 'sample', 'dummy'] as const;

/** A linked collection: documents whose `field` holds the entry's id, or (field 'id') the document with the same id. */
export interface LinkedSpec { collection: string; field: string; label: string; official?: boolean }

export interface KindSpec {
  collection: string;
  /** Shown in the "Type of entry" list; one word per organization type where it reads better. */
  label: string | Partial<Record<OrganizationType, string>> & { default: string };
  orgTypes?: readonly OrganizationType[];
  linked: readonly LinkedSpec[];
  /**
   * The entry's id is fixed (a month, or cohort + department + phase), so a new one with the same id must
   * stay possible: it is moved into the bin record instead of being marked deleted in place.
   */
  fixedId?: boolean;
}

const PERSON_LINKS: LinkedSpec[] = [
  { collection: 'pipeline', field: 'personId', label: 'journey steps' },
  { collection: 'prayerRequests', field: 'personId', label: 'prayer requests' },
  { collection: 'pastoralNotes', field: 'personId', label: 'pastoral notes' },
  { collection: 'followUps', field: 'personId', label: 'follow-ups' },
  { collection: 'attendance', field: 'personId', label: 'attendance marks' },
  { collection: 'enrollments', field: 'personId', label: 'programme places' },
  { collection: 'teamMembers', field: 'personId', label: 'team places' },
  { collection: 'groupMembers', field: 'personId', label: 'group places' },
  { collection: 'students', field: 'id', label: 'student record' },
  { collection: 'studentPrivate', field: 'id', label: 'student private details' },
  { collection: 'marks', field: 'studentId', label: 'marks' },
  { collection: 'examResults', field: 'studentId', label: 'exam results', official: true },
  { collection: 'invoices', field: 'studentId', label: 'fee invoices', official: true },
  { collection: 'certificates', field: 'id', label: 'certificate', official: true },
  { collection: 'gifts', field: 'personId', label: 'gifts and payments', official: true },
  { collection: 'children', field: 'id', label: 'child record' },
  { collection: 'childPrivate', field: 'id', label: 'child private details' },
  { collection: 'homeVisits', field: 'childId', label: 'home visits' },
  { collection: 'referrals', field: 'childId', label: 'referrals' },
];

export const KINDS: Record<CleanupKind, KindSpec> = {
  person: { collection: 'people', label: { default: 'People', college: 'Students', ministry: 'Children and people' }, linked: PERSON_LINKS },
  event: { collection: 'events', label: { default: 'Services and events', college: 'Classes (attendance)', ministry: 'Sessions' }, linked: [{ collection: 'attendance', field: 'eventId', label: 'attendance marks' }] },
  gift: { collection: 'gifts', label: { default: 'Gifts', college: 'Fee payments' }, linked: [] },
  followUp: { collection: 'followUps', label: 'Follow-ups', linked: [] },
  programme: {
    collection: 'programs', label: 'Programmes', orgTypes: ['church_campus', 'ministry'],
    linked: [
      { collection: 'cohorts', field: 'programId', label: 'cohorts' },
      { collection: 'enrollments', field: 'programId', label: 'places' },
      { collection: 'events', field: 'programId', label: 'sessions' },
      { collection: 'attendance', field: 'programId', label: 'attendance marks' },
    ],
  },
  group: {
    collection: 'groups', label: 'Groups', orgTypes: ['church_campus', 'ministry'],
    linked: [
      { collection: 'groupMembers', field: 'groupId', label: 'members' },
      { collection: 'events', field: 'groupId', label: 'meetings' },
      { collection: 'attendance', field: 'groupId', label: 'attendance marks' },
    ],
  },
  team: { collection: 'teams', label: 'Teams', orgTypes: ['church_campus', 'ministry'], linked: [{ collection: 'teamMembers', field: 'teamId', label: 'members' }] },
  examSheet: { collection: 'examSheets', label: 'Mark sheets', orgTypes: ['college'], linked: [] },
  examResult: { collection: 'examResults', label: 'Exam results', orgTypes: ['college'], linked: [] },
  inventoryCount: { collection: 'inventoryCounts', label: 'Inventory forms', orgTypes: ['college'], linked: [], fixedId: true },
  payrollStaff: { collection: 'payrollStaff', label: 'Payroll staff', orgTypes: ['college'], linked: [] },
  payrollRun: { collection: 'payrollRuns', label: 'Payroll months', orgTypes: ['college'], linked: [], fixedId: true },
};

export function isCleanupKind(v: unknown): v is CleanupKind {
  return typeof v === 'string' && (CLEANUP_KINDS as readonly string[]).includes(v);
}

export function kindLabel(kind: CleanupKind, type: OrganizationType | null | undefined): string {
  const l = KINDS[kind].label;
  return typeof l === 'string' ? l : (type && l[type]) || l.default;
}

export function kindsFor(type: OrganizationType | null | undefined): CleanupKind[] {
  return CLEANUP_KINDS.filter((k) => !KINDS[k].orgTypes || (type && KINDS[k].orgTypes!.includes(type)));
}

type Data = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const join = (...parts: unknown[]) => parts.map(s).filter(Boolean).join(' · ');
const money = (v: unknown) => (typeof v === 'number' ? formatMoney(v) : '');
const day = (v: unknown) => (s(v) ? formatDateKey(s(v)) : '');

/** The name an entry is listed by, and a short line about it. */
export function describeEntry(kind: CleanupKind, id: string, d: Data): { label: string; detail: string } {
  switch (kind) {
    case 'person':
      return { label: s(d.fullName) || 'No name', detail: join(PERSON_STATUS_LABELS[d.status as PersonStatus] ?? '', d.phone) };
    case 'event':
      return { label: s(d.name) || 'Event', detail: join(day(d.date), d.activity) };
    case 'gift':
      return { label: `${s(d.giverName) || 'Unknown giver'} · ${money(d.amountCents)}`, detail: join(day(d.date), d.method === 'mpesa' ? 'M-Pesa' : d.method, d.mpesaCode, d.receiptNumber ? `Receipt ${s(d.receiptNumber)}` : '', d.status === 'void' ? 'Void' : '') };
    case 'followUp':
      return { label: `Follow-up: ${s(d.personName) || 'someone'}`, detail: join(d.reason, d.status === 'done' ? 'Done' : 'Open', d.assignedName) };
    case 'programme':
    case 'group':
    case 'team':
      return { label: s(d.name) || 'No name', detail: join(d.place, d.active === false ? 'Not active' : '') };
    case 'examSheet':
      return { label: s(d.courseName) || 'Mark sheet', detail: join(d.cohort, d.semester ? `Semester ${d.semester}` : '', d.teacherName, d.status === 'approved' ? 'Approved' : d.status === 'submitted' ? 'Sent to principal' : 'Draft') };
    case 'examResult':
      return { label: s(d.studentName) || 'Student', detail: join(d.admissionNo, d.cohort) };
    case 'inventoryCount':
      return { label: s(d.courseName) || 'Inventory', detail: join(d.cohort, d.phase === 'end' ? 'End of cohort' : 'Start of cohort', d.status) };
    case 'payrollStaff':
      return { label: s(d.name) || 'Staff', detail: join(d.staffNo, d.jobTitle) };
    case 'payrollRun':
      return { label: `Payroll ${s(d.month) || id}`, detail: join(d.status === 'approved' ? 'Approved' : d.status) };
  }
}

/** Money and official records: only the Director, with his password and a reason (Andy, 2026-10-30, 5A). */
export function isOfficial(kind: CleanupKind, d: Data): boolean {
  if (kind === 'gift' || kind === 'examResult' || kind === 'payrollStaff' || kind === 'payrollRun') return true;
  if (kind === 'examSheet') return d.status === 'submitted' || d.status === 'approved';
  if (kind === 'inventoryCount') return d.status === 'verified';
  return false;
}

/** Looks like test data: a test word in its name or line ("test", "demo", "sample", "dummy"). */
export function looksLikeTest(label: string, detail = ''): boolean {
  const words = `${label} ${detail}`.toLowerCase().split(/[^a-z]+/);
  return words.some((w) => TEST_WORDS.some((t) => w === t || w === `${t}s` || (w.startsWith(t) && w.length <= t.length + 3)));
}

export function matchesText(label: string, detail: string, text: string): boolean {
  const want = text.toLowerCase().trim();
  if (!want) return true;
  const hay = `${label} ${detail}`.toLowerCase();
  return want.split(/\s+/).every((w) => hay.includes(w));
}

/** Days left before a Recycle Bin entry moves to Forever. */
export function daysLeft(deletedAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((deletedAtMs + BIN_DAYS * 86_400_000 - nowMs) / 86_400_000));
}

/** "3 attendance marks, 1 student record" */
const ONE: Record<string, string> = { 'gifts and payments': 'gift or payment', 'student private details': 'student private details', 'child private details': 'child private details' };
const one = (label: string) => ONE[label] ?? label.replace(/s$/, '');
export function linkedSummary(counts: Record<string, number>): string {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([l, n]) => `${n} ${n === 1 ? one(l) : l}`).join(', ');
}

export type BinState = 'bin' | 'forever' | 'restored';

export interface CleanupBinEntry {
  orgId: string;
  kind: CleanupKind;
  targetId: string;
  label: string;
  detail: string;
  official: boolean;
  /** Paths inside the organization ("people/abc") marked deleted by this entry, the entry itself first. */
  refs: string[];
  linked: Record<string, number>;
  reason: string;
  deletedBy: string;
  deletedByName: string;
  state: BinState;
  restoredByName?: string | null;
}
