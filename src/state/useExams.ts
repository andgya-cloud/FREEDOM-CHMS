import { collection, doc, query, where, type Timestamp } from 'firebase/firestore';
import { useMemo } from 'react';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { examMetaId } from '../lib/examWrites';
import { examSettingsWithDefaults, type ExamSettings, type ExamSheet, type ReportMeta } from '../../functions/src/shared/exams';
import type { ExamResult } from '../../functions/src/shared/examResults';

export interface ExamSheetRow extends ExamSheet { submittedAt?: Timestamp | null; updatedAt?: Timestamp }
export interface ExamLogRow { id: string; action: string; cohort: string; sheetId: string | null; detail: string; byName: string; at?: Timestamp }

/** Exam permissions. The pastor (users.manage) counts as the principal. */
export function useExamAccess() {
  const { can, user, profile } = useAuth();
  const canManage = can('exams.manage') || can('users.manage');
  const canMark = can('exams.mark') || canManage;
  return { uid: user?.uid ?? '', myName: profile?.displayName ?? '', canManage, canMark };
}

const col = (orgId: string, name: string) => collection(db, 'organizations', orgId, name);

/** The sheets of a cohort: every sheet for the principal, a trainer's own for a trainer. */
export function useExamSheets(orgId: string, cohort: string) {
  const a = useExamAccess();
  const on = !!orgId && !!cohort && a.canMark && !!a.uid;
  const q = useLiveQuery<ExamSheetRow>(() => {
    if (!on) return null;
    return a.canManage
      ? query(col(orgId, 'examSheets'), where('cohort', '==', cohort))
      : query(col(orgId, 'examSheets'), where('cohort', '==', cohort), where('ownerUid', '==', a.uid));
  }, [orgId, cohort, on, a.canManage, a.uid]);
  const sheets = useMemo(() => q.rows.filter((s) => !s.deletedAt).sort((x, y) => x.courseName.localeCompare(y.courseName)), [q.rows]);
  return { sheets, loading: q.loading };
}

export function useExamSheet(orgId: string, sheetId: string) {
  const { data, loading } = useLiveDoc<ExamSheetRow>(() => (orgId && sheetId ? doc(db, 'organizations', orgId, 'examSheets', sheetId) : null), [orgId, sheetId]);
  return { sheet: data && !data.deletedAt ? data : null, loading };
}

export function useExamSettings(orgId: string): { settings: ExamSettings; exists: boolean } {
  const a = useExamAccess();
  const { data } = useLiveDoc<Partial<ExamSettings>>(() => (orgId && a.canMark ? doc(db, 'organizations', orgId, 'examSettings', 'main') : null), [orgId, a.canMark]);
  return { settings: examSettingsWithDefaults(data), exists: !!data };
}

export function useExamMeta(orgId: string, cohort: string): { meta: ReportMeta; exists: boolean } {
  const a = useExamAccess();
  const { data } = useLiveDoc<ReportMeta>(() => (orgId && cohort && a.canManage ? doc(db, 'organizations', orgId, 'examMeta', examMetaId(cohort)) : null), [orgId, cohort, a.canManage]);
  return { meta: data ?? {}, exists: !!data };
}

export function useExamLog(orgId: string, cohort: string) {
  const a = useExamAccess();
  // One equality filter needs no extra index; newest first is sorted here.
  const { rows } = useLiveQuery<ExamLogRow>(
    () => (orgId && cohort && a.canManage ? query(col(orgId, 'examLog'), where('cohort', '==', cohort)) : null),
    [orgId, cohort, a.canManage],
  );
  return useMemo(() => [...rows].sort((x, y) => (y.at?.toMillis() ?? Date.now()) - (x.at?.toMillis() ?? Date.now())), [rows]);
}

export interface ExamResultRow extends ExamResult { id: string; deletedAt?: unknown; updatedAt?: Timestamp }

/** Past semester results from Excel, for the principal: every cohort's, or one cohort's. */
export function useExamResults(orgId: string, cohort?: string) {
  const a = useExamAccess();
  const { rows, loading } = useLiveQuery<ExamResultRow>(
    () => (orgId && a.canManage ? (cohort ? query(col(orgId, 'examResults'), where('cohort', '==', cohort)) : col(orgId, 'examResults')) : null),
    [orgId, cohort, a.canManage],
  );
  return { results: useMemo(() => rows.filter((r) => !r.deletedAt), [rows]), loading };
}
