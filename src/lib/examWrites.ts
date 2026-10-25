import { addDoc, collection, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase';
import type { ExamNoticeKind } from '../../functions/src/shared/examNotices';
import { createRecord, createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import { MARK_FIELDS, type ExamComponent, type ExamSettings, type ExamWeights, type MarkValue, type StudentMarks } from '../../functions/src/shared/exams';
import type { ExamResult } from '../../functions/src/shared/examResults';

const sheetRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'examSheets', id);

/** The principal sets up a course for a cohort and gives it to a trainer (Andy, 2026-10-24). */
export function createExamSheet(orgId: string, input: { cohort: string; courseId: string | null; courseName: string; teacherName: string; weights: ExamWeights; ownerUid: string; ownerName: string; semester: 1 | 2 | null }) {
  return createRecord(collection(db, 'organizations', orgId, 'examSheets'), { orgId, ...input, status: 'draft', submittedAt: null, marks: {} });
}

/** One mark (a number, ABS, EX, a resit, or a cleared box) for one student. Saved on the device first, so it works offline. */
export function saveExamMark(orgId: string, sheetId: string, studentId: string, field: ExamComponent | 'resit', value: MarkValue) {
  // Each paper has its own field, so a sent paper locks on its own (Andy, 2026-10-25).
  return updateRecord(sheetRef(orgId, sheetId), { [`${MARK_FIELDS[field]}.${studentId}`]: value });
}

export function saveExamSheetDetails(orgId: string, sheetId: string, changes: { courseName?: string; teacherName?: string; ownerUid?: string; ownerName?: string; weights?: ExamWeights; semester?: 1 | 2 | null }) {
  return updateRecord(sheetRef(orgId, sheetId), changes);
}

/** Every mark from a trainer's Excel file in one save (Andy, 2026-10-24), for the papers that are still open. */
export function saveExamMarks(orgId: string, sheetId: string, marks: Record<string, StudentMarks>, papers: (ExamComponent | 'resit')[]) {
  const changes: Record<string, Record<string, MarkValue>> = {};
  for (const p of papers) changes[MARK_FIELDS[p]] = Object.fromEntries(Object.entries(marks).filter(([, m]) => p in m).map(([id, m]) => [id, (m[p] ?? null) as MarkValue]));
  return updateRecord(sheetRef(orgId, sheetId), changes);
}

/** The trainer sends papers to the principal: they lock (Andy, 2026-10-25). Sending the Final submits the course. */
export function sendExamPapers(orgId: string, sheetId: string, papers: ExamComponent[]) {
  const lock = Object.fromEntries(papers.map((c) => [`locked.${c}`, true]));
  return updateRecord(sheetRef(orgId, sheetId), papers.includes('final') ? { ...lock, status: 'submitted', submittedAt: serverTimestamp() } : lock);
}

/** The trainer asks the principal to unlock a sent paper, saying why. */
export function askExamChange(orgId: string, sheetId: string, component: ExamComponent, reason: string, byName: string) {
  return updateRecord(sheetRef(orgId, sheetId), { changeRequest: { component, reason: reason.trim().slice(0, 300), byName: byName.slice(0, 120) } });
}

/** The principal unlocks a paper for the trainer; unlocking the Final sends the course back to marking. */
export function unlockExamPaper(orgId: string, sheetId: string, component: ExamComponent, reopen: boolean) {
  return updateRecord(sheetRef(orgId, sheetId), { [`locked.${component}`]: false, changeRequest: null, ...(reopen ? { status: 'draft' } : {}) });
}

/** The principal approves: the course's results are final. */
export function approveExamSheet(orgId: string, sheetId: string, byName: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'approved', approvedAt: serverTimestamp(), approvedByName: byName.slice(0, 120), returnNote: null });
}

/** The principal sends it back to the trainer to change, with a note saying why. */
export function returnExamSheet(orgId: string, sheetId: string, note: string) {
  return updateRecord(sheetRef(orgId, sheetId), { status: 'draft', 'locked.final': false, changeRequest: null, returnNote: note.trim().slice(0, 300) || null });
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

/** Emails the principal from ADIA's Gmail that a paper was sent, or that the trainer asks to change one (Andy, 2026-10-25). */
export async function emailExamNotice(orgId: string, sheetId: string, kind: ExamNoticeKind, component: ExamComponent): Promise<string[]> {
  const res = await httpsCallable<Record<string, string>, { names: string[] }>(functions, 'examNotify')({ orgId, sheetId, kind, component, channel: 'email' });
  return res.data.names;
}

/** Keeps each student's final points and grade from the graduation list beside their results (Andy, 2026-10-25). */
export async function saveGraduationGrades(orgId: string, items: { studentId: string; cohort: string; admissionNo: string; studentName: string; courseId: string; points: number; grade: string }[], existing: ReadonlySet<string>) {
  const stamps = createStamps();
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of items.slice(i, i + 400)) {
      const id = examResultId(r.studentId, r.cohort);
      const ref = doc(db, 'organizations', orgId, 'examResults', id);
      const printed = { points: Math.round(r.points * 100) / 100, grade: r.grade.slice(0, 40) || null };
      if (existing.has(id)) batch.update(ref, { printed, updatedAt: stamps.updatedAt, updatedBy: stamps.updatedBy });
      else batch.set(ref, { orgId, cohort: r.cohort, studentId: r.studentId, admissionNo: r.admissionNo.slice(0, 80), studentName: r.studentName.slice(0, 160), courseId: r.courseId, semesters: {}, printed, notes: [], ...stamps });
    }
    await trackWrite(batch.commit());
  }
}
