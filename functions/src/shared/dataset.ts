/** What the backup, export and erase tools cover. Shared by the app and the Cloud Functions. */

/** Every collection under organizations/{orgId}, in the order they are exported. */
export const ORG_COLLECTIONS = [
  'people', 'pipeline', 'prayerRequests', 'pastoralNotes', 'followUps', 'messages',
  'events', 'attendance', 'programs', 'cohorts', 'enrollments', 'teams', 'teamMembers', 'groups', 'groupMembers',
  'funds', 'gifts', 'mpesaCodes', 'giftReviews', 'statementLines', 'giftImports', 'receipts', 'ledger', 'counters',
  'reports',
  'courses', 'intakes', 'schoolSettings', 'students', 'studentPrivate', 'assessments', 'marks', 'feeStructures', 'invoices',
  'feeBalances', 'certificates', 'outcomes', 'schoolReports',
  'children', 'childPrivate', 'homeVisits', 'referrals', 'safeguardingConcerns', 'childExports', 'hopeReports',
] as const;

/** Collections whose records belong to one person (they carry a personId). */
export const PERSON_COLLECTIONS = [
  'pipeline', 'prayerRequests', 'pastoralNotes', 'followUps', 'messages', 'attendance',
  'enrollments', 'teamMembers', 'groupMembers',
] as const;

/** ADIA records keyed by the student's id (the person's id), removed with the person. */
export const STUDENT_DOCS = ['students', 'studentPrivate', 'feeBalances', 'certificates'] as const;
/** ADIA records that carry a studentId field: results and employment follow-ups are removed, invoices are kept for the accounts. */
export const STUDENT_FIELD_COLLECTIONS = ['marks', 'outcomes'] as const;

/** Freedom Hope Center records keyed by the child's id (the person's id), removed with the child. */
export const CHILD_DOCS = ['children', 'childPrivate'] as const;
/** Hope Center records that carry a childId field (home visits, referrals, safeguarding concerns): removed with the child. */
export const CHILD_FIELD_COLLECTIONS = ['homeVisits', 'referrals', 'safeguardingConcerns'] as const;

/** Money records are kept for the accounts, but stop naming the person when they are erased. */
export const FINANCIAL_PERSON_COLLECTIONS = ['gifts', 'receipts', 'giftReviews'] as const;

export type DataRequestKind = 'export_all' | 'export_person' | 'erase_person';

export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 30;
export const BACKUPS_KEPT = 12;

/** How long deleted records are kept before they are removed for good. */
export function retentionDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(value)));
}

/** What an erased person leaves behind on a money record. */
export const ERASED_NAME = 'Erased at the person\'s request';
export function anonymisedGift(): Record<string, unknown> {
  return { personId: null, giverName: ERASED_NAME, phone: null, accountRef: '', notes: '' };
}

export function backupPath(date: string): string {
  return `backups/freedom-chms-${date}.json.gz`;
}

/** Oldest backups beyond the number to keep, given their file names. */
export function backupsToRemove(names: string[], keep = BACKUPS_KEPT): string[] {
  const dated = names.filter((n) => /freedom-chms-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort();
  return dated.slice(0, Math.max(0, dated.length - keep));
}

/** Flattens Firestore values (timestamps, nested maps) into plain JSON. */
export function toPlain(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  const secs = v.seconds ?? v._seconds;
  if (typeof secs === 'number' && Object.keys(v).length <= 2) return new Date(secs * 1000).toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, x]) => [k, toPlain(x)]));
}
