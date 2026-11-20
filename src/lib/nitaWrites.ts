import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { blankNitaResult, nitaReleaseId, type NitaRelease, type NitaResultRecord } from '../../functions/src/shared/nita';

/** Adds the results NITA released on a day for a sitting (Andy, 2026-11-20, 3A). Returns the release id. */
export function addNitaRelease(orgId: string, r: Omit<NitaRelease, 'orgId'>): { id: string; done: Promise<unknown> } {
  const id = nitaReleaseId(r.cohort, r.sitting, r.releasedOn);
  return { id, done: trackWrite(setDoc(doc(db, 'organizations', orgId, 'nitaReleases', id), { orgId, ...r, ...createStamps() })) };
}

/** Changes a release's date or sitting. */
export const saveNitaRelease = (orgId: string, id: string, changes: Partial<Pick<NitaRelease, 'releasedOn' | 'sitting'>>) =>
  updateRecord(doc(db, 'organizations', orgId, 'nitaReleases', id), changes);

const started = new Set<string>();

/**
 * Saves a change to a student's NITA result (9B: one per student). The first change starts the record from what
 * the Exam register knows; saving it under another release moves it there. Works offline.
 */
export function saveNitaResult(orgId: string, existing: NitaResultRecord | null | undefined, base: { studentId: string; cohort: string; releaseId: string; trade?: string; grade?: string; indexNo?: string },
  changes: Partial<NitaResultRecord>) {
  const key = `${orgId}/${base.studentId}`;
  const ref = doc(db, 'organizations', orgId, 'nitaResults', base.studentId);
  if (existing || started.has(key)) return updateRecord(ref, { releaseId: base.releaseId, cohort: base.cohort, ...changes });
  started.add(key);
  return trackWrite(setDoc(ref, { ...blankNitaResult(orgId, base.studentId, base.cohort, base.releaseId, base), ...changes, ...createStamps() }));
}
