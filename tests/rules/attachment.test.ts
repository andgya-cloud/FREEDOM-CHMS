import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const PATH = 'organizations/adia/attachments/s1';
const rec = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'adia', studentId: 's1', cohort: 'Cohort 4', logBook: false, logBookOn: null, status: 'not_placed', assessed: false, mark: null,
  company: '', location: '', supervisor: '', supervisorPhone: '', from: null, to: null, ...created(uid), ...over,
});
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const u = (roleId: string, permissions: string[]) => ({ email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/principal'), u('principal', ['people.read', 'people.write', 'attendance.write', 'exams.manage', 'school.manage']));
    await setDoc(doc(db, 'users/admin'), u('admin', ['people.read', 'people.write', 'settings.manage']));
    await setDoc(doc(db, 'users/doreen'), u('pastor', ['people.read', 'users.manage']));
    await setDoc(doc(db, 'users/trainer'), u('trainer', ['exams.mark', 'attendance.write']));
    await setDoc(doc(db, 'users/staff'), u('staff', ['people.read']));
  });
});

describe('industrial attachment', () => {
  it('is kept by the principal, admin and users.manage; other school staff only read', async () => {
    await assertSucceeds(setDoc(doc(as('principal'), PATH), rec('principal')));
    await assertSucceeds(updateDoc(doc(as('admin'), PATH), { logBook: true, logBookOn: '2026-11-19', status: 'placed', company: 'Vivo', from: '2026-11-03', ...stamp('admin') }));
    await assertSucceeds(updateDoc(doc(as('doreen'), PATH), { assessed: true, mark: 78, ...stamp('doreen') }));
    await assertSucceeds(getDoc(doc(as('staff'), PATH)));
    await assertSucceeds(getDoc(doc(as('trainer'), PATH)));
    await assertFails(updateDoc(doc(as('staff'), PATH), { status: 'ongoing', ...stamp('staff') }));
    await assertFails(setDoc(doc(as('staff'), 'organizations/adia/attachments/s2'), { ...rec('staff'), studentId: 's2' }));
  });

  it('checks every field', async () => {
    await assertSucceeds(setDoc(doc(as('principal'), PATH), rec('principal')));
    await assertFails(updateDoc(doc(as('principal'), PATH), { status: 'lost', ...stamp('principal') }));
    await assertFails(updateDoc(doc(as('principal'), PATH), { mark: 101, ...stamp('principal') }));
    await assertFails(updateDoc(doc(as('principal'), PATH), { from: '3 Nov', ...stamp('principal') }));
    await assertFails(updateDoc(doc(as('principal'), PATH), { extra: 1, ...stamp('principal') }));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/attachments/s9'), rec('principal')));
  });

  it('keeps the file list for the function only', async () => {
    await assertSucceeds(getDoc(doc(as('staff'), 'organizations/adia/attachmentFiles/s1')));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/attachmentFiles/s1'), { orgId: 'adia', studentId: 's1' }));
  });
});
