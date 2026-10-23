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
    await setDoc(doc(db, 'users/dan'), { ...user('signatory', ['pettycash.request', 'pettycash.approve', 'pettycash.authorize'], ['adia']), pettyTitle: 'Accountant' });
    await setDoc(doc(db, 'users/chair'), { ...user('signatory', ['pettycash.request', 'pettycash.approve', 'pettycash.authorize'], ['adia']), pettyTitle: 'Chairman' });
    await setDoc(doc(db, 'users/fcnAcc'), user('staff', [...TEAM_WORK, 'pettycash.check'], ['fcn']));
  });
});

async function seedRequest(id: string, data: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `organizations/adia/pettyCash/${id}`), { ...newRequest('doreen'), createdAt: new Date(), updatedAt: new Date(), ...data });
  });
}

describe('petty cash', () => {
  it("accepts Freedom Hope Center's and Freedom Church's categories and refuses made-up ones", async () => {
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/h1'), { ...newRequest('doreen'), category: "Children's needs" }));
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/c1'), { ...newRequest('doreen'), category: 'Hospitality' }));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/h2'), { ...newRequest('doreen'), category: 'Holiday' }));
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/t1'), { ...newRequest('doreen'), category: 'Training materials' }));
    // Retired: ADIA's old list had it, new requests may not use it.
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/t2'), { ...newRequest('doreen'), category: 'Freedom Hope Center' }));
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

  it('approves a request once any three stakeholders sign, never the requester, each only once', async () => {
    await seedRequest('n1', { signatures: {} });
    const sig = (uid: string) => ({ name: uid, role: 'Stakeholder', at: serverTimestamp() });
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/pettyCash/n1');
    await assertFails(updateDoc(ref('doreen'), { 'signatures.doreen': sig('doreen'), ...touched('doreen') }));
    await assertFails(updateDoc(ref('ronald'), { 'signatures.ronald': sig('ronald'), ...touched('ronald') }));
    await assertFails(updateDoc(ref('s1'), { 'signatures.s2': sig('s2'), ...touched('s1') }));
    await assertFails(updateDoc(ref('s1'), { 'signatures.s1': sig('s1'), status: 'approved', approved: stamp('s1', 'Stakeholder'), ...touched('s1') }));
    await assertSucceeds(updateDoc(ref('s1'), { 'signatures.s1': sig('s1'), ...touched('s1') }));
    await assertFails(updateDoc(ref('s1'), { 'signatures.s1': sig('s1'), ...touched('s1') }));
    // The new-style request has no accountant step.
    await assertFails(updateDoc(ref('eliz'), { status: 'checked', checked: stamp('eliz', 'Accountant'), ...touched('eliz') }));
    await assertSucceeds(updateDoc(ref('eliz'), { 'signatures.eliz': sig('eliz'), ...touched('eliz') }));
    // A titled signer signs under their own title only, and nobody but the accountant signs as Accountant.
    await assertFails(updateDoc(ref('elias'), { 'signatures.elias': { ...sig('elias'), role: 'Accountant' }, status: 'approved', approved: stamp('elias', 'Board member'), ...touched('elias') }));
    await assertFails(updateDoc(ref('dan'), { 'signatures.dan': sig('dan'), status: 'approved', approved: stamp('dan', 'Accountant'), ...touched('dan') }));
    // The third signature, whoever it is, must approve it, with no change to the amount.
    await assertFails(updateDoc(ref('elias'), { 'signatures.elias': sig('elias'), ...touched('elias') }));
    await assertFails(updateDoc(ref('elias'), { 'signatures.elias': sig('elias'), status: 'approved', approved: stamp('elias', 'Board member'), totalCents: 1, ...touched('elias') }));
    await assertSucceeds(updateDoc(ref('elias'), { 'signatures.elias': sig('elias'), status: 'approved', approved: stamp('elias', 'Board member'), ...touched('elias') }));
    await assertFails(updateDoc(ref('s2'), { 'signatures.s2': sig('s2'), ...touched('s2') }));
  });

  it('takes each signer\'s own title, and approves on the third signature', async () => {
    await seedRequest('n3', { signatures: {} });
    const ref = (uid: string) => doc(as(uid), 'organizations/adia/pettyCash/n3');
    await assertSucceeds(updateDoc(ref('dan'), { 'signatures.dan': { name: 'dan', role: 'Accountant', at: serverTimestamp() }, ...touched('dan') }));
    await assertFails(updateDoc(ref('chair'), { 'signatures.chair': { name: 'chair', role: 'Board member', at: serverTimestamp() }, ...touched('chair') }));
    await assertSucceeds(updateDoc(ref('chair'), { 'signatures.chair': { name: 'chair', role: 'Chairman', at: serverTimestamp() }, ...touched('chair') }));
    await assertSucceeds(updateDoc(ref('s1'), { 'signatures.s1': { name: 's1', role: 'Stakeholder', at: serverTimestamp() }, status: 'approved', approved: stamp('s1', 'Stakeholder'), ...touched('s1') }));
  });

  it('lets the pastor delete any request or top-up, and a requester only their own waiting request', async () => {
    const del = (uid: string) => ({ deletedAt: serverTimestamp(), deletedBy: uid, ...touched(uid) });
    await seedRequest('d1', { signatures: {} });
    await seedRequest('d2', { signatures: {}, status: 'approved' });
    await assertFails(updateDoc(doc(as('ronald'), 'organizations/adia/pettyCash/d1'), del('ronald')));
    await assertFails(updateDoc(doc(as('doreen'), 'organizations/adia/pettyCash/d2'), del('doreen')));
    await assertFails(updateDoc(doc(as('doreen'), 'organizations/adia/pettyCash/d1'), { ...del('doreen'), totalCents: 1 }));
    await assertSucceeds(updateDoc(doc(as('doreen'), 'organizations/adia/pettyCash/d1'), del('doreen')));
    await assertSucceeds(updateDoc(doc(as('pastor'), 'organizations/adia/pettyCash/d2'), del('pastor')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/pettyFunds/fd'), { orgId: 'adia', kind: 'topup', amountCents: 100, signatures: {}, status: 'done', doneAt: new Date(), deletedAt: null, deletedBy: null, createdAt: new Date(), createdBy: 's1', updatedAt: new Date(), updatedBy: 's1' });
    });
    await assertFails(updateDoc(doc(as('s1'), 'organizations/adia/pettyFunds/fd'), del('s1')));
    await assertSucceeds(updateDoc(doc(as('pastor'), 'organizations/adia/pettyFunds/fd'), del('pastor')));
  });

  it('lets only those who may request raise one', async () => {
    await assertFails(setDoc(doc(as('elias'), 'organizations/adia/pettyCash/x1'), { ...newRequest('elias'), signatures: {} }));
    await assertSucceeds(setDoc(doc(as('dan'), 'organizations/adia/pettyCash/x2'), { ...newRequest('dan'), signatures: {} }));
  });

  it('lets a signer reject a waiting request with a reason', async () => {
    await seedRequest('n2', { signatures: {} });
    const reject = (uid: string, reason: string) => updateDoc(doc(as(uid), 'organizations/adia/pettyCash/n2'), { status: 'rejected', rejection: { uid, name: uid, reason, at: serverTimestamp() }, ...touched(uid) });
    await assertFails(reject('ronald', 'No'));
    await assertFails(reject('s1', ''));
    await assertSucceeds(reject('s1', 'Not in the budget'));
  });

  it('requires a note for Other and refuses one elsewhere', async () => {
    const other = { ...newRequest('doreen'), category: 'Other', signatures: {} };
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/o1'), other));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/o2'), { ...other, categoryNote: '' }));
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/o3'), { ...other, categoryNote: 'Generator fuel' }));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/o4'), { ...newRequest('doreen'), categoryNote: 'x', signatures: {} }));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyCash/o5'), { ...newRequest('doreen'), signatures: { s1: { name: 's1', role: 'x', at: serverTimestamp() } } }));
  });

  it('keeps receipts with whoever may see the request', async () => {
    await seedRequest('q1', { signatures: {} });
    await seedRequest('q2', { signatures: {}, status: 'rejected' });
    const stamps = (uid: string) => ({ deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
    const meta = (uid: string, reqId = 'q1', extra: Record<string, unknown> = {}) => ({ orgId: 'adia', reqId, name: 'till.jpg', type: 'image/jpeg', size: 120000, uploadedByName: uid, ...stamps(uid), ...extra });
    const file = (uid: string, reqId = 'q1', data = 'data:image/jpeg;base64,AAAA') => ({ orgId: 'adia', reqId, data, ...stamps(uid) });
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyReceipts/a'), meta('doreen')));
    await assertSucceeds(setDoc(doc(as('doreen'), 'organizations/adia/pettyReceiptFiles/a'), file('doreen')));
    await assertFails(setDoc(doc(as('ronald'), 'organizations/adia/pettyReceipts/b'), meta('ronald')));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyReceipts/c'), meta('doreen', 'q2')));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyReceipts/d'), meta('doreen', 'q1', { size: 900000 })));
    await assertFails(setDoc(doc(as('doreen'), 'organizations/adia/pettyReceiptFiles/e'), file('doreen', 'q1', 'data:text/html;base64,AAAA')));
    await assertSucceeds(setDoc(doc(as('eliz'), 'organizations/adia/pettyReceipts/f'), meta('eliz')));
    await assertSucceeds(getDocs(query(collection(as('doreen'), 'organizations/adia/pettyReceipts'), where('reqId', '==', 'q1'))));
    await assertFails(getDocs(query(collection(as('ronald'), 'organizations/adia/pettyReceipts'), where('reqId', '==', 'q1'))));
    await assertSucceeds(getDocs(collection(as('s1'), 'organizations/adia/pettyReceipts')));
    await assertSucceeds(getDoc(doc(as('doreen'), 'organizations/adia/pettyReceiptFiles/a')));
    await assertFails(getDoc(doc(as('plainHead'), 'organizations/adia/pettyReceiptFiles/a')));
    const remove = (uid: string, id: string) => updateDoc(doc(as(uid), `organizations/adia/pettyReceipts/${id}`), { deletedAt: serverTimestamp(), deletedBy: uid, ...touched(uid) });
    await assertFails(remove('ronald', 'a'));
    await assertFails(remove('eliz', 'a'));
    await assertSucceeds(remove('doreen', 'a'));
    await assertSucceeds(remove('s1', 'f'));
  });

  it('lets only the signing stakeholders set category budgets', async () => {
    const budget = (uid: string) => ({ orgId: 'adia', allocations: { Other: 500000 }, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertFails(setDoc(doc(as('eliz'), 'organizations/adia/pettySettings/budget'), budget('eliz')));
    await assertFails(setDoc(doc(as('s1'), 'organizations/adia/pettySettings/other'), budget('s1')));
    await assertSucceeds(setDoc(doc(as('s1'), 'organizations/adia/pettySettings/budget'), budget('s1')));
    await assertSucceeds(getDoc(doc(as('doreen'), 'organizations/adia/pettySettings/budget')));
    await assertFails(getDoc(doc(as('plainHead'), 'organizations/adia/pettySettings/budget')));
  });
});
