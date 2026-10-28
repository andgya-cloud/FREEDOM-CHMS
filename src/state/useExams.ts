import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
import { examMetaId } from '../lib/examWrites';
import { EXAM_COMPONENTS, examSettingsWithDefaults, mergedMarks, type ExamSettings, type ExamSheet, type ReportMeta } from '../../functions/src/shared/exams';
import type { ExamResult } from '../../functions/src/shared/examResults';
import type { ExamCohort } from '../../functions/src/shared/examCohorts';

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

/**
 * Each course keeps its own percentages, which its trainer sets (Andy, 2026-10-25; the settings' weighting
 * is only where a new course starts), and its marks are the older map with each paper's own field on top.
 */
const normalize = (s: ExamSheetRow, settings: ExamSettings): ExamSheetRow => ({
  ...s,
  weights: s.weights && EXAM_COMPONENTS.every((c) => typeof s.weights[c]?.max === 'number' && typeof s.weights[c]?.wt === 'number') ? s.weights : settings.weights,
  marks: mergedMarks(s as unknown as Record<string, unknown>),
});
const withWeights = (rows: ExamSheetRow[], settings: ExamSettings) =>
  rows.filter((s) => !s.deletedAt).map((s) => normalize(s, settings)).sort((x, y) => (x.semester ?? 9) - (y.semester ?? 9) || x.courseName.localeCompare(y.courseName));

/** The courses of a cohort: every one for the principal, a trainer's own for a trainer. */
export function useExamSheets(orgId: string, cohort: string) {
  const a = useExamAccess();
  const { settings } = useExamSettings(orgId);
  const on = !!orgId && !!cohort && a.canMark && !!a.uid;
  const q = useLiveQuery<ExamSheetRow>(() => {
    if (!on) return null;
    return a.canManage
      ? query(col(orgId, 'examSheets'), where('cohort', '==', cohort))
      : query(col(orgId, 'examSheets'), where('cohort', '==', cohort), where('ownerUid', '==', a.uid));
  }, [orgId, cohort, on, a.canManage, a.uid]);
  const sheets = useMemo(() => withWeights(q.rows, settings), [q.rows, settings]);
  return { sheets, loading: q.loading };
}

/** A trainer's own classes, in every cohort. */
export function useMyExamSheets(orgId: string) {
  const a = useExamAccess();
  const { settings } = useExamSettings(orgId);
  const q = useLiveQuery<ExamSheetRow>(() => (orgId && a.canMark && a.uid ? query(col(orgId, 'examSheets'), where('ownerUid', '==', a.uid)) : null), [orgId, a.canMark, a.uid]);
  return { sheets: useMemo(() => withWeights(q.rows, settings), [q.rows, settings]), loading: q.loading };
}

export function useExamSheet(orgId: string, sheetId: string) {
  const { settings } = useExamSettings(orgId);
  const { data, loading } = useLiveDoc<ExamSheetRow>(() => (orgId && sheetId ? doc(db, 'organizations', orgId, 'examSheets', sheetId) : null), [orgId, sheetId]);
  const sheet = useMemo(() => (data && !data.deletedAt ? normalize(data, settings) : null), [data, settings]);
  return { sheet, loading };
}

