import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
const O = 'organizations/hope';
const ADMIN_PERMS = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage'];
const consent = { given: true, date: '2026-10-01' };
const none = { given: null, date: null };

const child = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'hope', code: null, status: 'active', enrolledOn: '2026-10-01', schoolStatus: 'in_school',
  programmes: [{ name: 'Football academy', group: 'U12', level: '' }], photoConsent: consent, guardianConsent: consent, ...created(uid), ...over,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (permissions: string[], extra: Record<string, unknown>) => ({ email: 'x@example.org', displayName: 'x', roleId: 'admin', extraPermissions: [], orgIds: [], allOrgs: false, permissions, active: true, ...extra });
    await setDoc(doc(db, 'users/hopeAdmin'), user(ADMIN_PERMS, { orgIds: ['hope'] }));
    await setDoc(doc(db, 'organizations/hope'), { name: 'Freedom Hope Center', type: 'ministry', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FHC', active: true, ...stamps });
    await setDoc(doc(db, `${O}/people/c1`), { orgId: 'hope', fullName: 'Baraka Otieno', firstName: 'Baraka', status: 'child', whatsappConsent: {}, ...stamps });
    await setDoc(doc(db, `${O}/people/c2`), { orgId: 'hope', fullName: 'Neema Achieng', firstName: 'Neema', status: 'child', whatsappConsent: {}, ...stamps });
    await setDoc(doc(db, `${O}/children/c1`), { ...child('pastor'), code: 'HC-0001', createdAt: old, updatedAt: old });
    await setDoc(doc(db, `${O}/childPrivate/c1`), { orgId: 'hope', welfare: 'Lives with an aunt', health: 'Asthma', home: '', ...stamps });
    await setDoc(doc(db, `${O}/homeVisits/v1`), { orgId: 'hope', childId: 'c1', date: '2026-10-05', note: 'Visited the aunt', ...stamps });
    await setDoc(doc(db, `${O}/referrals/r1`), { orgId: 'hope', childId: 'c1', date: '2026-10-05', to: 'Clinic', reason: 'Cough', status: 'open', outcome: '', ...stamps });
    await setDoc(doc(db, `${O}/safeguardingConcerns/s1`), { orgId: 'hope', childId: 'c1', summary: 'Bruises seen', status: 'open', createdAt: old, createdBy: 'pastor' });
    await setDoc(doc(db, `${O}/hopeReports/monthly_2026-09-01`), { orgId: 'hope', type: 'monthly', audience: 'counts', metrics: {} });
    await setDoc(doc(db, `${O}/hopeReports/weekly_2026-10-12`), { orgId: 'hope', type: 'weekly', audience: 'pastor', followUps: [{ code: 'HC-0001', name: 'Baraka Otieno' }] });
  });
});

describe('the children register', () => {
  it('lets an admin read it and register a child, with the code left for the server', async () => {
    await assertSucceeds(getDoc(doc(as('hopeAdmin'), `${O}/children/c1`)));
    await assertFails(getDoc(doc(as('admin'), `${O}/children/c1`))); // staff of another campus
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin')));
  });
  it('saves a child with consent missing', async () => {
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin', { photoConsent: none, guardianConsent: none })));
  });
  it('does not let anyone choose or change the code', async () => {
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin', { code: 'HC-0099' })));
    await assertFails(updateDoc(doc(as('hopeAdmin'), `${O}/children/c1`), { code: 'HC-0002', updatedAt: serverTimestamp(), updatedBy: 'hopeAdmin' }));
  });
  it('has no place for a photo', async () => {
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin', { photoUrl: 'https://example.org/a.jpg' })));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin', { photo: 'data:image/png;base64,AAAA' })));
  });
  it('rejects a child whose person record does not exist, and a bad consent shape', async () => {
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/children/ghost`), child('hopeAdmin')));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/children/c2`), child('hopeAdmin', { photoConsent: { given: 'yes', date: null } })));
  });
  it('lets an admin mark a child as exited, never delete', async () => {
    await assertSucceeds(updateDoc(doc(as('hopeAdmin'), `${O}/children/c1`), { status: 'exited', exitedOn: '2026-10-18', updatedAt: serverTimestamp(), updatedBy: 'hopeAdmin' }));
    await assertFails(deleteDoc(doc(as('hopeAdmin'), `${O}/children/c1`)));
  });
});

describe('welfare records are pastor only', () => {
  it('keeps notes, health flags, home visits and referrals from an admin', async () => {
    for (const path of ['childPrivate/c1', 'homeVisits/v1', 'referrals/r1']) {
      await assertFails(getDoc(doc(as('hopeAdmin'), `${O}/${path}`)));
      await assertSucceeds(getDoc(doc(as('pastor'), `${O}/${path}`)));
    }
    await assertFails(getDocs(collection(as('hopeAdmin'), `${O}/homeVisits`)));
  });
  it('lets only the pastor write them', async () => {
    const note = (uid: string) => ({ orgId: 'hope', welfare: 'x', health: '', home: '', ...created(uid) });
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/childPrivate/c2`), note('hopeAdmin')));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/children/c2`), { ...child('pastor') }); });
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/childPrivate/c2`), note('pastor')));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/homeVisits/v2`), { orgId: 'hope', childId: 'c1', date: '2026-10-06', note: 'x', ...created('hopeAdmin') }));
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/homeVisits/v2`), { orgId: 'hope', childId: 'c1', date: '2026-10-06', note: 'x', ...created('pastor') }));
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/referrals/r2`), { orgId: 'hope', childId: 'c1', date: '2026-10-06', to: 'Clinic', reason: 'x', status: 'open', outcome: '', ...created('pastor') }));
  });
});

