import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

/** Service hosts (Andy, 2026-11-17): the church sees who hosts; only rota.manage sees the hosts' contacts; nobody writes. */
let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { extraPermissions: [], allOrgs: false, active: true, mustChangePassword: false };
    await setDoc(doc(db, 'users/planner'), { ...base, orgIds: ['fcn'], email: 'p@example.org', displayName: 'Planner', roleId: 'admin', permissions: ['people.read', 'rota.manage'] });
    await setDoc(doc(db, 'users/usher'), { ...base, orgIds: ['fcn'], email: 'u@example.org', displayName: 'Usher', roleId: 'admin', permissions: ['people.read'] });
    await setDoc(doc(db, 'users/elizabeth'), { ...base, orgIds: ['adia'], email: 'e@example.org', displayName: 'Elizabeth Mutuku', roleId: 'admin', permissions: [], limitedOrgId: 'fcn', limitedCan: ['prayer'] });
    await setDoc(doc(db, 'users/diana'), { ...base, orgIds: ['hope'], email: 'd@example.org', displayName: 'Diana Kiunga', roleId: 'admin', permissions: ['people.read', 'people.write', 'pettycash.request'], limitedOrgId: 'fcn', limitedCan: ['hosts', 'sunday'] });
    await setDoc(doc(db, 'users/adiaPlanner'), { ...base, orgIds: ['adia'], email: 'a@example.org', displayName: 'ADIA', roleId: 'admin', permissions: ['rota.manage'] });
    await setDoc(doc(db, 'organizations/fcn/serviceHosts/h1'), { name: 'Mary', phone: '0712345678', email: 'm@example.org', deletedAt: null });
    await setDoc(doc(db, 'organizations/fcn/serviceRota/2026-11-22_sun1000'), { date: '2026-11-22', hostName: 'Mary', status: 'set' });
    await setDoc(doc(db, 'organizations/fcn/serviceHostSettings/main'), { services: [] });
    await setDoc(doc(db, 'organizations/fcn/serviceHostSent/x'), { days: 7 });
    await setDoc(doc(db, 'organizations/fcn/prayerLeaders/p1'), { name: 'John', deletedAt: null });
    await setDoc(doc(db, 'organizations/fcn/prayerRota/2026-11-22_sun0900'), { date: '2026-11-22', hostName: 'John', status: 'set' });
    await setDoc(doc(db, 'organizations/fcn/prayerSent/x'), { days: 7 });
  });
});

describe('service hosts', () => {
  it('shows who hosts to everyone at the church', async () => {
    await assertSucceeds(getDocs(collection(as('usher'), 'organizations/fcn/serviceRota')));
    await assertFails(getDocs(collection(as('adiaPlanner'), 'organizations/fcn/serviceRota')));
  });
  it('keeps the hosts list and settings for Andy and the planners', async () => {
    await assertSucceeds(getDocs(collection(as('planner'), 'organizations/fcn/serviceHosts')));
    await assertSucceeds(getDocs(collection(as('pastor'), 'organizations/fcn/serviceHosts')));
    await assertSucceeds(getDoc(doc(as('planner'), 'organizations/fcn/serviceHostSettings/main')));
    await assertFails(getDocs(collection(as('usher'), 'organizations/fcn/serviceHosts')));
    await assertFails(getDoc(doc(as('usher'), 'organizations/fcn/serviceHostSettings/main')));
    await assertFails(getDocs(collection(as('adiaPlanner'), 'organizations/fcn/serviceHosts')));
  });
  it('keeps the Sunday prayer schedule for Andy, Doreen and the prayer tick (Andy, 2026-11-26)', async () => {
    await assertSucceeds(getDocs(collection(as('keeper'), 'organizations/fcn/prayerRota')));
    await assertSucceeds(getDocs(collection(as('keeper'), 'organizations/fcn/prayerLeaders')));
    await assertSucceeds(getDocs(collection(as('elizabeth'), 'organizations/fcn/prayerRota')));
    await assertSucceeds(getDocs(collection(as('elizabeth'), 'organizations/fcn/prayerLeaders')));
    await assertSucceeds(getDoc(doc(as('elizabeth'), 'organizations/fcn')));
    await assertFails(getDocs(collection(as('elizabeth'), 'organizations/fcn/serviceHosts')));
    await assertFails(getDocs(collection(as('elizabeth'), 'organizations/fcn/people')));
    await assertFails(getDocs(collection(as('planner'), 'organizations/fcn/prayerLeaders')));
    await assertFails(getDocs(collection(as('planner'), 'organizations/fcn/prayerRota')));
    await assertFails(getDocs(collection(as('usher'), 'organizations/fcn/prayerRota')));
    await assertFails(getDoc(doc(as('pastor'), 'organizations/fcn/prayerSent/x')));
    await assertFails(setDoc(doc(as('keeper'), 'organizations/fcn/prayerRota/2026-11-29_sun0900'), { date: '2026-11-29' }));
  });
  it('gives Diana the Service hosts and nothing else at the church (Andy, 2026-11-26)', async () => {
    await assertSucceeds(getDocs(collection(as('diana'), 'organizations/fcn/serviceHosts')));
    await assertSucceeds(getDocs(collection(as('diana'), 'organizations/fcn/serviceRota')));
    await assertSucceeds(getDoc(doc(as('diana'), 'organizations/fcn/serviceHostSettings/main')));
    await assertSucceeds(getDoc(doc(as('diana'), 'organizations/fcn')));
    await assertFails(getDocs(collection(as('diana'), 'organizations/fcn/people')));
    await assertFails(getDocs(collection(as('diana'), 'organizations/fcn/events')));
    await assertFails(getDocs(collection(as('diana'), 'organizations/fcn/prayerRota')));
    await assertFails(setDoc(doc(as('diana'), 'organizations/fcn/serviceRota/2026-11-29_sun1000'), { date: '2026-11-29' }));
  });
  it('lets nobody write or read the sent record', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/serviceHosts/h2'), { name: 'X' }));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/serviceRota/2026-11-29_sun1000'), { date: '2026-11-29' }));
    await assertFails(getDoc(doc(as('pastor'), 'organizations/fcn/serviceHostSent/x')));
    await assertFails(getDoc(doc(as('pastor'), 'serviceHostKeys/_links')));
  });
});
