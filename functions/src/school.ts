import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { periodFor, periodLabel, type ReportType } from './shared/metrics.js';
import { reportsDue } from './shared/reports.js';
import { isTraining } from './shared/organizations.js';
import {
  admissionNumber, buildSchoolReport, certificateSerial, feeBalance, oldestUnpaidDue, OUTCOME_CHECKPOINTS, outcomeDueDate, outcomeId, withDefaults,
  type Assessment, type ClassEvent, type ClassRecord, type Course, type FeePayment, type Invoice, type Mark, type OutcomeStatus, type SchoolReportDoc, type Student,
} from './shared/school.js';
import { todayIn } from './reports.js';

const SYSTEM = 'system';

function yearIn(timeZone: string, at = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(at));
  } catch {
    return at.getUTCFullYear();
  }
}
const system = () => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });

/**
 * A new student gets the next admission number for the year, once, in a transaction (so numbers are
 * sequential and never reused), and their person record is marked as a student for class registers.
 */
export const onStudentCreated = onDocumentCreated('organizations/{orgId}/students/{studentId}', async (event) => {
  const { orgId, studentId } = event.params;
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (!org) return;
  const prefix = (org.receiptPrefix as string) || 'ADM';
  const year = yearIn((org.timeZone as string) || DEFAULT_TIME_ZONE);
  const studentRef = db.doc(`organizations/${orgId}/students/${studentId}`);
  const counterRef = db.doc(`organizations/${orgId}/counters/admissions-${year}`);
  await db.runTransaction(async (tx) => {
    const [studentSnap, counterSnap] = await Promise.all([tx.get(studentRef), tx.get(counterRef)]);
    if (!studentSnap.exists || studentSnap.get('admissionNo')) return;
    const sequence = ((counterSnap.data()?.last as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { orgId, year, last: sequence, ...system() }, { merge: true });
    tx.update(studentRef, { admissionNo: admissionNumber(prefix, year, sequence), ...system() });
  });
  const person = db.doc(`organizations/${orgId}/people/${studentId}`);
  if ((await person.get()).get('status') !== 'student') await person.update({ status: 'student', ...system() });
});

/**
 * Keeps each student's fee balance up to date whenever an invoice or a fee payment changes,
 * so the arrears list and reports never have to read every gift.
 */
export async function recomputeBalance(orgId: string, studentId: string): Promise<void> {
  const base = db.doc(`organizations/${orgId}`);
  const [inv, gifts] = await Promise.all([
    base.collection('invoices').where('studentId', '==', studentId).get(),
    base.collection('gifts').where('personId', '==', studentId).get(),
  ]);
  const invoices = inv.docs.map((d) => ({ id: d.id, ...d.data() }) as Invoice);
  const payments = gifts.docs.map((d) => d.data() as FeePayment);
  const b = feeBalance(studentId, invoices, payments);
  await db.doc(`organizations/${orgId}/feeBalances/${studentId}`).set({
    orgId, studentId, ...b, oldestDue: oldestUnpaidDue(invoices, b.paidCents), updatedAt: FieldValue.serverTimestamp(),
  });
}

async function isCollege(orgId: string): Promise<boolean> {
  return (await db.doc(`organizations/${orgId}`).get()).get('type') === 'college';
}

export const onInvoiceWritten = onDocumentWritten('organizations/{orgId}/invoices/{invoiceId}', async (event) => {
  const after = event.data?.after.data() ?? event.data?.before.data();
  if (after?.studentId) await recomputeBalance(event.params.orgId, after.studentId as string);
});

export const onFeePaymentWritten = onDocumentWritten('organizations/{orgId}/gifts/{giftId}', async (event) => {
  const { orgId } = event.params;
  const ids = new Set<string>();
  for (const snap of [event.data?.before, event.data?.after]) {
    const d = snap?.exists ? snap.data() : undefined;
    if (d?.personId) ids.add(d.personId as string);
  }
  if (!ids.size || !(await isCollege(orgId))) return;
  for (const id of ids) {
    if ((await db.doc(`organizations/${orgId}/students/${id}`).get()).exists) await recomputeBalance(orgId, id);
  }
});

/**
 * Issuing a certificate gives it the next serial number, marks the student as graduated, and creates the
 * 3, 6 and 12 month employment follow-ups. Runs once per certificate (the id is the student's id).
 */
export const onCertificateCreated = onDocumentCreated('organizations/{orgId}/certificates/{studentId}', async (event) => {
  const { orgId, studentId } = event.params;
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  const cert = event.data?.data();
  if (!org || !cert) return;
  const prefix = (org.receiptPrefix as string) || 'ADM';
  const year = yearIn((org.timeZone as string) || DEFAULT_TIME_ZONE);
  const certRef = db.doc(`organizations/${orgId}/certificates/${studentId}`);
  const counterRef = db.doc(`organizations/${orgId}/counters/certificates-${year}`);
  await db.runTransaction(async (tx) => {
    const [c, counter] = await Promise.all([tx.get(certRef), tx.get(counterRef)]);
    if (!c.exists || c.get('serial')) return;
    const sequence = ((counter.data()?.last as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { orgId, year, last: sequence, ...system() }, { merge: true });
    tx.update(certRef, { serial: certificateSerial(prefix, year, sequence), ...system() });
  });
  await db.doc(`organizations/${orgId}/students/${studentId}`).update({ status: 'graduated', graduatedOn: cert.issuedOn, ...system() });
  const stamps = { deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: SYSTEM, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM };
  for (const months of OUTCOME_CHECKPOINTS) {
    const ref = db.doc(`organizations/${orgId}/outcomes/${outcomeId(studentId, months)}`);
    if (!(await ref.get()).exists) {
      await ref.set({ orgId, studentId, months, due: outcomeDueDate(cert.issuedOn as string, months), status: null, note: '', recordedOn: null, ...stamps });
    }
  }
});

// ---- Reports to the director -------------------------------------------------------------------

const rows = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });

