import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
import { isAttachmentKeeper } from '../../functions/src/shared/permissions';
import type { ClassTimetable, ExamTimetable } from '../../functions/src/shared/timetable';

export type ClassTimetableRow = ClassTimetable & { id: string; deletedAt?: unknown };
export type ExamTimetableRow = ExamTimetable & { id: string; deletedAt?: unknown };

/** The principal, Admin, the pastor and Doreen keep the timetables (Andy, 2026-11-20, 1A). */
export function useTimetableKeeper() {
  const { profile } = useAuth();
  return isAttachmentKeeper(profile);
}

function useTimetables<T extends { deletedAt?: unknown }>(orgId: string, name: string) {
  const { profile } = useAuth();
  const keeper = isAttachmentKeeper(profile);
  const on = !!orgId && !!profile?.active;
  // Everyone else reads only the published ones, so the query asks only for those.
  const q = useLiveQuery<T>(() => (!on ? null : keeper ? collection(db, 'organizations', orgId, name) : query(collection(db, 'organizations', orgId, name), where('published', '==', true))), [orgId, on, keeper]);
  return { rows: q.rows.filter((r) => !r.deletedAt), loading: q.loading };
}
export const useClassTimetables = (orgId: string) => useTimetables<ClassTimetableRow>(orgId, 'classTimetables');
export const useExamTimetables = (orgId: string) => useTimetables<ExamTimetableRow>(orgId, 'examTimetables');

/** 14A: the rooms, typed once. */
export function useRooms(orgId: string): { rooms: string[]; exists: boolean } {
  const [state, setState] = useState<{ rooms: string[]; exists: boolean }>({ rooms: [], exists: false });
  useEffect(() => {
    setState({ rooms: [], exists: false });
    if (!orgId) return;
    return onSnapshot(doc(db, 'organizations', orgId, 'timetableSetup', 'main'),
      (snap) => setState({ rooms: snap.exists() ? ((snap.data(ESTIMATE).rooms as string[] | undefined) ?? []) : [], exists: snap.exists() }), () => undefined);
  }, [orgId]);
  return state;
}

export interface TimetableCourse { sheetId: string; name: string; courseId: string | null; semester: number | null; lecturer: string; lecturerUid: string }
export interface TimetableOptions { courses: TimetableCourse[]; staff: { uid: string; name: string }[] }

/** The cohort's courses and lecturers, and the staff who may invigilate, for the keepers (needs the internet). */
export function useTimetableOptions(orgId: string, cohort: string, on: boolean): { options: TimetableOptions | null; error: string } {
  const [state, setState] = useState<{ key: string; options: TimetableOptions | null; error: string }>({ key: '', options: null, error: '' });
  const key = `${orgId}|${cohort}`;
  useEffect(() => {
    if (!on || !orgId || !cohort) return;
    let live = true;
    httpsCallable<{ orgId: string; cohort: string }, TimetableOptions>(functions, 'timetableOptions')({ orgId, cohort })
      .then((r) => { if (live) setState({ key, options: r.data, error: '' }); })
      .catch(() => { if (live) setState({ key, options: null, error: 'The course list needs the internet. You can still type a course.' }); });
    return () => { live = false; };
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? { options: state.options, error: state.error } : { options: null, error: '' };
}
