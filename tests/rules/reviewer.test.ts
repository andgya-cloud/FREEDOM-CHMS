import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { created, makeEnv, person, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid, uid === 'rev' ? { rv: true } : {}).firestore();
const ALL_BUT = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage',
  'giving.person.read', 'finance.reports', 'settings.manage'];

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/rev'), { email: 'r@example.org', displayName: 'Reviewer One', roleId: 'reviewer', extraPermissions: [], orgIds: ['fcn', 'training'], allOrgs: false, permissions: ALL_BUT, active: true });
    await setDoc(doc(db, 'organizations/training'), { name: 'Practice Church', type: 'church_campus', training: true, parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'PR', active: true, deletedAt: null, deletedBy: null, createdAt: Timestamp.now(), createdBy: 'pastor', updatedAt: Timestamp.now(), updatedBy: 'pastor' });
  });
});

const note = (uid: string) => ({ uid, name: 'Reviewer One', orgId: 'fcn', path: '/giving', page: 'Giving', text: 'The button is hard to find.', status: 'new', createdAt: serverTimestamp() });

describe('Reviewer (Andy, 2026-11-11)', () => {
  it('reads the real organisation', async () => {
    await assertSucceeds(getDoc(doc(as('rev'), 'organizations/fcn/people/p1')));
    await assertSucceeds(getDocs(collection(as('rev'), 'organizations/fcn/people')));
  });
  it('cannot change anything in the real organisation', async () => {
    await assertFails(setDoc(doc(as('rev'), 'organizations/fcn/people/p9'), { ...person('fcn'), ...created('rev') }));
    await assertFails(updateDoc(doc(as('rev'), 'organizations/fcn/people/p1'), { fullName: 'Changed', updatedAt: serverTimestamp(), updatedBy: 'rev' }));
  });
  it('can try things in the Practice Church', async () => {
    await assertSucceeds(setDoc(doc(as('rev'), 'organizations/training/people/p9'), { ...person('training'), ...created('rev') }));
  });
  it('never sees pastoral notes', async () => {
    await assertFails(getDoc(doc(as('rev'), 'organizations/fcn/pastoralNotes/n1')));
  });
  it('leaves a note that only Andy reads', async () => {
    const ref = await assertSucceeds(addDoc(collection(as('rev'), 'reviewerNotes'), note('rev')));
    await assertFails(getDoc(doc(as('rev'), `reviewerNotes/${ref.id}`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `reviewerNotes/${ref.id}`)));
    await assertSucceeds(updateDoc(doc(as('pastor'), `reviewerNotes/${ref.id}`), { status: 'done' }));
    await assertFails(addDoc(collection(as('rev'), 'reviewerNotes'), note('pastor')));
  });
  it('leaves other staff unchanged', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/people/p8'), { ...person('fcn'), ...created('admin') }));
  });
});
