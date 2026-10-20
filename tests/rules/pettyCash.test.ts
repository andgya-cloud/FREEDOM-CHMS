import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const TEAM_WORK = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'followups.manage'];

const newRequest = (uid: string) => ({
  orgId: 'adia', number: null, requesterId: uid, requesterName: uid, category: 'Staff Payments',
  items: [{ description: 'Stationery', amountCents: 1500000 }], totalCents: 1500000, month: '2026-10',
  status: 'submitted', checked: null, approved: null, rejection: null,
  deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid,
});
const stamp = (uid: string, role: string) => ({ uid, name: uid, role, at: serverTimestamp() });
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (roleId: string, permissions: string[], orgIds: string[]) => ({
      email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds, allOrgs: false, permissions, active: true,
    });
    await setDoc(doc(db, 'users/doreen'), user('staff', [...TEAM_WORK, 'pettycash.request'], ['adia']));
    await setDoc(doc(db, 'users/ronald'), user('staff', [...TEAM_WORK, 'pettycash.request'], ['adia']));
    await setDoc(doc(db, 'users/eliz'), user('head', [...TEAM_WORK, 'team.manage', 'pettycash.check', 'pettycash.request'], ['adia']));
    await setDoc(doc(db, 'users/elias'), user('staff', [...TEAM_WORK, 'pettycash.approve'], ['adia']));
    await setDoc(doc(db, 'users/plainHead'), user('head', [...TEAM_WORK, 'team.manage'], ['adia']));
    await setDoc(doc(db, 'users/fcnAcc'), user('staff', [...TEAM_WORK, 'pettycash.check'], ['fcn']));
  });
});

async function seedRequest(id: string, data: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `organizations/adia/pettyCash/${id}`), { ...newRequest('doreen'), createdAt: new Date(), updatedAt: new Date(), ...data });
  });
}

describe('petty cash', () => {
  it('lets a requester submit their own request only, and see only their own', async () => {
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/a'), newRequest('doreen')));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/b'), newRequest('ronald')));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/c'), { ...newRequest('doreen'), status: 'approved' }));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/d'), { ...newRequest('doreen'), number: 'ADIA-00001' }));
    await assertFails(setDoc(doc(as('plainHead'), 'organizations/adia/pettyCash/e'), newRequest('plainHead')));
    await assertSucceeds(getDoc(doc(as('doreen'), 'organizations/adia/pettyCash/a')));
    await assertFails(getDoc(doc(as('ronald'), 'organizations/adia/pettyCash/a')));
    await assertSucceeds(getDocs(query(collection(as('ronald'), 'organizations/adia/pettyCash'), where('requesterId', '==', 'ronald'))));
    await assertFails(getDocs(collection(as('ronald'), 'organizations/adia/pettyCash')));
    await assertSucceeds(getDocs(collection(as('eliz'), 'organizations/adia/pettyCash')));
  });

  it('keeps people without petty cash, and other organizations, out', async () => {
    await seedRequest('r1');
    await assertFails(getDoc(doc(as('plainHead'), 'organizations/adia/pettyCash/r1')));
    await assertFails(getDoc(doc(as('fcnAcc'), 'organizations/adia/pettyCash/r1')));
    await assertFails(getDoc(doc(as('admin'), 'organizations/adia/pettyCash/r1')));
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/adia/pettyCash/r1')));
  });

  it('goes accountant, then a different board member, never on your own request', async () => {
    await seedRequest('r1');
    // The board member cannot skip the accountant.
    await assertFails(updateDoc(doc(as('elias'), 'organizations/adia/pettyCash/r1'), { status: 'approved', approved: stamp('elias', 'Board member'), ...touched('elias') }));
    // The requester cannot check their own request.
    await assertFails(updateDoc(doc(as('doreen'), 'organizations/adia/pettyCash/r1'), { status: 'checked', checked: stamp('doreen', 'Accountant'), ...touched('doreen') }));
    // Nobody can change the amount while checking.
    await assertFails(updateDoc(doc(as('eliz'), 'organizations/adia/pettyCash/r1'), { status: 'checked', totalCents: 1, checked: stamp('eliz', 'Accountant'), ...touched('eliz') }));
    await assertSucceeds(updateDoc(doc(as('eliz'), 'organizations/adia/pettyCash/r1'), { status: 'checked', checked: stamp('eliz', 'Accountant'), ...touched('eliz') }));
    await assertFails(updateDoc(doc(as('elias'), 'organizations/adia/pettyCash/r1'), { status: 'approved', approved: stamp('elias', 'Board member'), checked: null, ...touched('elias') }));
    await assertSucceeds(updateDoc(doc(as('elias'), 'organizations/adia/pettyCash/r1'), { status: 'approved', approved: stamp('elias', 'Board member'), ...touched('elias') }));
  });

  it('does not let the person who checked also give final approval', async () => {
    await seedRequest('r2', { status: 'checked', checked: { uid: 'pastor', name: 'pastor', role: 'Accountant', at: new Date() } });
    await assertFails(updateDoc(doc(as('pastor'), 'organizations/adia/pettyCash/r2'), { status: 'approved', approved: stamp('pastor', 'Board member'), ...touched('pastor') }));
    await assertSucceeds(updateDoc(doc(as('elias'), 'organizations/adia/pettyCash/r2'), { status: 'rejected', rejection: { uid: 'elias', name: 'Elias', reason: 'No receipt', at: serverTimestamp() }, ...touched('elias') }));
  });

  it('lets only a board member set the monthly budget', async () => {
    const budget = (uid: string) => ({ orgId: 'adia', amountCents: 10000000, note: '', deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertFails(setDoc(doc(as('eliz'), 'organizations/adia/pettyBudgets/2026-10'), budget('eliz')));
    await assertFails(setDoc(doc(as('elias'), 'organizations/adia/pettyBudgets/october'), budget('elias')));
    await assertSucceeds(setDoc(doc(as('elias'), 'organizations/adia/pettyBudgets/2026-10'), budget('elias')));
    await assertSucceeds(getDoc(doc(as('doreen'), 'organizations/adia/pettyBudgets/2026-10')));
    await assertFails(getDoc(doc(as('plainHead'), 'organizations/adia/pettyBudgets/2026-10')));
  });
});
