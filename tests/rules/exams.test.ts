import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const stamps = (uid: string) => ({ deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });
const weights = { cat1: { max: 100, wt: 10 }, cat2: { max: 100, wt: 10 }, cat3: { max: 100, wt: 10 }, final: { max: 100, wt: 70 } };
const sheet = (uid: string, owner = uid) => ({
  orgId: 'adia', cohort: 'September 2026', courseId: 'ict', ownerUid: owner, ownerName: owner, courseName: 'Networking', teacherName: 'Grace',
  weights, status: 'draft', submittedAt: null, marks: {}, ...stamps(uid),
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (permissions: string[]) => ({
      email: 'x@example.org', displayName: 'x', roleId: 'staff', extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions, active: true,
    });
    await setDoc(doc(db, 'users/grace'), user(['people.read', 'exams.mark']));
    await setDoc(doc(db, 'users/otto'), user(['people.read', 'exams.mark']));
    await setDoc(doc(db, 'users/principal'), user(['people.read', 'exams.manage']));
    await setDoc(doc(db, 'users/staff'), user(['people.read']));
  });
});

describe('exam records rules', () => {
  it('lets only the principal set up a course, and the trainer key in, send each paper, then wait for approval', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/examSheets/net');
    await assertFails(setDoc(ref('staff'), sheet('staff')));
    await assertFails(setDoc(ref('grace'), sheet('grace')));
    await assertFails(setDoc(ref('principal'), { ...sheet('principal', 'grace'), status: 'submitted' }));
    await assertSucceeds(setDoc(ref('principal'), sheet('principal', 'grace')));
    await assertFails(getDoc(ref('otto')));
    await assertSucceeds(getDoc(ref('grace')));
    await assertFails(updateDoc(ref('otto'), { 'cat1Marks.s1': 50, ...touched('otto') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'cat1Marks.s1': 50, 'cat2Marks.s1': 'ABS', ...touched('grace') }));
    // The old marks map is the principal's only now.
    await assertFails(updateDoc(ref('grace'), { 'marks.s1.cat1': 50, ...touched('grace') }));
    // The trainer sets the percentages (Andy, 2026-10-25) until the first paper is sent, but never a broken one.
    await assertFails(updateDoc(ref('grace'), { weights: { ...weights, final: { max: 0, wt: 70 } }, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { weights: { ...weights, cat1: { max: 30, wt: 15 }, cat3: { max: 100, wt: 0 }, final: { max: 100, wt: 75 } }, ...touched('grace') }));
    // The trainer can't change the course or who owns it.
    await assertFails(updateDoc(ref('grace'), { ownerUid: 'otto', ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { courseName: 'Other', ...touched('grace') }));
    // Sending CAT 1 locks it: no more changes to it, no unlocking it, no more percentage changes.
    await assertSucceeds(updateDoc(ref('grace'), { 'locked.cat1': true, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'cat1Marks.s1': 20, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'locked.cat1': false, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { weights, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'cat2Marks.s1': 60, ...touched('grace') }));
    // Asking to change it, then the principal unlocks it.
    await assertFails(updateDoc(ref('grace'), { changeRequest: { component: 'cat9', reason: 'x', byName: 'Grace' }, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { changeRequest: { component: 'cat1', reason: 'Typed 50 for 5', byName: 'Grace' }, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'locked.cat1': false, changeRequest: null, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { 'locked.cat1': false, changeRequest: null, ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'cat1Marks.s1': 5, ...touched('grace') }));
    // Submitting needs the Final sent too, with the server's time.
    await assertFails(updateDoc(ref('grace'), { status: 'approved', approvedAt: serverTimestamp(), ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'submitted', submittedAt: serverTimestamp(), ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'submitted', 'locked.final': true, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { status: 'submitted', submittedAt: serverTimestamp(), locked: { cat1: true, cat2: true, cat3: true, final: true }, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'finalMarks.s1': 60, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'draft', ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { changeRequest: { component: 'final', reason: 'Missed a script', byName: 'Grace' }, ...touched('grace') }));
    // The principal sends it back with a note, then approves it.
    await assertSucceeds(updateDoc(ref('principal'), { status: 'draft', 'locked.final': false, changeRequest: null, returnNote: 'Check the Final', ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'finalMarks.s1': 70, ...touched('grace') }));
    await assertFails(updateDoc(ref('principal'), { status: 'approved', ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('principal'), { status: 'approved', approvedAt: serverTimestamp(), approvedByName: 'Principal', returnNote: null, ...touched('principal') }));
    await assertFails(updateDoc(ref('grace'), { 'resitMarks.s1': 60, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { 'resitMarks.s1': 60, ownerUid: 'otto', ownerName: 'Otto', teacherName: 'Otto', ...touched('principal') }));
  });

  it('keeps remarks, attendance, grading and the log to the principal', async () => {
    const meta = (uid: string) => ({ orgId: 'adia', cohort: 'September 2026', remarks: {}, attendance: { s1: 90 }, ...stamps(uid) });
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/examMeta/September-2026'), meta('grace')));
    await assertSucceeds(setDoc(doc(as('principal'), 'organizations/adia/examMeta/September-2026'), meta('principal')));
    await assertFails(getDoc(doc(as('grace'), 'organizations/adia/examMeta/September-2026')));
    const settings = (uid: string) => ({ orgId: 'adia', passMark: 70, bands: [{ min: 0, grade: 'Fail', remark: '' }], principalName: 'P', principalTitle: 'Principal', directorName: 'D', directorTitle: 'Director', ...stamps(uid) });
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/examSettings/main'), settings('grace')));
    await assertSucceeds(setDoc(doc(as('principal'), 'organizations/adia/examSettings/main'), settings('principal')));
    await assertFails(updateDoc(doc(as('principal'), 'organizations/adia/examSettings/main'), { weights: { cat1: { max: 100, wt: 10 } }, ...touched('principal') }));
    await assertSucceeds(updateDoc(doc(as('principal'), 'organizations/adia/examSettings/main'), { weights, ...touched('principal') }));
    await assertSucceeds(getDoc(doc(as('grace'), 'organizations/adia/examSettings/main')));
    const entry = (uid: string) => ({ orgId: 'adia', action: 'edit', cohort: 'September 2026', sheetId: 'net', detail: 'Changed a mark', byUid: uid, byName: uid, at: serverTimestamp() });
    await assertFails(addDoc(collection(as('grace'), 'organizations/adia/examLog'), entry('grace')));
    await assertFails(addDoc(collection(as('principal'), 'organizations/adia/examLog'), entry('grace')));
    await assertSucceeds(addDoc(collection(as('principal'), 'organizations/adia/examLog'), entry('principal')));
  });
  it('takes a semester on a sheet, and a whole Excel upload of marks', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/examSheets/sem');
    await assertFails(setDoc(ref('principal'), { ...sheet('principal', 'grace'), semester: 3 }));
    await assertSucceeds(setDoc(ref('principal'), { ...sheet('principal', 'grace'), semester: 1 }));
    await assertFails(updateDoc(ref('grace'), { semester: 2, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { cat1Marks: { s1: 50 }, cat2Marks: { s1: 'EX' }, finalMarks: { s2: 70 }, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { semester: 2, ...touched('principal') }));
    // A full class of 80 with every paper keyed in stays within the server's limits.
    const ids = Array.from({ length: 80 }, (_, i) => `s${i}`);
    const full = Object.fromEntries(ids.map((id) => [id, 55]));
    await assertSucceeds(updateDoc(ref('grace'), { cat1Marks: full, cat2Marks: full, cat3Marks: full, finalMarks: full, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { marks: Object.fromEntries(ids.map((id) => [id, { cat1: 1, cat2: 2, cat3: 3, final: 4 }])), ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'locked.cat1': true, 'cat2Marks.s5': 60, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'cat1Marks.s5': 60, ...touched('grace') }));
  });

  it('keeps past semester results to the principal', async () => {
    const result = (uid: string, extra: Record<string, unknown> = {}) => ({
      orgId: 'adia', cohort: 'Cohort 1', studentId: 's1', admissionNo: 'ADIA/CTR/2025/1/001', studentName: 'Magdaline', courseId: 'ctr',
      semesters: { 1: { points: 62.51, grade: 'CREDIT' }, 2: { points: 62.38, grade: null } }, printed: { points: 65.38, grade: 'CREDIT' }, notes: [], ...stamps(uid), ...extra,
    });
    const ref = (uid: string, id = 's1_Cohort-1') => doc(as(uid), `organizations/adia/examResults/${id}`);
    await assertFails(setDoc(ref('grace'), result('grace')));
    await assertFails(setDoc(ref('principal', 's2_Cohort-1'), result('principal')));
    await assertFails(setDoc(ref('principal'), result('principal', { semesters: { 3: { points: 50, grade: null } } })));
    await assertFails(setDoc(ref('principal'), result('principal', { semesters: { 1: { points: 150, grade: null } } })));
    await assertSucceeds(setDoc(ref('principal'), result('principal')));
    await assertSucceeds(updateDoc(ref('principal'), { 'semesters.2': { points: 63, grade: 'CREDIT' }, ...touched('principal') }));
    await assertFails(getDoc(ref('grace')));
    await assertSucceeds(getDoc(ref('principal')));
  });
  it('dates each cohort, locks a graduated one, and reopens it only with a fresh password', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = (uid: string) => env.authenticatedContext(uid, { auth_time: now }).firestore();
    const stale = (uid: string) => env.authenticatedContext(uid, { auth_time: now - 3600 }).firestore();
    const cohort = (uid: string, extra: Record<string, unknown> = {}) => ({ orgId: 'adia', cohort: 'September 2026', graduationDate: '2026-12-11', closed: false, ...stamps(uid), ...extra });
    const cref = (db: ReturnType<typeof as>) => doc(db, 'organizations/adia/examCohorts/September-2026');
    const sref = (db: ReturnType<typeof as>) => doc(db, 'organizations/adia/examSheets/net');
    await assertSucceeds(setDoc(sref(as('principal')), sheet('principal', 'grace')));
    await assertFails(setDoc(cref(as('grace')), cohort('grace')));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/examCohorts/Other'), cohort('principal')));
    await assertFails(setDoc(cref(as('principal')), cohort('principal', { graduationDate: '11/12/2026' })));
    await assertSucceeds(setDoc(cref(as('principal')), cohort('principal')));
    await assertSucceeds(getDoc(cref(as('grace'))));
    await assertSucceeds(getDoc(cref(as('staff'))));
    // Closed: nobody changes its marks, not even the principal, and no new courses.
    await assertSucceeds(updateDoc(cref(stale('principal')), { closed: true, closedByName: 'Principal', closedAt: serverTimestamp(), ...touched('principal') }));
    await assertFails(updateDoc(sref(as('grace')), { 'cat1Marks.s1': 50, ...touched('grace') }));
    await assertFails(updateDoc(sref(as('principal')), { 'cat1Marks.s1': 50, ...touched('principal') }));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/examSheets/net2'), sheet('principal', 'grace')));
    // Reopening needs the password typed again lately.
    await assertFails(updateDoc(cref(stale('principal')), { closed: false, reopenedByName: 'Principal', ...touched('principal') }));
    await assertFails(updateDoc(cref(fresh('grace')), { closed: false, ...touched('grace') }));
    await assertSucceeds(updateDoc(cref(fresh('principal')), { closed: false, reopenedByName: 'Principal', reopenedAt: serverTimestamp(), ...touched('principal') }));
    await assertSucceeds(updateDoc(sref(as('grace')), { 'cat1Marks.s1': 50, ...touched('grace') }));
  });

  it('lets the principal keep the course list, add a department and start a cohort', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/flavier'), { email: 'f@example.org', displayName: 'Flavier', roleId: 'principal', extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions: ['people.read', 'exams.manage', 'school.manage'], active: true });
    });
    const settings = { orgId: 'adia', passMark: 39, bands: [{ min: 39, grade: 'Pass', remark: '' }], principalName: 'F', principalTitle: 'Principal', directorName: 'A', directorTitle: 'Director', weights, courseList: [{ name: 'Networking', courseId: 'ict', semester: 1 }], ...stamps('flavier') };
    await assertSucceeds(setDoc(doc(as('flavier'), 'organizations/adia/examSettings/main'), settings));
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/examSettings/main'), settings));
    const course = { orgId: 'adia', name: 'Beauty Therapy', levels: [], units: [], timetable: [], active: true, ...stamps('flavier') };
    await assertSucceeds(setDoc(doc(as('flavier'), 'organizations/adia/courses/beauty_therapy'), course));
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/courses/beauty_x'), course));
    const intake = { orgId: 'adia', courseId: 'beauty_therapy', name: 'Cohort 5', startDate: '2027-01-11', capacity: null, active: true, ...stamps('flavier') };
    await assertSucceeds(addDoc(collection(as('flavier'), 'organizations/adia/intakes'), intake));
    await assertFails(addDoc(collection(as('grace'), 'organizations/adia/intakes'), intake));
  });
});
