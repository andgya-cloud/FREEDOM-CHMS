import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createRecord, createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import type { ExamComponent, ExamSettings, ExamWeights } from '../../functions/src/shared/exams';

const sheetRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'examSheets', id);

/** A new marks sheet for one course, owned by the trainer who keys it in. */
export function createExamSheet(orgId: string, input: { cohort: string; courseId: string | null; courseName: string; teacherName: string; weights: ExamWeights; ownerUid: string; ownerName: string }) {
  return createRecord(collection(db, 'organizations', orgId, 'examSheets'), { orgId, ...input, status: 'draft', submittedAt: null, marks: {} });
}

/** One mark (or a cleared box) for one student. Saved on the device first, so it works offline. */
export function saveExamMark(orgId: string, sheetId: string, studentId: string, field: ExamComponent, value: number | null) {
  return updateRecord(sheetRef(orgId, sheetId), { [`marks.${studentId}.${field}`]: value });
}

export function saveExamSheetDetails(orgId: string, sheetId: string, changes: { courseName?: string; teacherName?: string; weights?: ExamWeights }) {
  return updateRecord(sheetRef(orgId, sheetId), changes);
}

/** Submitting locks the sheet; only the principal can open it again. */
export function submitExamSheet(orgId: string, sheetId: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'submitted', submittedAt: serverTimestamp() });
}

export function unlockExamSheet(orgId: string, sheetId: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'draft' });
}

export function deleteExamSheet(orgId: string, sheetId: string) {
  return softDelete(sheetRef(orgId, sheetId));
}

/** A line in the exam log, for every change the principal makes. */
export function logExam(orgId: string, entry: { action: string; cohort: string; sheetId: string | null; detail: string; byName: string }) {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return trackWrite(addDoc(collection(db, 'organizations', orgId, 'examLog'), { orgId, ...entry, detail: entry.detail.slice(0, 500), byUid: u.uid, at: serverTimestamp() }));
}

const metaId = (cohort: string) => cohort.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'cohort';

/** A remark the principal wrote for a student in one report (empty text goes back to the automatic remark). */
export function saveExamRemark(orgId: string, cohort: string, exists: boolean, scope: string, studentId: string, text: string) {
  const ref = doc(db, 'organizations', orgId, 'examMeta', metaId(cohort));
  if (exists) return updateRecord(ref, { [`remarks.${scope}.${studentId}`]: text });
  return trackWrite(setDoc(ref, { orgId, cohort, remarks: { [scope]: { [studentId]: text } }, attendance: {}, ...createStamps() }));
}

/** A student's attendance percentage for the cohort, as it prints on the report and slip. */
export function saveExamAttendance(orgId: string, cohort: string, exists: boolean, studentId: string, value: number | null) {
  const ref = doc(db, 'organizations', orgId, 'examMeta', metaId(cohort));
  if (exists) return updateRecord(ref, { [`attendance.${studentId}`]: value });
  return trackWrite(setDoc(ref, { orgId, cohort, remarks: {}, attendance: { [studentId]: value }, ...createStamps() }));
}

export function saveExamSettings(orgId: string, exists: boolean, settings: ExamSettings) {
  const ref = doc(db, 'organizations', orgId, 'examSettings', 'main');
  if (exists) return updateRecord(ref, { orgId, ...settings });
  return trackWrite(setDoc(ref, { orgId, ...settings, ...createStamps() }));
}

export { metaId as examMetaId };
