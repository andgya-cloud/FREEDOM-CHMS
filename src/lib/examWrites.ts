import { addDoc, collection, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createRecord, createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import type { ExamComponent, ExamSettings, ExamWeights, MarkValue, StudentMarks } from '../../functions/src/shared/exams';
import type { ExamResult } from '../../functions/src/shared/examResults';

const sheetRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'examSheets', id);

/** The principal sets up a course for a cohort and gives it to a trainer (Andy, 2026-10-24). */
export function createExamSheet(orgId: string, input: { cohort: string; courseId: string | null; courseName: string; teacherName: string; weights: ExamWeights; ownerUid: string; ownerName: string; semester: 1 | 2 | null }) {
  return createRecord(collection(db, 'organizations', orgId, 'examSheets'), { orgId, ...input, status: 'draft', submittedAt: null, marks: {} });
}

/** One mark (a number, ABS, EX, a resit, or a cleared box) for one student. Saved on the device first, so it works offline. */
export function saveExamMark(orgId: string, sheetId: string, studentId: string, field: ExamComponent | 'resit', value: MarkValue) {
  return updateRecord(sheetRef(orgId, sheetId), { [`marks.${studentId}.${field}`]: value });
}

export function saveExamSheetDetails(orgId: string, sheetId: string, changes: { courseName?: string; teacherName?: string; ownerUid?: string; ownerName?: string; weights?: ExamWeights; semester?: 1 | 2 | null }) {
  return updateRecord(sheetRef(orgId, sheetId), changes);
}

/** Every mark from a trainer's Excel file in one save (Andy, 2026-10-24). */
export function saveExamMarks(orgId: string, sheetId: string, marks: Record<string, StudentMarks>) {
  return updateRecord(sheetRef(orgId, sheetId), { marks });
}

/** The trainer submits for approval; the sheet locks until the principal approves it or sends it back. */
export function submitExamSheet(orgId: string, sheetId: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'submitted', submittedAt: serverTimestamp() });
}

/** The principal approves: the course's results are final. */
export function approveExamSheet(orgId: string, sheetId: string, byName: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'approved', approvedAt: serverTimestamp(), approvedByName: byName.slice(0, 120), returnNote: null });
}

/** The principal sends it back to the trainer to change, with a note saying why. */
export function returnExamSheet(orgId: string, sheetId: string, note: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'draft', returnNote: note.trim().slice(0, 300) || null });
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

export function saveExamSettings(orgId: string, exists: boolean, settings: ExamSettings) {
  const ref = doc(db, 'organizations', orgId, 'examSettings', 'main');
  if (exists) return updateRecord(ref, { orgId, ...settings });
  return trackWrite(setDoc(ref, { orgId, ...settings, ...createStamps() }));
}

export { metaId as examMetaId };

/** organizations/{org}/examResults/{studentId}_{cohort}: one student's semester results for one cohort. */
export const examResultId = (studentId: string, cohort: string) => `${studentId}_${metaId(cohort)}`;

/** Saves past semester results from Excel, 400 at a time; a student's earlier upload for the cohort is replaced. */
export async function saveExamResults(orgId: string, results: ExamResult[], existing: ReadonlySet<string>) {
  const stamps = createStamps();
  for (let i = 0; i < results.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of results.slice(i, i + 400)) {
      const id = examResultId(r.studentId, r.cohort);
      const data = {
        orgId, cohort: r.cohort, studentId: r.studentId, admissionNo: r.admissionNo.slice(0, 80), studentName: r.studentName.slice(0, 160), courseId: r.courseId,
        semesters: r.semesters, printed: r.printed, notes: r.notes.slice(0, 20).map((n) => n.slice(0, 200)),
      };
      const ref = doc(db, 'organizations', orgId, 'examResults', id);
      if (existing.has(id)) batch.update(ref, { ...data, deletedAt: null, deletedBy: null, updatedAt: stamps.updatedAt, updatedBy: stamps.updatedBy });
      else batch.set(ref, { ...data, ...stamps });
    }
    await trackWrite(batch.commit());
  }
}
