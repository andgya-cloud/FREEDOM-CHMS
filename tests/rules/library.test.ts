import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const BOOK = 'organizations/adia/libraryBooks/LIB-0001';
const book = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'adia', no: 'LIB-0001', n: 1, title: 'Spiritual Leadership', author: 'J. Oswald Sanders', category: 'Leadership & Ministry', isbn: '', shelf: '',
  price: null, status: 'in', loan: null, timesOut: 0, lostNote: null, addedOn: '2026-11-18', ...created(uid), ...over,
});
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const u = (roleId: string, extra: Record<string, unknown>) => ({ email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions: [], active: true, ...extra });
    await setDoc(doc(db, 'users/elizabeth'), u('head', { permissions: ['people.read', 'people.write', 'team.manage'] }));
    await setDoc(doc(db, 'users/lib'), u('librarian', { permissions: ['people.read'] }));
    await setDoc(doc(db, 'users/felix'), u('labtech', { inventoryCourseIds: ['ict'] }));
  });
});

describe('library', () => {
  it('lets the head, the librarian and the pastor add books; nobody else', async () => {
    await assertSucceeds(setDoc(doc(as('elizabeth'), BOOK), book('elizabeth')));
    await assertSucceeds(setDoc(doc(as('lib'), 'organizations/adia/libraryBooks/LIB-0002'), book('lib', { no: 'LIB-0002', n: 2 })));
    await assertSucceeds(getDoc(doc(as('pastor'), BOOK)));
    await assertFails(setDoc(doc(as('felix'), 'organizations/adia/libraryBooks/LIB-0003'), book('felix', { no: 'LIB-0003', n: 3 })));
    await assertFails(getDoc(doc(as('felix'), BOOK)));
    // The number on the sticker is the document's name.
    await assertFails(setDoc(doc(as('lib'), 'organizations/adia/libraryBooks/LIB-0009'), book('lib', { no: 'LIB-0004', n: 4 })));
  });

  it('lends and returns a book in one go, and keeps the number', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), BOOK), { ...book('lib'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }); });
    const db = as('lib');
    const loan = { loanId: 'L1', who: 'student:s1', whoName: 'Grace', kind: 'student', phone: null, outOn: '2026-11-18', dueOn: '2026-12-02', renewals: 0 };
    const b = writeBatch(db);
    b.update(doc(db, BOOK), { status: 'out', loan, timesOut: increment(1), ...stamp('lib') });
    b.set(doc(db, 'organizations/adia/libraryLoans/L1'), {
      orgId: 'adia', bookId: 'LIB-0001', bookNo: 'LIB-0001', title: 'Spiritual Leadership', category: 'Leadership & Ministry', who: 'student:s1', whoName: 'Grace',
      kind: 'student', phone: null, outOn: '2026-11-18', dueOn: '2026-12-02', returnedOn: null, state: 'out', cost: null, byName: 'Librarian', ...created('lib'),
    });
    await assertSucceeds(b.commit());
    await assertFails(updateDoc(doc(db, BOOK), { n: 7, ...stamp('lib') }));
    await assertFails(updateDoc(doc(db, BOOK), { status: 'gone', ...stamp('lib') }));
    await assertSucceeds(updateDoc(doc(db, BOOK), { status: 'in', loan: null, ...stamp('lib') }));
  });

  it('keeps members, the counter and the shelf check to the library staff', async () => {
    await assertSucceeds(setDoc(doc(as('lib'), 'organizations/adia/libraryMembers/m1'), { orgId: 'adia', name: 'Peter Mwangi', phone: '+254712345678', kind: 'church', ...created('lib') }));
    await assertFails(setDoc(doc(as('lib'), 'organizations/adia/libraryMembers/m2'), { orgId: 'adia', name: 'X', phone: null, kind: 'student', ...created('lib') }));
    await assertSucceeds(setDoc(doc(as('lib'), 'organizations/adia/libraryMeta/counter'), { orgId: 'adia', next: 3, ...created('lib') }));
    await assertFails(updateDoc(doc(as('lib'), 'organizations/adia/libraryMeta/counter'), { next: 2, ...stamp('lib') }));
    await assertSucceeds(setDoc(doc(as('elizabeth'), 'organizations/adia/libraryChecks/c1'), { orgId: 'adia', name: 'Term 3 2026', startedOn: '2026-11-18', seen: [], closedOn: null, byName: 'E', ...created('elizabeth') }));
    await assertFails(setDoc(doc(as('felix'), 'organizations/adia/libraryChecks/c2'), { orgId: 'adia', name: 'Term 3 2026', startedOn: '2026-11-18', seen: [], closedOn: null, byName: 'F', ...created('felix') }));
  });
});
