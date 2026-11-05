import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
const O = 'organizations/hope';
const consent = { given: true, date: '2026-10-01' };
const upd = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (roleId: string, permissions: string[]) => ({ email: 'x@example.org', displayName: 'x', roleId, extraPermissions: [], orgIds: ['hope'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/director'), user('head', ['people.read', 'people.write', 'attendance.write', 'programs.write', 'followups.manage', 'team.manage']));
    await setDoc(doc(db, 'users/helper'), user('helper', ['people.read', 'attendance.write']));
    await setDoc(doc(db, 'organizations/hope'), { name: 'Freedom Hope Center', type: 'ministry', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FHC', active: true, ...stamps });
    await setDoc(doc(db, `${O}/people/c1`), { orgId: 'hope', fullName: 'Baraka Otieno', firstName: 'Baraka', status: 'child', whatsappConsent: {}, ...stamps });
    await setDoc(doc(db, `${O}/children/c1`), { orgId: 'hope', code: 'HC-0001', status: 'active', enrolledOn: '2026-10-01', schoolStatus: 'in_school', programmes: [], photoConsent: consent, guardianConsent: consent, ...stamps });
    await setDoc(doc(db, `${O}/champions/ch1`), { orgId: 'hope', name: 'John Kamau', phone: '', email: '', duty: '', status: 'active', joinedOn: null, ...stamps });
    await setDoc(doc(db, `${O}/championDays/2026-11-07`), { orgId: 'hope', date: '2026-11-07', marks: { ch2: { s: 'present', in: '08:10' } }, updatedAt: old, updatedBy: 'director' });
  });
});

describe('v176 Hope', () => {
  it('saves allergies and the sponsorship on a child', async () => {
    await assertSucceeds(updateDoc(doc(as('director'), `${O}/children/c1`), { allergies: 'Peanuts', ...upd('director') }));
    await assertSucceeds(updateDoc(doc(as('director'), `${O}/children/c1`), {
      sponsorship: { childId: 'C467370', status: 'Sponsored', sponsorId: '691874', sponsorName: 'Josh', registeredOn: '2023-10-09', completesOn: '2034-11-30', centre: 'KE-014 Freedom Shujaa Hope Center', updatedOn: '2026-11-05' },
      sponsorName: 'Josh', ...upd('director'),
    }));
    // v177: the name as KE-014 spells it, and the "Not on KE-014" mark.
    await assertSucceeds(updateDoc(doc(as('director'), `${O}/children/c1`), {
      sponsorship: { childId: 'C467370', status: 'Sponsored', sponsorId: '691874', sponsorName: 'Josh', registeredOn: '2023-10-09', completesOn: '2034-11-30', centre: 'KE-014', updatedOn: '2026-11-05', listName: 'Abdi R. Kibugi' },
      ...upd('director'),
    }));
    await assertSucceeds(updateDoc(doc(as('director'), `${O}/children/c1`), {
      sponsorship: { childId: '', status: 'Not on KE-014', sponsorId: '', sponsorName: '', registeredOn: null, completesOn: null, centre: 'KE-014', updatedOn: '2026-11-05' },
      ...upd('director'),
    }));
  });
  it('lets the Director keep champion pay', async () => {
    await assertSucceeds(updateDoc(doc(as('director'), `${O}/champions/ch1`), { weeklyPay: 1500, code: 'CC-0001', ...upd('director') }));
    await assertFails(updateDoc(doc(as('helper'), `${O}/champions/ch1`), { weeklyPay: 1500, ...upd('helper') }));
    await assertSucceeds(setDoc(doc(as('director'), `${O}/championExtras/x1`), { orgId: 'hope', championId: 'ch1', month: '2026-11', amount: 300, reason: 'Trip', ...created('director') }));
    await assertFails(setDoc(doc(as('helper'), `${O}/championExtras/x2`), { orgId: 'hope', championId: 'ch1', month: '2026-11', amount: 300, reason: 'Trip', ...created('helper') }));
    await assertSucceeds(setDoc(doc(as('director'), `${O}/championPay/2026-11`), { orgId: 'hope', month: '2026-11', total: 1800, count: 1, approvedBy: 'director', approvedName: 'Diana', approvedAt: serverTimestamp() }));
  });
  it('lets the door add a champion check-in but not change one', async () => {
    const day = (marks: Record<string, unknown>) => ({ orgId: 'hope', date: '2026-11-07', marks, ...upd('helper') });
    await assertSucceeds(setDoc(doc(as('helper'), `${O}/championDays/2026-11-07`), day({ ch1: { s: 'late', in: '08:40' } }), { merge: true }));
    await assertFails(setDoc(doc(as('helper'), `${O}/championDays/2026-11-07`), day({ ch2: { s: 'absent' } }), { merge: true }));
    expect(true).toBe(true);
  });
});
