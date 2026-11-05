import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

/** The usher counter app (Android), exactly as usher-counter-app-firestore.md tells it to save (Andy, 2026-11-03). */
let env: RulesTestEnvironment;
const usher = () => env.authenticatedContext('usher').firestore();
const ID = '2026-11-03_main_service_10_00';
const PATH = `organizations/fcn/events/${ID}`;
const template = () => ({
  orgId: 'fcn', date: '2026-11-03', type: 'service', name: 'Main service 10:00', activity: null,
  headcounts: { adults: 0, teens: 0, children: 0 }, notes: '', serviceKind: null, deletedAt: null, deletedBy: null,
  createdBy: 'usher', createdAt: serverTimestamp(), updatedBy: 'usher', updatedAt: serverTimestamp(),
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/usher'), {
      email: 'usher@example.org', displayName: 'Usher phone', roleId: 'usher', permissions: ['people.read', 'people.write', 'attendance.write'],
      extraPermissions: [], orgIds: ['fcn'], allOrgs: false, active: true, mustChangePassword: false,
    });
  });
});

describe('usher counter app', () => {
  it('reads its own account and the church', async () => {
    const me = await assertSucceeds(getDoc(doc(usher(), 'users/usher')));
    expect(me.data()?.orgIds).toEqual(['fcn']);
    await assertSucceeds(getDoc(doc(usher(), 'organizations/fcn')));
  });
  it('lists the day\'s services, creates one, and counts into it', async () => {
    await assertSucceeds(getDocs(query(collection(usher(), 'organizations/fcn/events'), where('date', '==', '2026-11-03'))));
    await assertSucceeds(setDoc(doc(usher(), PATH), template()));
    await assertSucceeds(updateDoc(doc(usher(), PATH), { 'headcounts.adults': 150, 'headcounts.teens': 30, 'headcounts.children': 45, updatedBy: 'usher', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(usher(), PATH), { 'headcounts.adults': increment(1), updatedBy: 'usher', updatedAt: serverTimestamp() }));
  });
  it('refuses the common mistakes', async () => {
    await assertSucceeds(setDoc(doc(usher(), PATH), template()));
    // A decimal count (150.5), no updatedBy/updatedAt, a phone clock instead of the server time, or a wrong church.
    await assertFails(updateDoc(doc(usher(), PATH), { 'headcounts.adults': 150.5, updatedBy: 'usher', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(usher(), PATH), { 'headcounts.adults': 151 }));
    await assertFails(updateDoc(doc(usher(), PATH), { 'headcounts.adults': 151, updatedBy: 'usher', updatedAt: new Date() }));
    await assertFails(setDoc(doc(usher(), 'organizations/adia/events/2026-11-03_x'), { ...template(), orgId: 'adia', name: 'X' }));
    // An extra field the system doesn't know, such as "total" at the top or "status".
    await assertFails(setDoc(doc(usher(), 'organizations/fcn/events/2026-11-03_y'), { ...template(), name: 'Y', status: 'open' }));
  });
});
