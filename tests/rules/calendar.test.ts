import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

/** The events calendar (Andy, 2026-11-14): the place sees it, calendar.manage changes it, invitees answer for themselves. */
let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const event = (by: string, over: Record<string, unknown> = {}) => ({
  orgId: 'fcn', title: 'Leaders meeting', type: 'meeting', allDay: false, date: '2026-11-20', endDate: '2026-11-20', start: '10:00', end: '11:00',
  place: 'Main hall', inCharge: '', notes: '', repeat: 'none', repeatUntil: null, skipDates: [], seriesId: null, seriesDate: null,
  reminders: [1440, 60], remindAll: false, invited: ['admin'], invitedNames: { admin: 'admin' }, responses: {}, endsOn: '2026-11-20', createdByName: 'Andy',
  deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: by, updatedAt: serverTimestamp(), updatedBy: by, ...over,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { extraPermissions: [], allOrgs: false, active: true, mustChangePassword: false };
    await setDoc(doc(db, 'users/leader'), { ...base, orgIds: ['fcn'], email: 'l@example.org', displayName: 'Leader', roleId: 'admin', permissions: ['people.read', 'calendar.manage'] });
    await setDoc(doc(db, 'users/adiaLeader'), { ...base, orgIds: ['adia'], email: 'a@example.org', displayName: 'ADIA', roleId: 'admin', permissions: ['calendar.manage'] });
    await setDoc(doc(db, 'users/trainer'), { ...base, orgIds: ['fcn'], email: 't@example.org', displayName: 'Trainer', roleId: 'trainer', permissions: ['exams.mark'] });
    await setDoc(doc(db, 'organizations/fcn/calendar/e1'), { ...event('leader'), createdAt: new Date(), updatedAt: new Date() });
  });
});

describe('calendar', () => {
  it('lets everyone at the place see it, and nobody from elsewhere', async () => {
    await assertSucceeds(getDocs(query(collection(as('trainer'), 'organizations/fcn/calendar'), where('deletedAt', '==', null))));
    await assertSucceeds(getDocs(collection(as('admin'), 'organizations/fcn/calendar')));
    await assertFails(getDocs(collection(as('adiaLeader'), 'organizations/fcn/calendar')));
  });
  it('lets only calendar.manage add events, well formed, at their own place', async () => {
    await assertSucceeds(setDoc(doc(as('leader'), 'organizations/fcn/calendar/e2'), event('leader')));
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/adia/calendar/e8'), event('pastor', { orgId: 'adia' })));
    // The shape the 2027 church calendar import writes: no reminders, nobody invited.
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/fcn/calendar/fc2027-communion'), event('pastor', { type: 'service', allDay: true, start: null, end: null, date: '2027-01-03', endDate: '2027-01-03', repeat: 'monthlyWeekday', repeatUntil: '2027-12-05', endsOn: '2027-12-05', reminders: [], invited: [], invitedNames: {}, skipDates: ['2027-02-07'] })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/calendar/e3'), event('admin')));
    await assertFails(setDoc(doc(as('adiaLeader'), 'organizations/fcn/calendar/e4'), event('adiaLeader')));
    await assertFails(setDoc(doc(as('leader'), 'organizations/fcn/calendar/e5'), event('leader', { endDate: '2026-11-19' })));
    await assertFails(setDoc(doc(as('leader'), 'organizations/fcn/calendar/e6'), event('leader', { type: 'party' })));
    await assertFails(setDoc(doc(as('leader'), 'organizations/fcn/calendar/e7'), event('leader', { secret: 1 })));
  });
  it('lets someone invited answer only for themselves', async () => {
    const mine = { 'responses.admin': 'yes', updatedAt: serverTimestamp(), updatedBy: 'admin' };
    await assertSucceeds(updateDoc(doc(as('admin'), 'organizations/fcn/calendar/e1'), mine));
    await assertFails(updateDoc(doc(as('admin'), 'organizations/fcn/calendar/e1'), { 'responses.leader': 'yes', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(as('admin'), 'organizations/fcn/calendar/e1'), { 'responses.admin': 'maybe', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(as('admin'), 'organizations/fcn/calendar/e1'), { title: 'Mine now', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(as('trainer'), 'organizations/fcn/calendar/e1'), { 'responses.trainer': 'yes', updatedAt: serverTimestamp(), updatedBy: 'trainer' }));
  });
  it('keeps push addresses and email choices to their owner', async () => {
    const token = { uid: 'admin', token: 'x'.repeat(40), device: 'Android · Chrome', updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(as('admin'), 'pushTokens/t1'), token));
    await assertFails(setDoc(doc(as('admin'), 'pushTokens/t2'), { ...token, uid: 'leader' }));
    await assertSucceeds(setDoc(doc(as('leader'), 'pushTokens/t1'), { ...token, uid: 'leader' }));
    await assertFails(setDoc(doc(as('admin'), 'pushTokens/t1'), { ...token, token: 'y'.repeat(40) }));
    await assertSucceeds(setDoc(doc(as('admin'), 'calendarPrefs/admin'), { email: false, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('admin'), 'calendarPrefs/leader'), { email: false, updatedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(as('admin'), 'organizations/fcn/calendarSent')));
  });
});
