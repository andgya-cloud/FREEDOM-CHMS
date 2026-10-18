import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { created, makeEnv, person, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const EVENT = 'organizations/fcn/events/2026-10-18_sunday_10_00_service';
const event = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', date: '2026-10-18', type: 'service', name: 'Sunday 10:00 service', activity: null,
  headcounts: { adults: 180, teens: 25, children: 40 }, notes: '', ...created(uid), ...overrides,
});
const checkIn = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', eventId: '2026-10-18_sunday_10_00_service', personId: 'p1', date: '2026-10-18',
  status: 'present', method: 'staff', checkedInAt: Timestamp.fromDate(new Date('2026-10-18T07:05:00Z')),
  ...created(uid), ...overrides,
});
const RECORD = 'organizations/fcn/attendance/2026-10-18_sunday_10_00_service_p1';

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

async function seedEvent() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), EVENT), { ...event('pastor'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
}

describe('services and headcounts', () => {
  it('lets an admin open a service and record headcounts in their own organization only', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), EVENT), event('admin')));
    await assertSucceeds(updateDoc(doc(as('admin'), EVENT), { headcounts: { adults: 200, teens: 30, children: 45 }, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/events/2026-10-18_ict'), event('admin', { orgId: 'adia', type: 'class', name: 'ICT' })));
  });

  it('rejects counts that are negative, not whole numbers, or not a known count', async () => {
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: -1 } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: 2.5 } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: '20' } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { visitors: 3 } })));
  });

  it('requires the record id to start with its date, and a known kind of gathering', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-10-11_sunday_10_00_service'), event('admin')));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { type: 'party' })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { date: '18/10/2026' })));
  });

  it('needs the attendance permission and an active account', async () => {
    await assertFails(setDoc(doc(as('inactive'), EVENT), event('inactive')));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), EVENT), event('nobody')));
  });

  it('never allows a hard delete', async () => {
    await seedEvent();
    await assertFails(deleteDoc(doc(as('pastor'), EVENT)));
  });
});

describe('check-in', () => {
  it('lets an admin check someone in, change the mark, and undo it', async () => {
    await seedEvent();
    await assertSucceeds(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await assertSucceeds(updateDoc(doc(as('admin'), RECORD), { status: 'late', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(updateDoc(doc(as('admin'), RECORD), { deletedAt: serverTimestamp(), deletedBy: 'admin', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('lets a new service and its first check-in be saved together', async () => {
    const db = as('admin');
    const batch = writeBatch(db);
    batch.set(doc(db, EVENT), event('admin'));
    batch.set(doc(db, RECORD), checkIn('admin'));
    await assertSucceeds(batch.commit());
  });

  it('rejects a check-in to a gathering or person that does not exist', async () => {
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/attendance/2026-10-18_sunday_10_00_service_ghost'), checkIn('admin', { personId: 'ghost' })));
  });

  it('rejects a check-in on a different date from its gathering, or under the wrong id', async () => {
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { date: '2026-10-11' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/attendance/whatever'), checkIn('admin')));
  });

  it('rejects unknown marks and methods, and moving a record to another person', async () => {
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { status: 'asleep' })));
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { method: 'magic' })));
    await assertSucceeds(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/fcn/people/p2'), { ...person('fcn', { fullName: 'Peter Otieno' }), ...created('pastor'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    await assertFails(updateDoc(doc(as('admin'), RECORD), { personId: 'p2', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('keeps each organization’s attendance apart', async () => {
    await seedEvent();
    await assertSucceeds(getDocs(query(collection(as('admin'), 'organizations/fcn/attendance'), where('eventId', '==', '2026-10-18_sunday_10_00_service'))));
    await assertFails(getDocs(collection(as('admin'), 'organizations/adia/attendance')));
    await assertFails(getDocs(collection(as('admin'), 'organizations/adia/events')));
  });

  it('lets a class register mark a student at ADIA', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/events/2026-10-19_ict'), {
        ...event('pastor', { orgId: 'adia', date: '2026-10-19', type: 'class', name: 'ICT', activity: 'ICT', headcounts: {} }),
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/adia/attendance/2026-10-19_ict_s1'), checkIn('pastor', {
      orgId: 'adia', eventId: '2026-10-19_ict', personId: 's1', date: '2026-10-19', status: 'excused', method: 'register',
    })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/attendance/2026-10-19_ict_s1'), checkIn('admin', {
      orgId: 'adia', eventId: '2026-10-19_ict', personId: 's1', date: '2026-10-19', method: 'register',
    })));
  });
});
