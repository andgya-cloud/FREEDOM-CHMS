import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
const O = 'organizations/hope';
const PERMS = ['people.read', 'people.write', 'attendance.write', 'followups.manage'];
const consent = { given: true, date: '2026-10-01' };
const child = (over: Record<string, unknown> = {}) => ({
  orgId: 'hope', code: 'HC-0001', status: 'active', enrolledOn: '2026-10-01', schoolStatus: 'in_school', programmes: [],
  photoConsent: consent, guardianConsent: consent, ...stamps, ...over,
});
const day = (uid: string, date: string, marks: Record<string, unknown>) => ({ orgId: 'hope', date, marks, updatedAt: serverTimestamp(), updatedBy: uid });
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (roleId: string, permissions: string[]) => ({ email: 'x@example.org', displayName: 'x', roleId, extraPermissions: [], orgIds: ['hope'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/hopeAdmin'), user('admin', PERMS));
    await setDoc(doc(db, 'users/hopeStaff'), user('staff', PERMS));
    await setDoc(doc(db, 'organizations/hope'), { name: 'Freedom Hope Center', type: 'ministry', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FHC', active: true, ...stamps });
    for (const id of ['c1', 'c2']) await setDoc(doc(db, `${O}/people/${id}`), { orgId: 'hope', fullName: id, firstName: id, status: 'child', whatsappConsent: {}, ...stamps });
    await setDoc(doc(db, `${O}/children/c1`), child());
    await setDoc(doc(db, `${O}/children/c2`), child({ code: 'HC-0002', photoConsent: { given: null, date: null } }));
  });
});

describe('the new child details', () => {
  it('keeps the sponsor, parent contact and the Departing status', async () => {
    await assertSucceeds(updateDoc(doc(as('hopeStaff'), `${O}/children/c1`), {
      sponsorName: 'John Smith', sponsorPhone: '+44 7700 900000', sponsorEmail: 'john@example.org', parentName: 'Mary', parentPhone: '0712345678',
      status: 'departing', departingNote: 'Moving to Kisumu', updatedAt: serverTimestamp(), updatedBy: 'hopeStaff',
    }));
    await assertFails(updateDoc(doc(as('hopeStaff'), `${O}/children/c1`), { status: 'gone', updatedAt: serverTimestamp(), updatedBy: 'hopeStaff' }));
    await assertFails(updateDoc(doc(as('hopeStaff'), `${O}/children/c1`), { sponsorName: 'x'.repeat(121), updatedAt: serverTimestamp(), updatedBy: 'hopeStaff' }));
  });
});

describe('child photos', () => {
  it('can be saved only while photo consent is yes', async () => {
    const photo = (uid: string) => ({ orgId: 'hope', photo: JPEG, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(setDoc(doc(as('hopeStaff'), `${O}/childPhotos/c1`), photo('hopeStaff')));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/childPhotos/c2`), photo('hopeStaff')));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/childPhotos/c1`), { ...photo('hopeStaff'), photo: 'data:text/html;base64,AAAA' }));
    await assertSucceeds(getDoc(doc(as('hopeStaff'), `${O}/childPhotos/c1`)));
    await assertFails(getDoc(doc(as('admin'), `${O}/childPhotos/c1`))); // another campus
  });
  it('goes when consent is taken away, in the same save', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/childPhotos/c1`), { orgId: 'hope', photo: JPEG }); });
    const db = as('hopeStaff');
    const b = writeBatch(db);
    b.update(doc(db, `${O}/children/c1`), { photoConsent: { given: false, date: '2026-11-04' }, hasPhoto: false, updatedAt: serverTimestamp(), updatedBy: 'hopeStaff' });
    b.delete(doc(db, `${O}/childPhotos/c1`));
    await assertSucceeds(b.commit());
    await assertFails(deleteDoc(doc(as('admin'), `${O}/childPhotos/c1`)));
  });
});

describe('the weekly registers', () => {
  it('lets whoever takes registers mark the children, as a merge', async () => {
    await assertSucceeds(setDoc(doc(as('hopeStaff'), `${O}/hopeDays/2026-10-31`), day('hopeStaff', '2026-10-31', { c1: { s: 'present', t: '09:05' } }), { merge: true }));
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/hopeDays/2026-10-31`), day('hopeAdmin', '2026-10-31', { c2: { s: 'excused', r: 'Sick' } }), { merge: true }));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/hopeDays/2026-10-31`), day('hopeStaff', '2026-11-01', {}), { merge: true })); // wrong date
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/hopeDays/2026-10-24`), { ...day('hopeStaff', '2026-10-24', {}), extra: 1 }));
    await assertFails(setDoc(doc(as('admin'), `${O}/hopeDays/2026-10-24`), day('admin', '2026-10-24', {})));
    await assertFails(deleteDoc(doc(as('hopeAdmin'), `${O}/hopeDays/2026-10-31`)));
  });
  it('lets only the Director or an admin keep the champions and their register', async () => {
    const champ = (uid: string) => ({ orgId: 'hope', name: 'Peter Otieno', phone: '0722', email: '', duty: 'Coach', status: 'active', joinedOn: '2025-03-01', ...created(uid) });
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/champions/p1`), champ('hopeAdmin')));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/champions/p2`), champ('hopeStaff')));
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/championDays/2026-10-31`), day('hopeAdmin', '2026-10-31', { p1: { s: 'late', in: '09:10', out: '12:00', duty: 'Coach' } }), { merge: true }));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/championDays/2026-10-31`), day('hopeStaff', '2026-10-31', { p1: { s: 'absent' } }), { merge: true }));
    await assertSucceeds(getDoc(doc(as('hopeStaff'), `${O}/championDays/2026-10-31`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${O}/champions/p1`)));
  });
});

describe('clubs', () => {
  const club = (uid: string, over: Record<string, unknown> = {}) => ({
    orgId: 'hope', name: 'Chess Club', emoji: '♟️', description: '', day: 'Saturday', time: '10:00', endTime: '12:00', place: 'Hall', capacity: 20,
    memberIds: ['c1'], leaderIds: [], levels: { c1: 'Level 2' }, legacyProgramme: 'Chess club', status: 'active', ...created(uid), ...over,
  });
  it('lets staff keep clubs, mark them and log wins', async () => {
    await assertSucceeds(setDoc(doc(as('hopeStaff'), `${O}/clubs/chess`), club('hopeStaff')));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/clubs/bad`), club('hopeStaff', { day: 'Someday' })));
    await assertFails(setDoc(doc(as('admin'), `${O}/clubs/x`), club('admin')));
    const mark = (uid: string, id: string, clubId: string, date: string) => setDoc(doc(as(uid), `${O}/clubDays/${id}`),
      { orgId: 'hope', clubId, date, marks: { c1: { s: 'present' } }, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
    await assertSucceeds(mark('hopeStaff', 'chess_2026-10-31', 'chess', '2026-10-31'));
    await assertFails(mark('hopeStaff', 'chess_2026-10-24', 'chess', '2026-10-31')); // id must match
    await assertFails(mark('hopeStaff', 'ghost_2026-10-31', 'ghost', '2026-10-31')); // no such club
    const win = (uid: string, over: Record<string, unknown> = {}) => ({ orgId: 'hope', clubId: 'chess', date: '2026-10-31', kind: 'award', title: 'County champions', note: '', childIds: ['c1'], ...created(uid), ...over });
    await assertSucceeds(setDoc(doc(as('hopeStaff'), `${O}/clubWins/w1`), win('hopeStaff')));
    await assertFails(setDoc(doc(as('hopeStaff'), `${O}/clubWins/w2`), win('hopeStaff', { kind: 'trophy' })));
    await assertSucceeds(getDoc(doc(as('hopeAdmin'), `${O}/clubWins/w1`)));
  });
});

