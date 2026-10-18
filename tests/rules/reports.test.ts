import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const REPORT = 'organizations/fcn/reports/weekly_2026-10-12';
const old = Timestamp.fromDate(new Date('2026-10-19T04:00:00Z'));
const request = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', type: 'weekly', from: '2026-10-12', email: false, status: 'pending', createdAt: serverTimestamp(), createdBy: uid, ...overrides,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const stamp = { orgId: 'fcn', generatedAt: old, generatedBy: 'system' };
    await setDoc(doc(db, REPORT), { ...stamp, type: 'weekly', from: '2026-10-12', to: '2026-10-18' });
    await setDoc(doc(db, `${REPORT}/private/pastoral`), { ...stamp, salvations: [{ personId: 'p1', name: 'Grace', date: '2026-10-18' }] });
    await setDoc(doc(db, `${REPORT}/private/giving`), { ...stamp, current: { totalCents: 500000 } });
    await setDoc(doc(db, 'organizations/adia/reports/weekly_2026-10-12'), { ...stamp, orgId: 'adia' });
    await setDoc(doc(db, 'mail/m1'), { to: ['pastor@example.org'], message: { subject: 'Report' } });
  });
});

describe('the Reports archive', () => {
  it('lets staff who see people read reports, but not change them', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), REPORT)));
    await assertSucceeds(getDocs(collection(as('admin'), 'organizations/fcn/reports')));
    await assertFails(updateDoc(doc(as('admin'), REPORT), { to: '2026-10-19' }));
    await assertFails(updateDoc(doc(as('pastor'), REPORT), { to: '2026-10-19' }));
    await assertFails(getDoc(doc(as('inactive'), REPORT)));
  });

  it('keeps salvation names and giving to pastoral and finance staff', async () => {
    await assertFails(getDoc(doc(as('admin'), `${REPORT}/private/pastoral`)));
    await assertFails(getDoc(doc(as('admin'), `${REPORT}/private/giving`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${REPORT}/private/pastoral`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${REPORT}/private/giving`)));
    await assertFails(getDoc(doc(as('pastor'), `${REPORT}/private/other`)));
  });

  it('keeps other campuses out', async () => {
    await assertFails(getDoc(doc(as('admin'), 'organizations/adia/reports/weekly_2026-10-12')));
    await assertSucceeds(getDoc(doc(as('pastor'), 'organizations/adia/reports/weekly_2026-10-12')));
  });

  it('never lets anyone read or write the outgoing email', async () => {
    await assertFails(getDoc(doc(as('pastor'), 'mail/m1')));
    await assertFails(setDoc(doc(as('pastor'), 'mail/m2'), { to: ['someone@example.org'], message: { subject: 'Hi' } }));
  });
});

describe('making a report by hand', () => {
  const ref = (uid: string, id = 'r1') => doc(as(uid), `organizations/fcn/reportRequests/${id}`);

  it('lets staff ask for a weekly or monthly report for any period', async () => {
    await assertSucceeds(setDoc(ref('admin'), request('admin')));
    await assertSucceeds(setDoc(ref('admin', 'r2'), request('admin', { type: 'monthly', from: '2025-03-01' })));
    await assertSucceeds(getDoc(ref('admin')));
  });

  it('only lets settings managers have it emailed', async () => {
    await assertFails(setDoc(ref('admin'), request('admin', { email: true })));
    await assertSucceeds(setDoc(ref('settingsAdmin', 'r2'), request('settingsAdmin', { email: true })));
    await assertSucceeds(setDoc(ref('pastor', 'r3'), request('pastor', { email: true })));
  });

  it('refuses requests that are malformed, already done, or in someone else\'s name', async () => {
    await assertFails(setDoc(ref('admin'), request('admin', { type: 'daily' })));
    await assertFails(setDoc(ref('admin'), request('admin', { from: '12/10/2026' })));
    await assertFails(setDoc(ref('admin'), request('admin', { status: 'done' })));
    await assertFails(setDoc(ref('admin'), request('admin', { createdBy: 'pastor' })));
    await assertFails(setDoc(ref('admin'), request('admin', { reportId: 'x' })));
    await assertFails(setDoc(ref('admin'), request('admin', { orgId: 'adia' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/reportRequests/r1'), request('admin', { orgId: 'adia' })));
  });

  it('can\'t be changed afterwards', async () => {
    await assertSucceeds(setDoc(ref('admin'), request('admin')));
    await assertFails(updateDoc(ref('admin'), { status: 'done' }));
  });
});
