import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const CLS = 'organizations/adia/classTimetables/Cohort-4__s1__fd';
const EX = 'organizations/adia/examTimetables/Cohort-4__final__s1__2026-12';
const P = [{ start: '08:00', end: '10:00', label: '', isBreak: false }];
const cls = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'adia', cohort: 'Cohort 4', semester: 1, courseId: 'fd', periods: P, saturday: false, slots: {}, from: null, to: null, published: false, publishedOn: null, changedOn: null, ...created(uid), ...over });
const ex = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'adia', cohort: 'Cohort 4', paper: 'final', semester: 1, month: '2026-12', name: 'End of semester exams · Semester 1 · Dec 2026', rows: [], published: false, publishedOn: null, changedOn: null, ...created(uid), ...over });
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const u = (roleId: string, permissions: string[]) => ({ email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/principal'), u('principal', ['people.read', 'exams.manage', 'school.manage']));
    await setDoc(doc(db, 'users/admin'), u('admin', ['people.read', 'people.write']));
    await setDoc(doc(db, 'users/trainer'), u('trainer', ['exams.mark']));
  });
});

describe('timetables', () => {
  it('drafts are for the keepers; published ones for everyone at ADIA', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), CLS), cls('admin')));
    await assertFails(getDoc(doc(as('trainer'), CLS)));
    await assertFails(setDoc(doc(as('trainer'), 'organizations/adia/classTimetables/x'), cls('trainer')));
    await assertSucceeds(updateDoc(doc(as('principal'), CLS), { 'slots.0-0': { course: 'Tailoring', sheetId: 's', lecturer: 'Mary', lecturerUid: 'trainer', room: 'Room 1' }, published: true, publishedOn: '2026-11-20', ...stamp('principal') }));
    await assertSucceeds(getDoc(doc(as('trainer'), CLS)));
    await assertSucceeds(getDocs(query(collection(as('trainer'), 'organizations/adia/classTimetables'), where('published', '==', true))));
    await assertFails(updateDoc(doc(as('trainer'), CLS), { saturday: true, ...stamp('trainer') }));
    await assertFails(updateDoc(doc(as('admin'), CLS), { semester: 2, ...stamp('admin') }));
  });

  it('exam lists and rooms', async () => {
    await assertSucceeds(setDoc(doc(as('principal'), EX), ex('principal')));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/examTimetables/y'), ex('principal', { paper: 'mock' })));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/examTimetables/z'), ex('principal', { month: 'Dec 2026' })));
    await assertFails(getDoc(doc(as('trainer'), EX)));
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/adia/timetableSetup/main'), { orgId: 'adia', rooms: ['Room 1'], ...created('admin') }));
    await assertSucceeds(getDoc(doc(as('trainer'), 'organizations/adia/timetableSetup/main')));
    await assertFails(setDoc(doc(as('trainer'), 'organizations/adia/timetableSetup/main'), { orgId: 'adia', rooms: [], ...created('trainer') }));
  });
});
