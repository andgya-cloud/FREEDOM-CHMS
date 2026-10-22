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
  it('lets a trainer key in only their own sheet, and locks it once submitted', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/examSheets/net');
    await assertFails(setDoc(ref('staff'), sheet('staff')));
    await assertFails(setDoc(ref('grace'), sheet('grace', 'otto')));
    await assertFails(setDoc(ref('grace'), { ...sheet('grace'), status: 'submitted' }));
    await assertSucceeds(setDoc(ref('grace'), sheet('grace')));
    await assertFails(getDoc(ref('otto')));
    await assertFails(updateDoc(ref('otto'), { 'marks.s1.cat1': 50, ...touched('otto') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'marks.s1.cat1': 50, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { ownerUid: 'otto', ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'submitted', ...touched('grace') }));
    await assertSucceeds(updateDoc(ref('grace'), { status: 'submitted', submittedAt: serverTimestamp(), ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { 'marks.s1.cat2': 60, ...touched('grace') }));
    await assertFails(updateDoc(ref('grace'), { status: 'draft', ...touched('grace') }));
    await assertSucceeds(getDoc(ref('principal')));
    await assertSucceeds(updateDoc(ref('principal'), { 'marks.s1.cat2': 60, ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('principal'), { status: 'draft', ...touched('principal') }));
    await assertSucceeds(updateDoc(ref('grace'), { 'marks.s1.cat3': 70, ...touched('grace') }));
  });

  it('keeps remarks, attendance, grading and the log to the principal', async () => {
    const meta = (uid: string) => ({ orgId: 'adia', cohort: 'September 2026', remarks: {}, attendance: { s1: 90 }, ...stamps(uid) });
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/examMeta/September-2026'), meta('grace')));
    await assertSucceeds(setDoc(doc(as('principal'), 'organizations/adia/examMeta/September-2026'), meta('principal')));
    await assertFails(getDoc(doc(as('grace'), 'organizations/adia/examMeta/September-2026')));
    const settings = (uid: string) => ({ orgId: 'adia', passMark: 70, bands: [{ min: 0, grade: 'Fail', remark: '' }], principalName: 'P', principalTitle: 'Principal', directorName: 'D', directorTitle: 'Director', ...stamps(uid) });
    await assertFails(setDoc(doc(as('grace'), 'organizations/adia/examSettings/main'), settings('grace')));
    await assertSucceeds(setDoc(doc(as('principal'), 'organizations/adia/examSettings/main'), settings('principal')));
    await assertSucceeds(getDoc(doc(as('grace'), 'organizations/adia/examSettings/main')));
    const entry = (uid: string) => ({ orgId: 'adia', action: 'edit', cohort: 'September 2026', sheetId: 'net', detail: 'Changed a mark', byUid: uid, byName: uid, at: serverTimestamp() });
    await assertFails(addDoc(collection(as('grace'), 'organizations/adia/examLog'), entry('grace')));
    await assertFails(addDoc(collection(as('principal'), 'organizations/adia/examLog'), entry('grace')));
    await assertSucceeds(addDoc(collection(as('principal'), 'organizations/adia/examLog'), entry('principal')));
  });
});
