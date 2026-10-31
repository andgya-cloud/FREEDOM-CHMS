import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const COUNT = 'organizations/adia/inventoryCounts/Cohort-4_ict_start';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
const item = { id: 'i1', name: 'Desktop computer', category: 'Electronics', quantity: 20, unit: 'pcs', condition: 'good', location: 'Lab 1', tag: 'ADIA-001', remarks: '', photo: null };
const count = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'adia', cohort: 'Cohort 4', courseId: 'ict', courseName: 'ICT', phase: 'start', deadline: day(3), status: 'open', items: [],
  reopenRequest: null, reopenUntil: null, reopens: [], ...created(uid), ...over,
});
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const u = (roleId: string, extra: Record<string, unknown>) => ({ email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions: [], active: true, ...extra });
    await setDoc(doc(db, 'users/felix'), u('labtech', { inventoryCourseIds: ['ict'] }));
    await setDoc(doc(db, 'users/claire'), u('trainer', { permissions: ['exams.mark'], trainerCourseIds: ['fashion'], inventoryCourseIds: ['fashion'] }));
    await setDoc(doc(db, 'users/flavier'), u('principal', { permissions: ['people.read', 'attendance.write', 'exams.manage'] }));
    await setDoc(doc(db, 'users/doreenAdmin'), u('admin', { permissions: ['people.read'] }));
  });
});

async function seedCount(over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), COUNT), { ...count('flavier'), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over });
  });
}

describe('inventory counts', () => {
  it('lets Admin, the Principal and the pastor open a count; nobody else', async () => {
    await assertSucceeds(setDoc(doc(as('flavier'), COUNT), count('flavier')));
    await assertSucceeds(setDoc(doc(as('doreenAdmin'), 'organizations/adia/inventoryCounts/Cohort-4_ict_end'), count('doreenAdmin', { phase: 'end' })));
    await assertFails(setDoc(doc(as('felix'), 'organizations/adia/inventoryCounts/x'), count('felix')));
    await assertFails(setDoc(doc(as('flavier'), 'organizations/adia/inventoryCounts/y'), count('flavier', { deadline: '3 Nov' })));
  });

  it('shows the person in charge only their own department', async () => {
    await seedCount();
    await assertSucceeds(getDoc(doc(as('felix'), COUNT)));
    await assertFails(getDoc(doc(as('claire'), COUNT)));
    await assertSucceeds(getDocs(query(collection(as('felix'), 'organizations/adia/inventoryCounts'), where('courseId', '==', 'ict'))));
    await assertSucceeds(getDoc(doc(as('pastor'), COUNT)));
  });

  it('lets them fill in and submit before the deadline, then nothing more', async () => {
    await seedCount();
    await assertSucceeds(updateDoc(doc(as('felix'), COUNT), { items: [item], preparedByName: 'Felix Kimanthi', ...stamp('felix') }));
    await assertFails(updateDoc(doc(as('felix'), COUNT), { deadline: day(30), ...stamp('felix') }));
    await assertFails(updateDoc(doc(as('felix'), COUNT), { status: 'verified', ...stamp('felix') }));
    await assertSucceeds(updateDoc(doc(as('felix'), COUNT), { status: 'submitted', submittedAt: serverTimestamp(), signedName: 'Felix Kimanthi', ...stamp('felix') }));
    await assertFails(updateDoc(doc(as('felix'), COUNT), { items: [], ...stamp('felix') }));
    await assertSucceeds(updateDoc(doc(as('flavier'), COUNT), { status: 'verified', verifiedByName: 'Flavier Akinyi', verifiedAt: serverTimestamp(), ...stamp('flavier') }));
  });

  it('closes the form after the deadline until Admin reopens it', async () => {
    await seedCount({ deadline: day(-2) });
    await assertFails(updateDoc(doc(as('felix'), COUNT), { items: [item], ...stamp('felix') }));
    await assertSucceeds(updateDoc(doc(as('felix'), COUNT), { reopenRequest: { reason: 'I was sick', byName: 'Felix' }, ...stamp('felix') }));
    await assertFails(updateDoc(doc(as('felix'), COUNT), { reopenUntil: day(3), ...stamp('felix') }));
    await assertSucceeds(updateDoc(doc(as('doreenAdmin'), COUNT), { reopenUntil: day(2), reopenRequest: null, reopens: [{ reason: 'I was sick', byName: 'Felix', grantedByName: 'Doreen', until: day(2), at: day(0) }], ...stamp('doreenAdmin') }));
    await assertSucceeds(updateDoc(doc(as('felix'), COUNT), { items: [item], ...stamp('felix') }));
  });

  it('keeps photos to those who may read the department', async () => {
    const photo = (uid: string, courseId = 'ict') => ({ orgId: 'adia', courseId, data: 'data:image/jpeg;base64,AAAA', ...created(uid) });
    await assertSucceeds(setDoc(doc(as('felix'), 'organizations/adia/inventoryPhotos/p1'), photo('felix')));
    await assertFails(setDoc(doc(as('felix'), 'organizations/adia/inventoryPhotos/p2'), photo('felix', 'fashion')));
    await assertFails(setDoc(doc(as('felix'), 'organizations/adia/inventoryPhotos/p3'), { ...photo('felix'), data: 'javascript:alert(1)' }));
    await assertSucceeds(getDoc(doc(as('flavier'), 'organizations/adia/inventoryPhotos/p1')));
    await assertFails(getDoc(doc(as('claire'), 'organizations/adia/inventoryPhotos/p1')));
  });
});

describe('clean-up bin', () => {
  it('is reached only through the Clean-up functions, even by the pastor', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/cleanupBin/b1'), { orgId: 'adia', label: 'Test student', state: 'bin' });
    });
    await assertFails(getDoc(doc(as('pastor'), 'organizations/adia/cleanupBin/b1')));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/adia/cleanupBin/b2'), { orgId: 'adia' }));
    await assertFails(getDoc(doc(as('felix'), 'organizations/adia/cleanupBin/b1')));
  });
});
