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
  it('lets only the principal set up a course, and the trainer key in, submit, then wait for approval', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/examSheets/net');
    await assertFails(setDoc(ref('staff'), sheet('staff')));
    await assertFails(setDoc(ref('grace'), sheet('grace')));
    await assertFails(setDoc(ref('principal'), { ...sheet('principal', 'grace'), status: 'submitted' }));
    await assertSucceeds(setDoc(ref('principal'), sheet('principal', 'grace')));
    await assertFails(getDoc(ref('otto')));
    await assertSucceeds(getDoc(ref('grace')));
    await assertFails(updateDoc(ref('otto'), { 'marks.s1.cat1': 50, ...touched('otto') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'marks.s1.cat1': 50, 'marks.s1.cat2': 'ABS', ...touched('grace') }));
    // The trainer can't change the course, the weighting or who owns it.
    await assertFails(updateDoc(ref('grace'), { ownerUid: 'otto', ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { courseName: 'Other', ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { weights: { ...weights, final: { max: 100, wt: 90 } }, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'approved', approvedAt: serverTimestamp(), ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'submitted', ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { status: 'submitted', submittedAt: serverTimestamp(), ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'marks.s1.cat2': 60, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'draft', ...touched('grace') }));
    // The principal sends it back with a note, then approves it.
    await assertSucceeds(updateDoc(ref('principal'), { status: 'draft', returnNote: 'Check CAT 2', ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'marks.s1.cat3': 70, ...touched('grace') }));
    await assertFails(updateDoc(ref('principal'), { status: 'approved', ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('principal'), { status: 'approved', approvedAt: serverTimestamp(), approvedByName: 'Principal', returnNote: null, ...touched('principal') }));
    await assertFails(updateDoc(ref('grace'), { 'marks.s1.resit': 60, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { 'marks.s1.resit': 60, ownerUid: 'otto', ownerName: 'Otto', teacherName: 'Otto', ...touched('principal') }));
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
    await assertSucceeds(updateDoc(ref('grace'), { marks: { s1: { cat1: 50, cat2: 'EX' }, s2: { final: 70 } }, ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('principal'), { semester: 2, ...touched('principal') }));
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
});
