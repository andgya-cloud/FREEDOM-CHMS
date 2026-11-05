import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const TEAM_WORK = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'followups.manage'];

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
    await setDoc(doc(db, 'users/adiaHead'), user('head', [...TEAM_WORK, 'team.manage'], ['adia']));
    await setDoc(doc(db, 'users/adiaStaff'), user('staff', TEAM_WORK, ['adia']));
    await setDoc(doc(db, 'users/fcnStaff'), user('staff', TEAM_WORK, ['fcn']));
    await setDoc(doc(db, 'users/bothStaff'), user('staff', TEAM_WORK, ['adia', 'fcn']));
  });
});

describe('organization heads', () => {
  it('read the Staff accounts of their own organization only', async () => {
    await assertSucceeds(getDoc(doc(as('adiaHead'), 'users/adiaStaff')));
    await assertFails(getDoc(doc(as('adiaHead'), 'users/fcnStaff')));
    await assertFails(getDoc(doc(as('adiaHead'), 'users/bothStaff')));
    await assertFails(getDoc(doc(as('adiaHead'), 'users/admin')));
    await assertFails(getDoc(doc(as('adiaHead'), 'users/pastor')));
  });

  it('cannot list accounts or write any account directly', async () => {
    await assertFails(getDocs(collection(as('adiaHead'), 'users')));
    await assertFails(setDoc(doc(as('adiaHead'), 'users/adiaStaff'), { roleId: 'admin' }, { merge: true }));
  });

  it('see no money and no other organization', async () => {
    await assertFails(getDocs(collection(as('adiaHead'), 'organizations/adia/gifts')));
    await assertFails(getDocs(collection(as('adiaHead'), 'organizations/adia/invoices')));
    await assertFails(getDocs(collection(as('adiaHead'), 'organizations/adia/feeBalances')));
    await assertFails(getDoc(doc(as('adiaHead'), 'organizations/fcn/people/p1')));
    await assertSucceeds(getDoc(doc(as('adiaHead'), 'organizations/adia/people/s1')));
  });

  it('give their Staff no way to read accounts', async () => {
    await assertFails(getDoc(doc(as('adiaStaff'), 'users/fcnStaff')));
    await assertSucceeds(getDoc(doc(as('adiaStaff'), 'users/adiaStaff')));
  });
});