export interface ExamTrainer { uid: string; name: string; phone: string }
/** The accounts the principal can give a course to. */
export function useExamTrainers(orgId: string) {
  const a = useExamAccess();
  const [trainers, setTrainers] = useState<ExamTrainer[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (!orgId || !a.canManage) return;
    let live = true;
    httpsCallable<{ orgId: string }, { trainers: ExamTrainer[] }>(functions, 'listExamTrainers')({ orgId })
      .then((r) => { if (live) setTrainers(r.data.trainers); }, (err: unknown) => { if (live) { setTrainers([]); setProblem(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
  }, [orgId, a.canManage]);
  return { trainers: trainers ?? [], loading: trainers == null, problem };
}

export function useExamSettings(orgId: string): { settings: ExamSettings; exists: boolean } {
  const a = useExamAccess();
  const { data } = useLiveDoc<Partial<ExamSettings>>(() => (orgId && a.canMark ? doc(db, 'organizations', orgId, 'examSettings', 'main') : null), [orgId, a.canMark]);
  const settings = useMemo(() => examSettingsWithDefaults(data), [data]);
  return { settings, exists: !!data };
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

export interface ExamResultRow extends ExamResult { id: string; deletedAt?: unknown; updatedAt?: Timestamp; createdBy?: string }

/** Past semester results from Excel, for the principal: every cohort's, or one cohort's. */
export function useExamResults(orgId: string, cohort?: string) {
  const a = useExamAccess();
  const { rows, loading } = useLiveQuery<ExamResultRow>(
    () => (orgId && a.canManage ? (cohort ? query(col(orgId, 'examResults'), where('cohort', '==', cohort)) : col(orgId, 'examResults')) : null),
    [orgId, cohort, a.canManage],
  );
  return { results: useMemo(() => rows.filter((r) => !r.deletedAt), [rows]), loading };
}

export interface ExamPrincipal { name: string; phone: string }
/** The principal's name and WhatsApp number, for a trainer's Send WhatsApp button on their class (Andy, 2026-10-25). */
export function useExamPrincipals(orgId: string, sheetId: string, on: boolean) {
  const [principals, setPrincipals] = useState<ExamPrincipal[]>([]);
  useEffect(() => {
    if (!orgId || !sheetId || !on) return;
    let live = true;
    httpsCallable<Record<string, string>, { principals: ExamPrincipal[] }>(functions, 'examNotify')({ orgId, sheetId, kind: 'sent', component: 'cat1', channel: 'contacts' })
      .then((r) => { if (live) setPrincipals(r.data.principals); }, () => { if (live) setPrincipals([]); });
    return () => { live = false; };
  }, [orgId, sheetId, on]);
  return principals;
}

/** Every cohort's graduation date and whether it is closed, by cohort name. */
export function useExamCohorts(orgId: string) {
  const { can } = useAuth();
  const on = !!orgId && (can('exams.mark') || can('exams.manage') || can('users.manage') || can('people.read') || can('attendance.write'));
  const q = useLiveQuery<ExamCohort & { id: string }>(() => (on ? col(orgId, 'examCohorts') : null), [orgId, on]);
  const byName = useMemo(() => Object.fromEntries(q.rows.map((r) => [r.cohort, r])) as Record<string, ExamCohort | undefined>, [q.rows]);
  return { byName, loading: q.loading };
}

/** Every marks sheet of every cohort, for the principal's course list. */
export function useAllExamSheets(orgId: string) {
  const a = useExamAccess();
  const q = useLiveQuery<ExamSheetRow>(() => (orgId && a.canManage ? col(orgId, 'examSheets') : null), [orgId, a.canManage]);
  const sheets = useMemo(() => q.rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt), [q.rows]);
  return { sheets, loading: q.loading };
}

/** A lecturer's own department's past results (Andy, 2026-10-28): they may read only those, so each department is asked for by itself. */
export function useDepartmentResults(orgId: string, courseIds: string[]) {
  const key = courseIds.join(',');
  const [byCourse, setByCourse] = useState<Record<string, ExamResultRow[]>>({});
  useEffect(() => {
    setByCourse({});
    const ids = key ? key.split(',') : [];
    if (!orgId || !ids.length) return;
    const offs = ids.map((id) => onSnapshot(query(col(orgId, 'examResults'), where('courseId', '==', id)), (snap) => {
      setByCourse((m) => ({ ...m, [id]: snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as ExamResultRow) }));
    }, () => {}));
    return () => offs.forEach((off) => off());
  }, [orgId, key]);
  return useMemo(() => Object.values(byCourse).flat().filter((r) => !r.deletedAt), [byCourse]);
}
