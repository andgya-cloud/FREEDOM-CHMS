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
    for (const s of ['s1', 's2', 's3']) await setDoc(doc(db, `users/${s}`), user('staff', [...TEAM_WORK, 'pettycash.authorize'], ['adia']));
    await setDoc(doc(db, 'users/fcnAcc'), user('staff', [...TEAM_WORK, 'pettycash.check'], ['fcn']));
  });
});

async function seedRequest(id: string, data: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `organizations/adia/pettyCash/${id}`), { ...newRequest('doreen'), createdAt: new Date(), updatedAt: new Date(), ...data });
  });
}

describe('petty cash', () => {
  it("accepts Freedom Hope Center's categories and refuses made-up ones", async () => {
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/h1'), { ...newRequest('doreen'), category: "Children's needs" }));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/h2'), { ...newRequest('doreen'), category: 'Holiday' }));
  });

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

  it('adds money only after three different stakeholders sign', async () => {
    const sig = (uid: string) => ({ name: uid, at: serverTimestamp() });
    const fund = (uid: string, extra: Record<string, unknown> = {}) => ({
      orgId: 'adia', kind: 'topup', amountCents: 50000000, signatures: { [uid]: sig(uid) }, status: 'collecting', doneAt: null,
      deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid, ...extra,
    });
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/pettyFunds/f1');
    // Only stakeholders start one, already signed by themselves and not yet complete.
    await assertFails(setDoc(ref('doreen'), fund('doreen')));
    await assertFails(setDoc(ref('s1'), fund('s1', { status: 'done' })));
    await assertFails(setDoc(ref('s1'), fund('s1', { signatures: { s1: sig('s1'), s2: sig('s2') } })));
    await assertFails(setDoc(ref('s1'), fund('s1', { kind: 'reset' })));
    await assertSucceeds(setDoc(ref('s1'), fund('s1')));
    // Nobody signs twice, or for someone else, and the second signature does not complete it.
    await assertFails(updateDoc(ref('s1'), { 'signatures.s1.name': 'again', ...touched('s1') }));
    await assertFails(updateDoc(ref('s2'), { 'signatures.s3': sig('s3'), ...touched('s2') }));
    await assertFails(updateDoc(ref('s2'), { 'signatures.s2': sig('s2'), status: 'done', doneAt: serverTimestamp(), ...touched('s2') }));
    await assertSucceeds(updateDoc(ref('s2'), { 'signatures.s2': sig('s2'), ...touched('s2') }));
    // The third must complete it.
    await assertFails(updateDoc(ref('s3'), { 'signatures.s3': sig('s3'), ...touched('s3') }));
    await assertSucceeds(updateDoc(ref('s3'), { 'signatures.s3': sig('s3'), status: 'done', doneAt: serverTimestamp(), ...touched('s3') }));
    // A completed top-up cannot be changed.
    await assertFails(updateDoc(ref('s1'), { status: 'cancelled', ...touched('s1') }));
    await assertSucceeds(getDoc(doc(as('doreen'), 'organizations/adia/pettyFunds/f1')));
    await assertFails(getDoc(doc(as('plainHead'), 'organizations/adia/pettyFunds/f1')));
  });
});
