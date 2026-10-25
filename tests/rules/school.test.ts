import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
const O = 'organizations/adia';
const ADMIN_PERMS = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage'];

const student = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'adia', courseId: 'ict', intakeId: 'jan', level: 'Level 1', status: 'enrolled', admissionNo: null, sponsors: [{ name: 'Mrs Otieno', phone: '+254722000000' }], ...created(uid), ...over,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (permissions: string[], extra: Record<string, unknown>) => ({ email: 'x@example.org', displayName: 'x', roleId: 'admin', extraPermissions: [], orgIds: [], allOrgs: false, permissions, active: true, ...extra });
    await setDoc(doc(db, 'users/adiaAdmin'), user(ADMIN_PERMS, { orgIds: ['adia'] }));
    await setDoc(doc(db, 'users/adiaDirector'), user([...ADMIN_PERMS, 'settings.manage'], { orgIds: ['adia'] }));
    await setDoc(doc(db, `${O}/courses/ict`), { orgId: 'adia', name: 'ICT', levels: ['Level 1'], units: [], timetable: [], active: true, ...stamps });
    await setDoc(doc(db, `${O}/intakes/jan`), { orgId: 'adia', courseId: 'ict', name: 'Jan 2027', startDate: '2027-01-11', capacity: 30, active: true, ...stamps });
    await setDoc(doc(db, `${O}/students/s1`), { ...student('pastor'), admissionNo: 'ADIA/2026/0001', createdAt: old, updatedAt: old });
    await setDoc(doc(db, `${O}/studentPrivate/s1`), { orgId: 'adia', idNumber: '12345678', notes: '', ...stamps });
    await setDoc(doc(db, `${O}/assessments/cat1`), { orgId: 'adia', courseId: 'ict', unitId: 'web', type: 'continuous', name: 'CAT 1', maxMarks: 20, date: '2026-10-01', ...stamps });
    await setDoc(doc(db, `${O}/invoices/i1`), { orgId: 'adia', studentId: 's1', items: [], totalCents: 3_000_000, dueDate: '2026-10-01', label: 'Term 1', status: 'open', ...stamps });
    await setDoc(doc(db, `${O}/feeBalances/s1`), { orgId: 'adia', studentId: 's1', billedCents: 3_000_000, paidCents: 0, balanceCents: 3_000_000 });
    await setDoc(doc(db, `${O}/outcomes/s1_m3`), { orgId: 'adia', studentId: 's1', months: 3, due: '2027-02-01', status: null, note: '', recordedOn: null, ...stamps });
    await setDoc(doc(db, `${O}/schoolReports/weekly_2026-10-12`), { orgId: 'adia', type: 'weekly', arrears: [{ name: 'Amani Sample' }] });
  });
});

