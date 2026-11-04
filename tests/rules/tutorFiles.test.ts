import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

/** ADIA Tutor Files (Andy, 2026-11-04): the principal asks, tutors read; files are written only by Cloud Functions. */
let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const request = (by: string) => ({
  orgId: 'adia', title: 'Term 1 report', kind: 'report', deadline: '2026-11-20', courseIds: [], note: '', createdByName: 'Flavier Akinyi',
  deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: by, updatedAt: serverTimestamp(), updatedBy: by,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { extraPermissions: [], orgIds: ['adia'], allOrgs: false, active: true, mustChangePassword: false };
    await setDoc(doc(db, 'users/principal'), { ...base, email: 'p@example.org', displayName: 'Flavier Akinyi', roleId: 'principal', permissions: ['exams.manage', 'school.manage'] });
    await setDoc(doc(db, 'users/jane'), { ...base, email: 'j@example.org', displayName: 'Jane', roleId: 'trainer', permissions: ['exams.mark'] });
    await setDoc(doc(db, 'users/tom'), { ...base, email: 't@example.org', displayName: 'Tom', roleId: 'trainer', permissions: ['exams.mark'] });
    await setDoc(doc(db, 'organizations/adia/fileRequests/r1'), { ...request('principal'), createdAt: new Date(), updatedAt: new Date() });
    await setDoc(doc(db, 'organizations/adia/tutorFiles/r1_jane'), { orgId: 'adia', tutorUid: 'jane', status: 'sent' });
  });
});

describe('tutor files rules', () => {
  it('the principal asks for a file; a tutor cannot', async () => {
    await assertSucceeds(setDoc(doc(as('principal'), 'organizations/adia/fileRequests/r2'), request('principal')));
    await assertFails(setDoc(doc(as('jane'), 'organizations/adia/fileRequests/r3'), request('jane')));
  });
  it('tutors read requests and only their own files', async () => {
    await assertSucceeds(getDocs(collection(as('jane'), 'organizations/adia/fileRequests')));
    await assertSucceeds(getDocs(query(collection(as('jane'), 'organizations/adia/tutorFiles'), where('tutorUid', '==', 'jane'))));
    await assertSucceeds(getDoc(doc(as('jane'), 'organizations/adia/tutorFiles/lesson_x_jane')));
    await assertFails(getDoc(doc(as('tom'), 'organizations/adia/tutorFiles/r1_jane')));
    await assertFails(getDocs(collection(as('tom'), 'organizations/adia/tutorFiles')));
    await assertSucceeds(getDocs(collection(as('principal'), 'organizations/adia/tutorFiles')));
  });
  it('nobody writes a file record from the app, so a sent file stays locked', async () => {
    await assertFails(setDoc(doc(as('jane'), 'organizations/adia/tutorFiles/r1_jane'), { orgId: 'adia', tutorUid: 'jane', status: 'returned' }));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/tutorFiles/r1_jane'), { orgId: 'adia', tutorUid: 'jane', status: 'approved' }));
  });
});
