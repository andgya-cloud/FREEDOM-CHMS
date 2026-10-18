import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { created, makeEnv, newOrg, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'organizations/fcn/followUps/p1_salvation'), { orgId: 'fcn', personId: 'p1', reason: 'salvation', status: 'open', ...stamps });
    await setDoc(doc(db, 'organizations/fcn/followUps/p1_baptism_invite'), { orgId: 'fcn', personId: 'p1', reason: 'baptism_invite', status: 'open', ...stamps });
    await setDoc(doc(db, 'organizations/fcn/messages/m1'), { orgId: 'fcn', personId: 'p1', templateId: 'salvation_followup', sensitive: true, createdBy: 'pastor', createdAt: old });
    await setDoc(doc(db, 'organizations/fcn/messages/m2'), { orgId: 'fcn', personId: 'p1', templateId: 'first_visit', sensitive: false, createdBy: 'pastor', createdAt: old });
    await setDoc(doc(db, 'organizations/fcn/reports/weekly_2026-10-12/private/pastoral'), { orgId: 'fcn', salvations: [{ personId: 'p1', name: 'Grace' }] });
    await setDoc(doc(db, 'organizations/fcn/reports/weekly_2026-10-12/private/giving'), { orgId: 'fcn', current: { totalCents: 1 } });
    await setDoc(doc(db, 'organizations/fcn/gifts/g1'), { orgId: 'fcn', personId: 'p1', giverName: 'Grace', amountCents: 50000, status: 'confirmed', createdBy: 'pastor' });
  });
});

const PASTORAL = 'organizations/fcn/pastoralNotes/n1';
const PRAYER = 'organizations/fcn/prayerRequests/r1';

/**
 * The Stage 8 test: an Admin cannot reach pastoral notes, prayer requests, who was saved or baptised,
 * or a person's giving, by any route: one document, a list, a filtered query, every campus at once,
 * a report, a message, a change, or another account.
 */