/** Reads everything a school report needs for one organization. */
export async function loadSchool(orgId: string) {
  const base = db.doc(`organizations/${orgId}`);
  const [courses, students, events, attendance, assessments, marks, invoices, gifts, outcomes, people, settings] = await Promise.all([
    base.collection('courses').get(),
    base.collection('students').get(),
    base.collection('events').where('type', '==', 'class').get(),
    base.collection('attendance').get(),
    base.collection('assessments').get(),
    base.collection('marks').get(),
    base.collection('invoices').get(),
    base.collection('gifts').where('status', '==', 'confirmed').get(),
    base.collection('outcomes').get(),
    base.collection('people').where('status', '==', 'student').get(),
    db.doc(`organizations/${orgId}/schoolSettings/main`).get(),
  ]);
  const studentRows = rows(students);
  const names: Record<string, string> = {};
  for (const p of rows(people)) names[p.id] = p.fullName as string;
  const studentIds = new Set(studentRows.map((s) => s.id));
  const classRecords = rows(attendance).map((r) => r as unknown as ClassRecord);
  return {
    input: {
      courses: rows(courses) as unknown as Course[],
      students: studentRows as unknown as Student[],
      events: rows(events) as unknown as ClassEvent[],
      records: classRecords,
      assessments: rows(assessments) as unknown as Assessment[],
      marks: rows(marks) as unknown as Mark[],
      invoices: rows(invoices) as unknown as Invoice[],
      payments: rows(gifts).filter((g) => studentIds.has(g.personId as string)) as unknown as FeePayment[],
      outcomes: rows(outcomes).map((o) => ({ studentId: o.studentId as string, months: o.months as number, status: (o.status ?? null) as OutcomeStatus | null })),
      settings: withDefaults(settings.data() as never),
      dueOutcomes: rows(outcomes).map((o) => ({ studentId: o.studentId as string, months: o.months as number, due: o.due as string, status: (o.status ?? null) as string | null })),
    },
    names,
  };
}

export async function generateSchoolReport(orgId: string, type: ReportType, from: string, now = new Date(), by: string = SYSTEM): Promise<string> {
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (!org) throw new Error('Organization not found');
  const today = todayIn((org.timeZone as string) ?? DEFAULT_TIME_ZONE, now);
  const period = periodFor(type, from);
  const { input, names } = await loadSchool(orgId);
  const doc: SchoolReportDoc = buildSchoolReport(input, names, type, period, periodLabel(type, period), today);
  const id = `${type}_${period.from}`;
  await db.doc(`organizations/${orgId}/schoolReports/${id}`).set({
    ...doc, orgId, orgName: org.name, generatedAt: FieldValue.serverTimestamp(), generatedBy: by,
  });
  return id;
}

export const onSchoolReportRequested = onDocumentCreated(
  { document: 'organizations/{orgId}/schoolReportRequests/{requestId}', memory: '512MiB', timeoutSeconds: 300 },
  async (event) => {
    const req = event.data?.data();
    if (!req || !event.data) return;
    try {
      if (req.type !== 'weekly' && req.type !== 'monthly') throw new Error('Unknown report type');
      const id = await generateSchoolReport(event.params.orgId, req.type as ReportType, req.from as string, new Date(), req.createdBy as string);
      await event.data.ref.update({ status: 'done', reportId: id, doneAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error(`School report request ${event.params.requestId} failed`, err);
      await event.data.ref.update({ status: 'failed', error: 'The report could not be made. Please try again.', doneAt: FieldValue.serverTimestamp() });
    }
  },
);

export async function runScheduledSchoolReports(now = new Date()): Promise<string[]> {
  const made: string[] = [];
  const orgs = await db.collection('organizations').where('type', '==', 'college').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false || isTraining({ id: org.id, training: org.get('training') })) continue;
    const today = todayIn((org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE, now);
    for (const { type, period } of reportsDue(today)) {
      try {
        made.push(`${org.id}/${await generateSchoolReport(org.id, type, period.from, now)}`);
      } catch (err) {
        logger.error(`School report ${org.id} ${type} failed`, err);
      }
    }
  }
  return made;
}

export const scheduledSchoolReports = onSchedule(
  { schedule: 'every day 07:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', memory: '1GiB', timeoutSeconds: 540 },
  async () => { await runScheduledSchoolReports(); },
);