describe('safeguarding concerns', () => {
  const concern = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'hope', childId: 'c1', summary: 'I am worried about Baraka', status: 'open', createdAt: serverTimestamp(), createdBy: uid, ...over });
  it('lets an admin raise one but never open it again', async () => {
    const ref = doc(as('hopeAdmin'), `${O}/safeguardingConcerns/new1`);
    await assertSucceeds(setDoc(ref, concern('hopeAdmin')));
    await assertFails(getDoc(ref));
    await assertFails(getDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/s1`)));
    await assertFails(getDocs(collection(as('hopeAdmin'), `${O}/safeguardingConcerns`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${O}/safeguardingConcerns/new1`)));
  });
  it('cannot be changed or removed by the admin who raised it', async () => {
    await assertFails(updateDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/s1`), { summary: 'changed' }));
    await assertFails(deleteDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/s1`)));
    await assertFails(deleteDoc(doc(as('pastor'), `${O}/safeguardingConcerns/s1`)));
  });
  it('rejects a concern about a child who is not on the register, or one signed by someone else', async () => {
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/n2`), concern('hopeAdmin', { childId: 'ghost' })));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/n3`), concern('pastor')));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/safeguardingConcerns/n4`), concern('hopeAdmin', { status: 'closed' })));
  });
  it('lets the pastor close it with a note', async () => {
    await assertSucceeds(updateDoc(doc(as('pastor'), `${O}/safeguardingConcerns/s1`), { status: 'closed', closingNote: 'Spoke with the guardian', closedAt: serverTimestamp(), closedBy: 'pastor' }));
    await assertFails(updateDoc(doc(as('pastor'), `${O}/safeguardingConcerns/s1`), { summary: 'rewritten' }));
  });
});

describe('exports of child data', () => {
  const request = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'hope', scope: 'register', reason: 'Report for the donor visit', status: 'pending', createdAt: serverTimestamp(), createdBy: uid, ...over });
  it('needs the pastor to approve a request from an admin', async () => {
    const ref = doc(as('hopeAdmin'), `${O}/childExports/x1`);
    await assertSucceeds(setDoc(ref, request('hopeAdmin')));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/childExports/x2`), request('hopeAdmin', { status: 'approved', decidedBy: 'hopeAdmin', decidedAt: serverTimestamp() })));
    await assertFails(updateDoc(ref, { status: 'approved', decidedBy: 'hopeAdmin', decidedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { downloadedAt: serverTimestamp() })); // not approved yet
    await assertSucceeds(updateDoc(doc(as('pastor'), `${O}/childExports/x1`), { status: 'approved', decidedBy: 'pastor', decidedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { downloadedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { downloadedAt: serverTimestamp() })); // once only
  });
  it('lets the pastor refuse, and lets an admin see only their own requests', async () => {
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/childExports/x1`), request('hopeAdmin')));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/childExports/other`), { ...request('pastor'), createdAt: old }); });
    await assertSucceeds(getDoc(doc(as('hopeAdmin'), `${O}/childExports/x1`)));
    await assertFails(getDoc(doc(as('hopeAdmin'), `${O}/childExports/other`)));
    await assertSucceeds(updateDoc(doc(as('pastor'), `${O}/childExports/x1`), { status: 'denied', decidedBy: 'pastor', decidedAt: serverTimestamp() }));
  });
  it('lets the pastor export directly, with a record', async () => {
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/childExports/p1`), request('pastor', { status: 'approved', decidedBy: 'pastor', decidedAt: serverTimestamp() })));
  });
});

describe('Hope Center reports', () => {
  it('shows an admin the counts-only report but not the one with names', async () => {
    await assertSucceeds(getDoc(doc(as('hopeAdmin'), `${O}/hopeReports/monthly_2026-09-01`)));
    await assertFails(getDoc(doc(as('hopeAdmin'), `${O}/hopeReports/weekly_2026-10-12`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${O}/hopeReports/weekly_2026-10-12`)));
    await assertFails(setDoc(doc(as('pastor'), `${O}/hopeReports/monthly_2026-10-01`), { orgId: 'hope' }));
  });
  it('lets an admin ask for a monthly report only', async () => {
    const req = (uid: string, type: string) => ({ orgId: 'hope', type, from: '2026-09-01', status: 'pending', createdAt: serverTimestamp(), createdBy: uid });
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/hopeReportRequests/a`), req('hopeAdmin', 'monthly')));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/hopeReportRequests/b`), req('hopeAdmin', 'weekly')));
    await assertSucceeds(setDoc(doc(as('pastor'), `${O}/hopeReportRequests/c`), req('pastor', 'weekly')));
  });
});