describe('ADIA courses and intakes', () => {
  it('lets staff read them, and only settings staff change them', async () => {
    await assertSucceeds(getDoc(doc(as('adiaAdmin'), `${O}/courses/ict`)));
    const course = (uid: string) => ({ orgId: 'adia', name: 'Dressmaking', levels: [], units: [{ id: 'cut', name: 'Cutting', level: '', trainer: 'Ms Achieng' }], timetable: [], active: true, ...created(uid) });
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/courses/dress`), course('adiaAdmin')));
    await assertSucceeds(setDoc(doc(as('adiaDirector'), `${O}/courses/dress`), course('adiaDirector')));
    await assertFails(getDoc(doc(as('admin'), `${O}/courses/ict`))); // a staff member of another campus
  });
  it('keeps an intake tied to a real course', async () => {
    const intake = (uid: string, courseId: string) => ({ orgId: 'adia', courseId, name: 'May 2027', startDate: '2027-05-10', capacity: null, active: true, ...created(uid) });
    await assertSucceeds(setDoc(doc(as('adiaDirector'), `${O}/intakes/may`), intake('adiaDirector', 'ict')));
    await assertFails(setDoc(doc(as('adiaDirector'), `${O}/intakes/bad`), intake('adiaDirector', 'nope')));
  });
});

describe('ADIA students', () => {
  it('lets an admin enrol a student, but not give them an admission number or graduate them', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/people/s2`), { orgId: 'adia', fullName: 'Student Two', firstName: 'Student', status: 'student', whatsappConsent: {}, ...stamps }); });
    const ref = doc(as('adiaAdmin'), `${O}/students/s2`);
    await assertFails(setDoc(ref, student('adiaAdmin', { admissionNo: 'ADIA/2026/9999' })));
    await assertFails(setDoc(ref, student('adiaAdmin', { status: 'graduated' })));
    await assertSucceeds(setDoc(ref, student('adiaAdmin')));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/students/ghost`), student('adiaAdmin')));
  });
  it('keeps an admission number from an imported class list only for staff with Settings', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/people/s3`), { orgId: 'adia', fullName: 'Student Three', firstName: 'Student', status: 'student', whatsappConsent: {}, ...stamps }); });
    await assertFails(setDoc(doc(as('pastor'), `${O}/students/s3`), student('pastor', { admissionNo: 'x'.repeat(41) })));
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/students/s3`), student('pastor', { admissionNo: 'ADIA/045' })));
  });
  it('lets an admin withdraw a student, but not change the admission number', async () => {
    const ref = doc(as('adiaAdmin'), `${O}/students/s1`);
    await assertFails(updateDoc(ref, { admissionNo: 'ADIA/2026/0002', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertFails(updateDoc(ref, { status: 'graduated', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertSucceeds(updateDoc(ref, { status: 'withdrawn', withdrawnOn: '2026-10-18', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertFails(deleteDoc(ref));
  });
  it('lets staff with Settings correct an admission number, changing nothing else', async () => {
    const ref = doc(as('pastor'), `${O}/students/s1`);
    await assertFails(updateDoc(ref, { admissionNo: 'ADIA/2026/0009', status: 'withdrawn', updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
    await assertFails(updateDoc(ref, { admissionNo: '', updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
    await assertSucceeds(updateDoc(ref, { admissionNo: 'ADIA/2026/0009', updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
  });
  it('keeps identity numbers to the pastor', async () => {
    await assertFails(getDoc(doc(as('adiaAdmin'), `${O}/studentPrivate/s1`)));
    await assertFails(getDoc(doc(as('adiaDirector'), `${O}/studentPrivate/s1`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${O}/studentPrivate/s1`)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/studentPrivate/s1`), { orgId: 'adia', idNumber: '1', notes: '', ...created('adiaAdmin') }));
    await assertSucceeds(updateDoc(doc(as('pastor'), `${O}/studentPrivate/s1`), { idNumber: '99999999', updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
  });
});

describe('ADIA results', () => {
  const mark = (uid: string, marks: number, over: Record<string, unknown> = {}) => ({ orgId: 'adia', assessmentId: 'cat1', studentId: 's1', marks, ...created(uid), ...over });
  it('lets an admin record marks, never above the maximum', async () => {
    const ref = doc(as('adiaAdmin'), `${O}/marks/cat1_s1`);
    await assertSucceeds(setDoc(ref, mark('adiaAdmin', 18)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/marks/cat1_s1`), mark('adiaAdmin', 21)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/marks/wrongid`), mark('adiaAdmin', 5)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/marks/cat1_s1`), mark('adiaAdmin', -1)));
  });
  it('lets an admin set a test, with a sensible maximum', async () => {
    const test = (max: number) => ({ orgId: 'adia', courseId: 'ict', unitId: 'web', type: 'exam', name: 'Exam', maxMarks: max, date: '2026-10-20', ...created('adiaAdmin') });
    await assertSucceeds(setDoc(doc(as('adiaAdmin'), `${O}/assessments/exam`), test(100)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/assessments/zero`), test(0)));
  });
});

describe('ADIA fees', () => {
  it('lets cashiers raise invoices and read balances, and nobody write balances', async () => {
    const invoice = (total: number) => ({ orgId: 'adia', studentId: 's1', items: [{ name: 'Tuition', amountCents: total }], totalCents: total, dueDate: '2026-11-01', label: 'Term 2', status: 'open', ...created('adiaAdmin') });
    await assertSucceeds(setDoc(doc(as('adiaAdmin'), `${O}/invoices/i2`), invoice(2_000_000)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/invoices/i3`), { ...invoice(5), status: 'void' }));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/invoices/i4`), { ...invoice(5), studentId: 'nobody' }));
    await assertSucceeds(getDoc(doc(as('adiaAdmin'), `${O}/feeBalances/s1`)));
    await assertSucceeds(getDocs(collection(as('adiaAdmin'), `${O}/feeBalances`)));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/feeBalances/s1`), { orgId: 'adia', balanceCents: 0 }));
    await assertFails(setDoc(doc(as('pastor'), `${O}/feeBalances/s1`), { orgId: 'adia', balanceCents: 0 }));
  });
  it('lets an invoice be voided but never have its amount changed or be deleted', async () => {
    const ref = doc(as('adiaAdmin'), `${O}/invoices/i1`);
    await assertFails(updateDoc(ref, { totalCents: 1, updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertSucceeds(updateDoc(ref, { status: 'void', voidReason: 'Wrong student', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertFails(deleteDoc(ref));
  });
  it('keeps fee structures to settings staff', async () => {
    const s = (uid: string) => ({ orgId: 'adia', courseId: 'ict', intakeId: 'jan', items: [{ name: 'Tuition', amountCents: 3_000_000 }], ...created(uid) });
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/feeStructures/ict_jan`), s('adiaAdmin')));
    await assertSucceeds(setDoc(doc(as('adiaDirector'), `${O}/feeStructures/ict_jan`), s('adiaDirector')));
    await assertFails(setDoc(doc(as('adiaDirector'), `${O}/feeStructures/wrong`), s('adiaDirector')));
  });
  it('keeps fee data from staff with no money access', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/teacher'), { email: 't@example.org', displayName: 't', roleId: 'x', extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions: ['people.read', 'attendance.write'], active: true });
    });
    await assertSucceeds(getDoc(doc(as('teacher'), `${O}/students/s1`)));
    await assertFails(getDoc(doc(as('teacher'), `${O}/invoices/i1`)));
    await assertFails(getDoc(doc(as('teacher'), `${O}/feeBalances/s1`)));
  });
});

describe('ADIA certificates, outcomes and reports', () => {
  it('lets only settings staff issue a certificate, with no serial number of their own', async () => {
    const cert = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'adia', studentId: 's1', courseId: 'ict', issuedOn: '2026-12-10', ...created(uid), ...over });
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/certificates/s1`), cert('adiaAdmin')));
    await assertFails(setDoc(doc(as('adiaDirector'), `${O}/certificates/s1`), cert('adiaDirector', { serial: 'ADIA-CERT-2026-0001' })));
    await assertSucceeds(setDoc(doc(as('adiaDirector'), `${O}/certificates/s1`), cert('adiaDirector')));
    await assertFails(updateDoc(doc(as('adiaDirector'), `${O}/certificates/s1`), { issuedOn: '2026-12-11' }));
  });
  it('lets staff record what a graduate is doing, and nothing else about the follow-up', async () => {
    const ref = doc(as('adiaAdmin'), `${O}/outcomes/s1_m3`);
    await assertFails(updateDoc(ref, { due: '2020-01-01', status: 'employed', note: '', recordedOn: '2027-02-02', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertFails(updateDoc(ref, { status: 'rich', note: '', recordedOn: '2027-02-02', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertSucceeds(updateDoc(ref, { status: 'employed', note: 'Tailor at Kikuyu market', recordedOn: '2027-02-02', updatedAt: serverTimestamp(), updatedBy: 'adiaAdmin' }));
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/outcomes/new`), { orgId: 'adia', studentId: 's1', months: 3 }));
  });
  it('shows school reports (with fees) only to the pastor and settings staff, and nobody can edit one', async () => {
    const path = `${O}/schoolReports/weekly_2026-10-12`;
    await assertFails(getDoc(doc(as('adiaAdmin'), path)));
    await assertSucceeds(getDoc(doc(as('adiaDirector'), path)));
    await assertSucceeds(getDoc(doc(as('pastor'), path)));
    await assertFails(updateDoc(doc(as('pastor'), path), { type: 'monthly' }));
    const req = (uid: string) => ({ orgId: 'adia', type: 'weekly', from: '2026-10-12', status: 'pending', createdAt: serverTimestamp(), createdBy: uid });
    await assertFails(setDoc(doc(as('adiaAdmin'), `${O}/schoolReportRequests/r1`), req('adiaAdmin')));
    await assertSucceeds(setDoc(doc(as('adiaDirector'), `${O}/schoolReportRequests/r2`), req('adiaDirector')));
  });
});

describe('ADIA principal', () => {
  const PRINCIPAL_PERMS = ['people.read', 'people.write', 'attendance.write', 'exams.manage', 'school.manage', 'fees.balances'];
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/flavier'), { email: 'f@example.org', displayName: 'Flavier', roleId: 'principal', extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions: PRINCIPAL_PERMS, active: true });
    });
  });
  it('sees each fee balance but no invoices, payments, petty cash or payroll', async () => {
    await assertSucceeds(getDoc(doc(as('flavier'), `${O}/feeBalances/s1`)));
    await assertSucceeds(getDocs(collection(as('flavier'), `${O}/feeBalances`)));
    await assertFails(setDoc(doc(as('flavier'), `${O}/feeBalances/s1`), { orgId: 'adia', balanceCents: 0 }));
    await assertFails(getDoc(doc(as('flavier'), `${O}/invoices/i1`)));
    await assertFails(getDocs(collection(as('flavier'), `${O}/gifts`)));
    await assertFails(getDocs(collection(as('flavier'), `${O}/pettyCash`)));
    await assertFails(getDocs(collection(as('flavier'), `${O}/payrollStaff`)));
    await assertFails(getDoc(doc(as('flavier'), `${O}/schoolReports/weekly_2026-10-12`)));
    await assertFails(getDoc(doc(as('flavier'), 'organizations/freedom/people/p1')));
  });
  it('gives admission numbers and issues certificates, but cannot change programmes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/people/s2`), { orgId: 'adia', fullName: 'Student Two', firstName: 'Student', status: 'student', whatsappConsent: {}, ...stamps }); });
    await assertSucceeds(setDoc(doc(as('flavier'), `${O}/students/s2`), student('flavier', { admissionNo: 'ADIA/2026/0002' })));
    const cert = { orgId: 'adia', studentId: 's1', courseId: 'ict', issuedOn: '2026-12-10', ...created('flavier') };
    await assertSucceeds(setDoc(doc(as('flavier'), `${O}/certificates/s1`), cert));
    await assertFails(setDoc(doc(as('flavier'), `${O}/courses/dress`), { orgId: 'adia', name: 'Dressmaking', levels: [], units: [], timetable: [], active: true, ...created('flavier') }));
  });
});
