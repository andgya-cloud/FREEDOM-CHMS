import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const stamps = (uid: string) => ({ deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });
const staffDoc = (uid: string) => ({
  orgId: 'adia', name: 'Ronald Awili', staffNo: 'ADIA-001', jobTitle: 'Trainer', kraPin: 'A001', nssfNo: '', shifNo: '', paymentDetails: 'M-Pesa',
  basicCents: 4000000, allowances: [], deductions: [], active: true, ...stamps(uid),
});
const run = (uid: string) => ({
  orgId: 'adia', month: '2026-10', status: 'draft', lines: [], totals: {}, rates: {}, preparedBy: uid, preparedByName: uid, approved: null, ...stamps(uid),
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (roleId: string, permissions: string[]) => ({
      email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions, active: true,
    });
    await setDoc(doc(db, 'users/daniel'), user('staff', ['people.read', 'payroll.manage']));
    await setDoc(doc(db, 'users/elias'), user('staff', ['people.read', 'payroll.approve']));
    await setDoc(doc(db, 'users/both'), user('staff', ['people.read', 'payroll.manage', 'payroll.approve']));
    await setDoc(doc(db, 'users/head'), user('head', ['people.read', 'team.manage', 'pettycash.check']));
  });
});

describe('payroll rules', () => {
  it('keeps staff pay details to the payroll people', async () => {
    await assertFails(setDoc(doc(as('head'), 'organizations/adia/payrollStaff/s1'), staffDoc('head')));
    await assertSucceeds(setDoc(doc(as('daniel'), 'organizations/adia/payrollStaff/s1'), staffDoc('daniel')));
    await assertSucceeds(getDoc(doc(as('elias'), 'organizations/adia/payrollStaff/s1')));
    await assertFails(getDoc(doc(as('head'), 'organizations/adia/payrollStaff/s1')));
    await assertFails(setDoc(doc(as('daniel'), 'organizations/adia/payrollStaff/s2'), { ...staffDoc('daniel'), basicCents: -5 }));
  });

  it('needs a second person to approve a pay run, then locks it', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/payrollRuns/2026-10');
    const approve = (uid: string) => ({ status: 'approved', approved: { uid, name: uid, at: serverTimestamp() }, ...touched(uid) });
    await assertFails(setDoc(ref('elias'), run('elias')));
    await assertFails(setDoc(doc(as('both'), 'organizations/adia/payrollRuns/october'), { ...run('both'), month: 'october' }));
    await assertSucceeds(setDoc(ref('both'), run('both')));
    await assertFails(updateDoc(ref('both'), approve('both')));
    await assertFails(updateDoc(ref('daniel'), approve('daniel')));
    // Re-preparing makes Daniel the preparer, so "both" may now approve.
    await assertSucceeds(updateDoc(ref('daniel'), { lines: [], totals: {}, preparedBy: 'daniel', preparedByName: 'Daniel', ...touched('daniel') }));
    await assertSucceeds(updateDoc(ref('both'), approve('both')));
    await assertFails(updateDoc(ref('daniel'), { lines: [], ...touched('daniel') }));
  });

  it('lets someone other than the preparer sign a pay run as reviewed, and preparing again clears it', async () => {
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/payrollRuns/2026-10');
    const review = (uid: string) => ({ reviewed: { uid, name: uid, at: serverTimestamp() }, ...touched(uid) });
    await assertSucceeds(setDoc(ref('daniel'), { ...run('daniel'), adjustments: { s1: { earnings: [], unpaid: [] } }, reviewed: null }));
    await assertFails(updateDoc(ref('daniel'), review('daniel')));
    await assertFails(updateDoc(ref('head'), review('head')));
    await assertFails(updateDoc(ref('elias'), { ...review('elias'), lines: [1] }));
    await assertSucceeds(updateDoc(ref('elias'), review('elias')));
    await assertFails(updateDoc(ref('daniel'), { lines: [], preparedBy: 'daniel', preparedByName: 'Daniel', ...touched('daniel') }));
    await assertSucceeds(updateDoc(ref('daniel'), { lines: [], preparedBy: 'daniel', preparedByName: 'Daniel', reviewed: null, adjustments: {}, ...touched('daniel') }));
  });

  it('keeps ID numbers, contacts and loans on staff pay details', async () => {
    const s = { ...staffDoc('daniel'), idNo: '12345678', phone: '+254700000000', email: 'r@example.org',
      loans: [{ id: 'L1', name: 'Advance', principalCents: 1000000, instalmentCents: 500000, startMonth: '2026-10' }] };
    await assertSucceeds(setDoc(doc(as('daniel'), 'organizations/adia/payrollStaff/s1'), s));
    await assertFails(setDoc(doc(as('daniel'), 'organizations/adia/payrollStaff/s2'), { ...s, idNo: 'x'.repeat(30) }));
  });

  it('lets only an approver change the deduction rates', async () => {
    const rates = (uid: string) => ({ orgId: 'adia', nssfRate: 0.06, nssfUpperLimitCents: 7200000, shifRate: 0.0275, shifMinimumCents: 30000, housingRate: 0.015, personalReliefCents: 240000, ...stamps(uid) });
    await assertFails(setDoc(doc(as('daniel'), 'organizations/adia/payrollSettings/rates'), rates('daniel')));
    await assertSucceeds(setDoc(doc(as('elias'), 'organizations/adia/payrollSettings/rates'), rates('elias')));
    await assertSucceeds(getDoc(doc(as('daniel'), 'organizations/adia/payrollSettings/rates')));
  });
});