describe('codes kept from a sheet', () => {
  it('lets a new child keep a code only when it is claimed in the same save', async () => {
    const db = as('hopeStaff');
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/people/c3`), { orgId: 'hope', fullName: 'c3', firstName: 'c3', status: 'child', whatsappConsent: {}, ...stamps }); });
    const fresh = (code: string | null) => ({ ...child({ code }), ...created('hopeStaff') });
    await assertFails(setDoc(doc(db, `${O}/children/c3`), fresh('HC-0042')));
    const b = writeBatch(db);
    b.set(doc(db, `${O}/children/c3`), fresh('HC-0042'));
    b.set(doc(db, `${O}/childCodes/HC-0042`), { orgId: 'hope', childId: 'c3' });
    await assertSucceeds(b.commit());
    // The same code cannot be claimed twice.
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${O}/people/c4`), { orgId: 'hope', fullName: 'c4', firstName: 'c4', status: 'child', whatsappConsent: {}, ...stamps }); });
    const b2 = writeBatch(db);
    b2.set(doc(db, `${O}/children/c4`), fresh('HC-0042'));
    b2.set(doc(db, `${O}/childCodes/HC-0042`), { orgId: 'hope', childId: 'c4' });
    await assertFails(b2.commit());
    await assertFails(setDoc(doc(db, `${O}/childCodes/bad`), { orgId: 'hope', childId: 'c4' }));
  });
});

describe('helpers arriving', () => {
  it('lets each helper record only their own time', async () => {
    const at = (uid: string, marks: Record<string, unknown>) => ({ orgId: 'hope', date: '2026-11-07', marks, updatedAt: serverTimestamp(), updatedBy: uid });
    await assertSucceeds(setDoc(doc(as('hopeStaff'), `${O}/helperDays/2026-11-07`), at('hopeStaff', { hopeStaff: { name: 'Mary', t: '08:42' } }), { merge: true }));
    await assertSucceeds(setDoc(doc(as('hopeAdmin'), `${O}/helperDays/2026-11-07`), at('hopeAdmin', { hopeAdmin: { name: 'John', t: '09:01' } }), { merge: true }));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/helperDays/2026-11-07`), at('hopeAdmin', { hopeStaff: { name: 'Mary', t: '10:00' } }), { merge: true }));
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/helperDays/2026-11-07`), at('hopeAdmin', { hopeAdmin: { name: 'John', t: 'soon' } }), { merge: true }));
  });
});

describe('school fees', () => {
  it('keeps how the fees are paid, and the class', async () => {
    const db = as('hopeStaff');
    const pay = { by: 'paybill', number: '247247', account: '804212#Miles', payTo: 'Petunia School', amount: '', note: '' };
    const up = (changes: Record<string, unknown>) => updateDoc(doc(db, `${O}/children/c1`), { ...changes, updatedAt: serverTimestamp(), updatedBy: 'hopeStaff' });
    await assertSucceeds(up({ payment: pay, schoolClass: 'Grade 3' }));
    await assertSucceeds(up({ payment: null }));
    await assertFails(up({ payment: { ...pay, by: 'bitcoin' } }));
    await assertFails(up({ payment: { ...pay, secret: 'x' } }));
    await assertFails(up({ payment: { ...pay, note: 'x'.repeat(301) } }));
    await assertFails(up({ schoolClass: 'x'.repeat(41) }));
  });
});