describe('an Admin cannot reach pastoral information by any route', () => {
  it('cannot read a pastoral note or prayer request directly', async () => {
    await assertFails(getDoc(doc(as('admin'), PASTORAL)));
    await assertFails(getDoc(doc(as('admin'), PRAYER)));
    await assertFails(getDoc(doc(as('settingsAdmin'), PASTORAL)));
    await assertSucceeds(getDoc(doc(as('pastor'), PASTORAL)));
  });

  it('cannot list them, however the question is asked', async () => {
    const db = as('admin');
    await assertFails(getDocs(collection(db, 'organizations/fcn/pastoralNotes')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/prayerRequests')));
    await assertFails(getDocs(query(collection(db, 'organizations/fcn/pastoralNotes'), where('personId', '==', 'p1'))));
    await assertFails(getDocs(query(collection(db, 'organizations/fcn/prayerRequests'), where('personId', '==', 'p1'))));
    await assertFails(getDocs(collectionGroup(db, 'pastoralNotes')));
    await assertFails(getDocs(collectionGroup(db, 'prayerRequests')));
    await assertFails(getDocs(collectionGroup(db, 'pipeline')));
    await assertFails(getDocs(collectionGroup(db, 'followUps')));
    await assertFails(getDocs(collectionGroup(db, 'messages')));
    await assertFails(getDocs(collectionGroup(db, 'private')));
  });

  it('cannot write, change or delete a note or prayer request', async () => {
    const db = as('admin');
    await assertFails(setDoc(doc(db, 'organizations/fcn/pastoralNotes/n2'), { orgId: 'fcn', personId: 'p1', text: 'x', ...created('admin') }));
    await assertFails(updateDoc(doc(db, PASTORAL), { text: 'changed', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(db, PRAYER), { status: 'prayed', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(deleteDoc(doc(db, PASTORAL)));
    await assertFails(deleteDoc(doc(db, PRAYER)));
  });

  it('cannot see who was saved or baptised', async () => {
    const db = as('admin');
    await assertFails(getDoc(doc(db, 'organizations/fcn/pipeline/p1_salvation')));
    await assertSucceeds(getDoc(doc(db, 'organizations/fcn/pipeline/p1_visitor')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/pipeline')));
    await assertFails(getDocs(query(collection(db, 'organizations/fcn/pipeline'), where('personId', '==', 'p1'))));
    await assertSucceeds(getDocs(query(collection(db, 'organizations/fcn/pipeline'), where('sensitive', '==', false))));
    await assertFails(getDocs(query(collection(db, 'organizations/fcn/pipeline'), where('sensitive', '==', true))));
  });

  it('cannot set or move a salvation or baptism record', async () => {
    const db = as('admin');
    await assertFails(setDoc(doc(db, 'organizations/fcn/pipeline/p1_baptism'), {
      orgId: 'fcn', personId: 'p1', stageId: 'baptism', sensitive: true, status: 'completed', date: '2026-10-11', notes: '', details: {}, ...created('admin'),
    }));
    await assertFails(updateDoc(doc(db, 'organizations/fcn/pipeline/p1_salvation'), { status: 'dropped', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    // Nor mark the stage as not sensitive.
    await assertFails(updateDoc(doc(db, 'settings/pipeline'), { sensitiveStageIds: [], updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(as('settingsAdmin'), 'settings/pipeline'), { sensitiveStageIds: [], updatedAt: serverTimestamp(), updatedBy: 'settingsAdmin' }));
  });

  it('cannot read salvation and baptism follow-ups or the messages sent for them', async () => {
    const db = as('admin');
    await assertFails(getDoc(doc(db, 'organizations/fcn/followUps/p1_salvation')));
    await assertFails(getDoc(doc(db, 'organizations/fcn/followUps/p1_baptism_invite')));
    await assertSucceeds(getDoc(doc(db, 'organizations/fcn/followUps/p1_first_visit')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/followUps')));
    await assertFails(getDoc(doc(db, 'organizations/fcn/messages/m1')));
    await assertSucceeds(getDoc(doc(db, 'organizations/fcn/messages/m2')));
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/fcn/followUps/p1_salvation')));
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/fcn/messages/m1')));
  });

  it('cannot read the private parts of a report', async () => {
    const db = as('admin');
    await assertFails(getDoc(doc(db, 'organizations/fcn/reports/weekly_2026-10-12/private/pastoral')));
    await assertFails(getDoc(doc(db, 'organizations/fcn/reports/weekly_2026-10-12/private/giving')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/reports/weekly_2026-10-12/private')));
  });

  it('cannot read what a person gave', async () => {
    const db = as('admin');
    await assertFails(getDocs(query(collection(db, 'organizations/fcn/gifts'), where('personId', '==', 'p1'))));
    await assertFails(getDocs(collection(db, 'organizations/fcn/ledger')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/receipts')));
  });

  it('cannot reach the audit log, the backup status or the export tools', async () => {
    const db = as('admin');
    await assertFails(getDocs(collection(db, 'auditLog')));
    await assertFails(getDoc(doc(db, 'auditLog/one')));
    await assertFails(getDocs(collection(db, 'organizations/fcn/dataRequests')));
    await assertFails(setDoc(doc(db, 'organizations/fcn/dataRequests/d1'), {
      orgId: 'fcn', kind: 'export_all', personId: null, status: 'pending', createdAt: serverTimestamp(), createdBy: 'admin',
    }));
    await assertFails(setDoc(doc(as('settingsAdmin'), 'organizations/fcn/dataRequests/d2'), {
      orgId: 'fcn', kind: 'erase_person', personId: 'p1', status: 'pending', createdAt: serverTimestamp(), createdBy: 'settingsAdmin',
    }));
  });

  it('cannot give themselves pastoral access', async () => {
    const db = as('admin');
    await assertFails(updateDoc(doc(db, 'users/admin'), { permissions: ['pastoral.read'] }));
    await assertFails(updateDoc(doc(db, 'users/admin'), { roleId: 'pastor' }));
    await assertFails(setDoc(doc(db, 'roles/admin'), { name: 'Admin', permissions: ['pastoral.read'], isOwner: false, system: true }));
    await assertFails(updateDoc(doc(db, 'organizations/fcn'), { allOrgs: true }));
  });

  it('cannot reach it through another campus either', async () => {
    const db = as('admin');
    await assertFails(getDoc(doc(db, 'organizations/adia/pastoralNotes/n1')));
    await assertFails(getDocs(collection(db, 'organizations/adia/prayerRequests')));
  });

  it('is turned away when the account is switched off', async () => {
    await assertFails(getDoc(doc(as('inactive'), PASTORAL)));
  });
});

describe('data requests (downloads, erasing, practice mode)', () => {
  const ref = (uid: string, id: string, org = 'fcn') => doc(as(uid), `organizations/${org}/dataRequests/${id}`);
  const req = (uid: string, over: Record<string, unknown> = {}) => ({
    orgId: 'fcn', kind: 'export_all', personId: null, status: 'pending', createdAt: serverTimestamp(), createdBy: uid, ...over,
  });

  it('lets the pastor ask, and logs by who asked', async () => {
    await assertSucceeds(setDoc(ref('pastor', 'a'), req('pastor')));
    await assertSucceeds(setDoc(ref('pastor', 'b'), req('pastor', { kind: 'export_person', personId: 'p1' })));
    await assertSucceeds(setDoc(ref('pastor', 'c'), req('pastor', { kind: 'erase_person', personId: 'p1' })));
    await assertSucceeds(getDoc(ref('pastor', 'a')));
  });

  it('refuses a person who is not in this organization, or a missing person', async () => {
    await assertFails(setDoc(ref('pastor', 'a'), req('pastor', { kind: 'erase_person', personId: 's1' })));
    await assertFails(setDoc(ref('pastor', 'b'), req('pastor', { kind: 'export_person', personId: null })));
    await assertFails(setDoc(ref('pastor', 'c'), req('pastor', { kind: 'export_all', personId: 'p1' })));
  });

  it('refuses requests made in someone else\'s name, already done, or edited afterwards', async () => {
    await assertFails(setDoc(ref('pastor', 'a'), req('admin')));
    await assertFails(setDoc(ref('pastor', 'b'), req('pastor', { status: 'done' })));
    await assertSucceeds(setDoc(ref('pastor', 'c'), req('pastor')));
    await assertFails(updateDoc(ref('pastor', 'c'), { status: 'done' }));
    await assertFails(deleteDoc(ref('pastor', 'c')));
  });

  it('lets practice data be reset only in the practice organization', async () => {
    await assertSucceeds(setDoc(ref('pastor', 'a', 'training'), req('pastor', { orgId: 'training', kind: 'reset_training' })));
    await assertFails(setDoc(ref('pastor', 'b'), req('pastor', { kind: 'reset_training' })));
  });
});

describe('retention and practice organization', () => {
  it('lets only the pastor change how long deleted records are kept', async () => {
    const data = () => ({ deletedDays: 60, ...created('pastor') });
    await assertSucceeds(setDoc(doc(as('pastor'), 'settings/retention'), data()));
    await assertFails(setDoc(doc(as('admin'), 'settings/retention'), { deletedDays: 1, ...created('admin') }));
    await assertSucceeds(getDoc(doc(as('admin'), 'settings/retention')));
  });

  it('lets nobody write the backup status from the app', async () => {
    await assertFails(setDoc(doc(as('admin'), 'settings/backupStatus'), { ok: true, ...created('admin') }));
  });

  it('lets the pastor mark an organization as the practice one', async () => {
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/training'), newOrg('pastor', { name: 'Practice Church (training)', receiptPrefix: 'PRC', training: true })));
  });
});
