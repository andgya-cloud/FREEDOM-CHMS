import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { created, makeEnv, person, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const entry = (stageId: string, sensitive: boolean, uid: string) => ({
  orgId: 'fcn', personId: 'p1', stageId, sensitive, status: 'completed', date: '2026-10-17', notes: '', details: {}, ...created(uid),
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

describe('people', () => {
  it('lets an admin add and edit people in their own organization only', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/people/new1'), { ...person('fcn'), ...created('admin') }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/people/new1'), { ...person('adia'), ...created('admin') }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'organizations/fcn/people/p1'), { status: 'regular', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('keeps each organization’s people apart', async () => {
    await assertSucceeds(getDocs(collection(as('admin'), 'organizations/fcn/people')));
    await assertFails(getDocs(collection(as('admin'), 'organizations/adia/people')));
    await assertFails(getDoc(doc(as('admin'), 'organizations/adia/people/s1')));
  });

  it('rejects a record filed under another organization, a bad phone number, or unknown fields', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/people/x'), { ...person('adia'), ...created('admin') }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/people/x'), { ...person('fcn', { phone: '0712345678' }), ...created('admin') }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/people/x'), { ...person('fcn', { salvationDate: '2026-10-01' }), ...created('admin') }));
  });

  it('never allows a hard delete', async () => {
    await assertFails(deleteDoc(doc(as('pastor'), 'organizations/fcn/people/p1')));
  });

  it('allows the combined view only for staff who see every organization', async () => {
    await assertSucceeds(getDocs(collectionGroup(as('pastor'), 'people')));
    await assertFails(getDocs(collectionGroup(as('admin'), 'people')));
  });
});

describe('pipeline privacy', () => {
  it('lets an admin record ordinary stages', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/pipeline/p1_growth_track'), entry('growth_track', false, 'admin')));
  });

  it('stops an admin recording or reading salvation and baptism', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/pipeline/p1_baptism'), entry('baptism', true, 'admin')));
    await assertFails(getDoc(doc(as('admin'), 'organizations/fcn/pipeline/p1_salvation')));
  });

  it('stops anyone disguising a salvation record as an ordinary one', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/pipeline/p1_baptism'), entry('baptism', false, 'admin')));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/pipeline/p1_baptism'), entry('baptism', false, 'pastor')));
  });

  it('requires the entry id to match the person and stage', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/pipeline/someone_else'), entry('growth_track', false, 'admin')));
  });

  it('lets an admin list a timeline only without the private stages', async () => {
    const base = collection(as('admin'), 'organizations/fcn/pipeline');
    await assertSucceeds(getDocs(query(base, where('personId', '==', 'p1'), where('sensitive', '==', false))));
    await assertFails(getDocs(query(base, where('personId', '==', 'p1'))));
  });

  it('lets the pastor read and record everything', async () => {
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/fcn/pipeline/p1_salvation')));
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/fcn/pipeline/p1_baptism'), entry('baptism', true, 'pastor')));
  });

  it('never lets a sensitive stage be made public by editing the stage list', async () => {
    await assertFails(updateDoc(doc(as('pastor'), 'settings/pipeline'), { sensitiveStageIds: ['baptism'], updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
    await assertSucceeds(updateDoc(doc(as('pastor'), 'settings/pipeline'), { sensitiveStageIds: ['salvation', 'baptism', 'counselling'], updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
  });
});

describe('prayer needs and pastoral notes', () => {
  it('lets an admin write down a prayer need but not read any back', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/prayerRequests/r2'), { orgId: 'fcn', personId: 'p1', text: 'Job', status: 'open', ...created('admin') }));
    await assertFails(getDoc(doc(as('admin'), 'organizations/fcn/prayerRequests/r1')));
    await assertFails(getDocs(collection(as('admin'), 'organizations/fcn/prayerRequests')));
  });

  it('keeps pastoral notes away from admins entirely', async () => {
    await assertFails(getDoc(doc(as('admin'), 'organizations/fcn/pastoralNotes/n1')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/pastoralNotes/n2'), { orgId: 'fcn', personId: 'p1', text: 'x', ...created('admin') }));
  });

  it('lets the pastor read and write both', async () => {
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/fcn/prayerRequests/r1')));
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/fcn/pastoralNotes/n1')));
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/fcn/pastoralNotes/n2'), { orgId: 'fcn', personId: 'p1', text: 'x', ...created('pastor') }));
  });
});

describe('follow-ups', () => {
  it('can be read by staff who send follow-ups, but are created only by the server', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'organizations/fcn/followUps/p1_first_visit')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/followUps/fake'), { orgId: 'fcn', personId: 'p1' }));
  });
});
