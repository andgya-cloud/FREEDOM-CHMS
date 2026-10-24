import { collection, doc, serverTimestamp, setDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { firstName } from '../../functions/src/shared/people';
import { DEFAULT_SCHOOL_SETTINGS, FEES_FUND_ID, invoiceTotal, outcomeId, unitId, type AssessmentType, type CourseUnit, type FeeItem, type OutcomeStatus, type SchoolSettings, type StudentStatus } from '../../functions/src/shared/school';
import type { ImportRow } from '../../functions/src/shared/studentImport';
import { ADIA_PROGRAMMES } from '../../functions/src/shared/schoolSetup';
import type { WhatsAppConsent } from '../state/PeopleContext';
import type { Sponsor } from '../state/useSchool';

const ref = (orgId: string, name: string, id: string) => doc(db, 'organizations', orgId, name, id);
const slug = (text: string) => unitId(text).replace(/-/g, '_');

/** First-time setup: the grading settings, the school-fees fund and the four programmes from the brief. */
export function setupSchool(orgId: string, existing: { courses: string[]; hasSettings: boolean; hasFund: boolean }) {
  const batch = writeBatch(db);
  if (!existing.hasSettings) {
    batch.set(ref(orgId, 'schoolSettings', 'main'), { orgId, ...DEFAULT_SCHOOL_SETTINGS, ...createStamps() });
  }
  if (!existing.hasFund) {
    batch.set(ref(orgId, 'funds', FEES_FUND_ID), { orgId, name: 'School fees', aliases: ['fees', 'school fees', 'tuition'], active: true, ...createStamps() });
  }
  for (const name of ADIA_PROGRAMMES) {
    const id = slug(name);
    if (existing.courses.includes(id)) continue;
    batch.set(ref(orgId, 'courses', id), { orgId, name, levels: [], units: [], timetable: [], active: true, ...createStamps() });
  }
  return trackWrite(batch.commit());
}

export function saveSchoolSettings(orgId: string, settings: SchoolSettings, exists: boolean) {
  const data = { gradingScale: settings.gradingScale, passMark: settings.passMark, attendanceThreshold: settings.attendanceThreshold, weights: settings.weights, director: settings.director ?? '' };
  return exists
    ? updateRecord(ref(orgId, 'schoolSettings', 'main'), data)
    : trackWrite(setDoc(ref(orgId, 'schoolSettings', 'main'), { orgId, ...data, ...createStamps() }));
}

export interface CourseInput { name: string; levels: string[]; units: CourseUnit[]; timetable: string[]; active: boolean }
export function saveCourse(orgId: string, id: string | null, input: CourseInput) {
  const courseId = id ?? slug(input.name);
  const data = { ...input, units: input.units.map((u) => ({ ...u, id: u.id || unitId(u.name) })) };
  return { id: courseId, synced: id ? updateRecord(ref(orgId, 'courses', courseId), data) : trackWrite(setDoc(ref(orgId, 'courses', courseId), { orgId, ...data, ...createStamps() })) };
}

export interface IntakeInput { courseId: string; name: string; startDate: string; capacity: number | null; active: boolean }
export function saveIntake(orgId: string, id: string | null, input: IntakeInput) {
  if (id) return updateRecord(ref(orgId, 'intakes', id), input);
  const newRef = doc(collection(db, 'organizations', orgId, 'intakes'));
  return trackWrite(setDoc(newRef, { orgId, ...input, ...createStamps() }));
}

export interface EnrolInput {
  courseId: string;
  intakeId: string;
  level: string;
  status: StudentStatus;
  sponsors: Sponsor[];
  enrolledOn: string | null;
}
export interface NewStudentPerson { fullName: string; phone: string | null; whatsapp: string | null; whatsappConsent: WhatsAppConsent; gender?: string | null }

/** Enrols an existing person as a student, or adds the person and the student record together. */
export function enrolStudent(orgId: string, who: { personId: string } | { person: NewStudentPerson }, input: EnrolInput) {
  const batch = writeBatch(db);
  let personId: string;
  if ('personId' in who) {
    personId = who.personId;
  } else {
    const personRef = doc(collection(db, 'organizations', orgId, 'people'));
    personId = personRef.id;
    batch.set(personRef, {
      ...who.person, orgId, firstName: firstName(who.person.fullName), email: null, status: 'student',
      firstVisitDate: null, gender: who.person.gender ?? null, possibleDuplicateIds: [], customFields: {}, ...createStamps(),
    });
  }
  batch.set(ref(orgId, 'students', personId), { orgId, ...input, admissionNo: null, ...createStamps() });
  return { id: personId, synced: trackWrite(batch.commit()) };
}

export function updateStudent(orgId: string, studentId: string, changes: DocumentData) {
  return updateRecord(ref(orgId, 'students', studentId), changes);
}

export function saveStudentPrivate(orgId: string, studentId: string, data: { idNumber: string; notes: string }, exists: boolean) {
  return exists
    ? updateRecord(ref(orgId, 'studentPrivate', studentId), data)
    : trackWrite(setDoc(ref(orgId, 'studentPrivate', studentId), { orgId, ...data, ...createStamps() }));
}

export interface AssessmentInput { courseId: string; unitId: string; type: AssessmentType; name: string; maxMarks: number; date: string }
export function saveAssessment(orgId: string, id: string | null, input: AssessmentInput) {
  if (id) return { id, synced: updateRecord(ref(orgId, 'assessments', id), input) };
  const newRef = doc(collection(db, 'organizations', orgId, 'assessments'));
  return { id: newRef.id, synced: trackWrite(setDoc(newRef, { orgId, ...input, ...createStamps() })) };
}

/** One student's mark. `exists` says whether a mark is already saved (so it is changed, not created). */
export function saveMark(orgId: string, assessmentId: string, studentId: string, marks: number, exists: boolean) {
  const id = `${assessmentId}_${studentId}`;
  return exists
    ? updateRecord(ref(orgId, 'marks', id), { marks })
    : trackWrite(setDoc(ref(orgId, 'marks', id), { orgId, assessmentId, studentId, marks, ...createStamps() }));
}

export function saveFeeStructure(orgId: string, courseId: string, intakeId: string, items: FeeItem[], exists: boolean) {
  const id = `${courseId}_${intakeId}`;
  return exists
    ? updateRecord(ref(orgId, 'feeStructures', id), { items })
    : trackWrite(setDoc(ref(orgId, 'feeStructures', id), { orgId, courseId, intakeId, items, ...createStamps() }));
}

export interface InvoiceInput { studentId: string; items: FeeItem[]; dueDate: string | null; label: string }
export function invoiceDoc(orgId: string, input: InvoiceInput) {
  return { orgId, studentId: input.studentId, items: input.items, totalCents: invoiceTotal(input.items), dueDate: input.dueDate, label: input.label, status: 'open', ...createStamps() };
}
export function createInvoice(orgId: string, input: InvoiceInput) {
  const newRef = doc(collection(db, 'organizations', orgId, 'invoices'));
  return trackWrite(setDoc(newRef, invoiceDoc(orgId, input)));
}

/** An invoice per enrolled student of an intake from its fee structure. Students who already have this bill are skipped. */
export function billStudents(orgId: string, studentIds: string[], items: FeeItem[], label: string, dueDate: string | null, intakeId: string, alreadyBilled: Set<string>) {
  const batch = writeBatch(db);
  let n = 0;
  for (const studentId of studentIds) {
    const id = `${intakeId}_${slug(label)}_${studentId}`;
    if (alreadyBilled.has(id)) continue;
    batch.set(ref(orgId, 'invoices', id), invoiceDoc(orgId, { studentId, items, dueDate, label }));
    n += 1;
  }
  return { count: n, synced: n ? trackWrite(batch.commit()) : Promise.resolve() };
}
export const billId = (intakeId: string, label: string, studentId: string) => `${intakeId}_${slug(label)}_${studentId}`;

export function voidInvoice(orgId: string, invoiceId: string, reason: string) {
  return updateRecord(ref(orgId, 'invoices', invoiceId), { status: 'void', voidReason: reason.slice(0, 120) });
}

export function issueCertificate(orgId: string, studentId: string, courseId: string, issuedOn: string) {
  return trackWrite(setDoc(ref(orgId, 'certificates', studentId), { orgId, studentId, courseId, issuedOn, ...createStamps() }));
}

export function recordOutcome(orgId: string, studentId: string, months: number, status: OutcomeStatus, note: string, recordedOn: string) {
  return updateRecord(ref(orgId, 'outcomes', outcomeId(studentId, months)), { status, note: note.slice(0, 500), recordedOn });
}

export function requestSchoolReport(orgId: string, uid: string, type: 'weekly' | 'monthly', from: string) {
  const r = doc(collection(db, 'organizations', orgId, 'schoolReportRequests'));
  void trackWrite(setDoc(r, { orgId, type, from, status: 'pending', createdAt: serverTimestamp(), createdBy: uid }));
  return r.id;
}

/**
 * Adds the students from a checked class list: first any programmes and intakes the list names that
 * ADIA doesn't have yet, then each student (and their person record) in batches. Admission numbers
 * from the list are kept; students without one get the next number as usual.
 */
export function importStudents(orgId: string, rows: readonly ImportRow[], have: { courseIds: readonly string[]; keepAdmissionNos: boolean; keepIdNumbers: boolean }, today: string, recordedBy: string | null) {
  const writes: Promise<void>[] = [];
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const courseIds = new Map<string, string>();
  const taken = new Set(have.courseIds);
  for (const r of rows) {
    if (r.courseId || courseIds.has(key(r.programme))) continue;
    let id = slug(r.programme).slice(0, 36) || 'programme';
    if (id.length < 2) id = `${id}_p`;
    for (let n = 2; taken.has(id); n++) id = `${slug(r.programme).slice(0, 34)}_${n}`;
    taken.add(id);
    courseIds.set(key(r.programme), id);
    writes.push(trackWrite(setDoc(ref(orgId, 'courses', id), { orgId, name: r.programme.slice(0, 120), levels: [], units: [], timetable: [], active: true, ...createStamps() })));
  }
  const courseOf = (r: ImportRow) => r.courseId ?? courseIds.get(key(r.programme))!;
  const intakeIds = new Map<string, string>();
  for (const r of rows) {
    const k = `${courseOf(r)}|${key(r.intake)}`;
    if (r.intakeId || intakeIds.has(k)) continue;
    const starts = rows.filter((x) => !x.intakeId && `${courseOf(x)}|${key(x.intake)}` === k).map((x) => x.startDate).filter((d): d is string => !!d).sort();
    const newRef = doc(collection(db, 'organizations', orgId, 'intakes'));
    intakeIds.set(k, newRef.id);
    writes.push(trackWrite(setDoc(newRef, { orgId, courseId: courseOf(r), name: r.intake.slice(0, 80), startDate: starts[0] ?? today, capacity: null, active: true, ...createStamps() })));
  }
  for (let i = 0; i < rows.length; i += 150) {
    const batch = writeBatch(db);
    for (const r of rows.slice(i, i + 150)) {
      let personId = r.personId;
      if (!personId) {
        const personRef = doc(collection(db, 'organizations', orgId, 'people'));
        personId = personRef.id;
        batch.set(personRef, {
          orgId, fullName: r.name, firstName: firstName(r.name), phone: r.phone, whatsapp: null, email: null, status: 'student',
          whatsappConsent: { given: false, date: today, recordedBy, stoppedAt: null },
          firstVisitDate: null, gender: r.gender, possibleDuplicateIds: [], customFields: {}, ...createStamps(),
        });
      }
      const courseId = courseOf(r);
      batch.set(ref(orgId, 'students', personId), {
        orgId, courseId, intakeId: r.intakeId ?? intakeIds.get(`${courseId}|${key(r.intake)}`)!, level: r.level, status: r.status,
        sponsors: r.sponsor ? [{ ...r.sponsor, whatsapp: false }] : [], enrolledOn: r.status === 'enrolled' ? r.startDate ?? today : null,
        admissionNo: have.keepAdmissionNos ? r.admissionNo : null, ...createStamps(),
      });
      if (have.keepIdNumbers && r.idNumber) batch.set(ref(orgId, 'studentPrivate', personId), { orgId, idNumber: r.idNumber, notes: '', ...createStamps() });
    }
    writes.push(trackWrite(batch.commit()));
  }
  return Promise.all(writes).then(() => undefined);
}
