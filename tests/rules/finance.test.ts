import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const ORG = 'organizations/fcn';
const line = { d: '2026-10-02', t: 'TITHE', r: '', i: 100000, o: 0, b: 100000, c: 'tithes', s: true };
const statement = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', account: 'Family Bank main account', accountKind: 'bank', fileName: 'oct.pdf', from: '2026-10-01', to: '2026-10-31',
  openingCents: 0, closingCents: 100000, lines: [line], ...created(uid), ...overrides,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (permissions: string[]) => ({ email: 'x@example.org', displayName: 'X', roleId: 'signatory', extraPermissions: [], orgIds: ['fcn'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/daniel'), user(['pettycash.request', 'pettycash.approve', 'pettycash.authorize']));
    await setDoc(doc(db, 'users/finance'), user(['people.read', 'gifts.write', 'finance.reports']));
  });
});

describe('financial statements', () => {
  it('lets the signatories, finance and the pastor upload a statement; not other staff', async () => {
    await assertSucceeds(setDoc(doc(as('daniel'), `${ORG}/bankStatements/s1`), statement('daniel')));
    await assertSucceeds(setDoc(doc(as('finance'), `${ORG}/bankStatements/s2`), statement('finance')));
    await assertSucceeds(setDoc(doc(as('pastor'), `${ORG}/bankStatements/s3`), statement('pastor')));
    await assertFails(setDoc(doc(as('admin'), `${ORG}/bankStatements/s4`), statement('admin')));
    await assertFails(getDoc(doc(as('admin'), `${ORG}/bankStatements/s1`)));
    await assertSucceeds(getDoc(doc(as('daniel'), `${ORG}/bankStatements/s1`)));
    await assertFails(setDoc(doc(as('daniel'), `${ORG}/bankStatements/s5`), statement('daniel', { accountKind: 'cash' })));
    await assertFails(setDoc(doc(as('daniel'), `${ORG}/bankStatements/s6`), statement('daniel', { lines: [] })));
  });

  it('lets lines be re-sorted and a statement taken out, but not the account or dates changed', async () => {
    await setDoc(doc(as('daniel'), `${ORG}/bankStatements/s1`), statement('daniel'));
    const db = as('finance');
    await assertSucceeds(updateDoc(doc(db, `${ORG}/bankStatements/s1`), { lines: [{ ...line, c: 'offerings' }], updatedAt: serverTimestamp(), updatedBy: 'finance' }));
    await assertFails(updateDoc(doc(db, `${ORG}/bankStatements/s1`), { account: 'Other', updatedAt: serverTimestamp(), updatedBy: 'finance' }));
    await assertFails(updateDoc(doc(db, `${ORG}/bankStatements/s1`), { lines: [line, line], updatedAt: serverTimestamp(), updatedBy: 'finance' }));
    await assertSucceeds(updateDoc(doc(db, `${ORG}/bankStatements/s1`), { deletedAt: serverTimestamp(), deletedBy: 'finance', updatedAt: serverTimestamp(), updatedBy: 'finance' }));
  });

  it('keeps the remembered choices, budget and what we own and owe', async () => {
    const db = as('daniel');
    const stamp = { orgId: 'fcn', updatedAt: serverTimestamp(), updatedBy: 'daniel' };
    await assertSucceeds(setDoc(doc(db, `${ORG}/finBooks/learned`), { ...stamp, learned: { 'out:KPLC TOKEN': 'utilities' } }));
    await assertSucceeds(setDoc(doc(db, `${ORG}/finBooks/budget`), { ...stamp, budget: { utilities: 500000 } }));
    await assertSucceeds(setDoc(doc(db, `${ORG}/finBooks/owned`), { ...stamp, owned: [{ id: 'a', side: 'own', kind: 'Vehicles', name: 'Van', cents: 1, asOf: '2026-01-01' }] }));
    await assertFails(setDoc(doc(db, `${ORG}/finBooks/other`), { ...stamp, other: {} }));
    await assertFails(setDoc(doc(db, `${ORG}/finBooks/budget`), { ...stamp, budget: { utilities: 1 }, extra: true }));
    await assertFails(setDoc(doc(as('admin'), `${ORG}/finBooks/budget`), { orgId: 'fcn', updatedAt: serverTimestamp(), updatedBy: 'admin', budget: {} }));
  });
});
