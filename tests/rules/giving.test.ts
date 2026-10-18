import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, deleteDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const ORG = 'organizations/fcn';
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

const gift = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', personId: 'p1', giverName: 'Grace Wanjiku', phone: '254712345678', date: '2026-10-18',
  amountCents: 100000, fundId: 'tithes', method: 'mpesa', mpesaCode: 'QJK1AAAA01', accountRef: 'FCC#Tithes',
  status: 'confirmed', unassignedReason: null, receivedBy: uid, receivedByName: uid, handledBy: uid,
  notes: '', importId: null, receiptNumber: null, receiptIssuedAt: null, voidReason: null, voidedAt: null,
  ...created(uid), ...overrides,
});
const codeEntry = (uid: string, giftId: string, amountCents: number) => ({ orgId: 'fcn', giftId, amountCents, createdAt: serverTimestamp(), createdBy: uid });

/** A gift and its M-Pesa code entry, saved together the way the app does. */
function record(uid: string, giftId: string, overrides: Record<string, unknown> = {}) {
  const db = as(uid);
  const data = gift(uid, overrides);
  const batch = writeBatch(db);
  batch.set(doc(db, `${ORG}/gifts/${giftId}`), data);
  if (data.method === 'mpesa') batch.set(doc(db, `${ORG}/mpesaCodes/${data.mpesaCode}`), codeEntry(uid, giftId, data.amountCents as number));
  return batch.commit();
}

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
    await setDoc(doc(db, `${ORG}/funds/tithes`), { orgId: 'fcn', name: 'Tithes', aliases: ['Tithe'], active: true, ...stamps });
    await setDoc(doc(db, `${ORG}/funds/offerings`), { orgId: 'fcn', name: 'Offerings', aliases: [], active: true, ...stamps });
  });
});

describe('funds', () => {
  it('lets settings staff add a fund, and nobody else', async () => {
    const fund = { orgId: 'fcn', name: 'Building Fund', aliases: ['Building'], active: true, ...created('settingsAdmin') };
    await assertSucceeds(setDoc(doc(as('settingsAdmin'), `${ORG}/funds/building`), fund));
    await assertFails(setDoc(doc(as('admin'), `${ORG}/funds/missions`), { ...fund, name: 'Missions', ...created('admin') }));
    await assertFails(setDoc(doc(as('settingsAdmin'), `${ORG}/funds/Bad-Id`), fund));
  });

  it('lets staff who record gifts read the funds', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), `${ORG}/funds/tithes`)));
  });
});

describe('recording a gift', () => {
  it('saves an M-Pesa gift with its code entry', async () => {
    await assertSucceeds(record('admin', 'giftAAAAAAAA01'));
  });

  it('refuses the same M-Pesa code twice', async () => {
    await assertSucceeds(record('admin', 'giftAAAAAAAA01'));
    await assertFails(record('admin', 'giftAAAAAAAA02'));
    await assertFails(record('pastor', 'giftAAAAAAAA03'));
  });

  it('records the amount with the code, and it must match the gift', async () => {
    const db = as('admin');
    const batch = writeBatch(db);
    batch.set(doc(db, `${ORG}/gifts/giftAAAAAAAA01`), gift('admin'));
    batch.set(doc(db, `${ORG}/mpesaCodes/QJK1AAAA01`), codeEntry('admin', 'giftAAAAAAAA01', 1));
    await assertFails(batch.commit());
  });

  it('refuses an M-Pesa gift without its code entry', async () => {
    await assertFails(setDoc(doc(as('admin'), `${ORG}/gifts/giftAAAAAAAA01`), gift('admin')));
  });

  it('saves cash, bank and cheque gifts without a code', async () => {
    for (const [i, method] of ['cash', 'bank', 'cheque'].entries()) {
      await assertSucceeds(record('admin', `giftCASHAAAA0${i}`, { method, mpesaCode: null }));
    }
    await assertFails(record('admin', 'giftCASHAAAA09', { method: 'cash', mpesaCode: 'QJK1AAAA09' }));
  });

  it('rejects bad amounts, unknown funds and a receipt number from the device', async () => {
    await assertFails(record('admin', 'giftAAAAAAAA01', { amountCents: 0 }));
    await assertFails(record('admin', 'giftAAAAAAAA02', { amountCents: 100.5 }));
    await assertFails(record('admin', 'giftAAAAAAAA03', { fundId: 'missions' }));
    await assertFails(record('admin', 'giftAAAAAAAA04', { receiptNumber: 'FCN-2026-000001' }));
    await assertFails(record('admin', 'giftAAAAAAAA05', { status: 'void' }));
  });

  it('needs a giver and fund to confirm, and puts the rest in the Unassigned queue', async () => {
    await assertFails(record('admin', 'giftAAAAAAAA01', { fundId: null }));
    await assertSucceeds(record('admin', 'giftAAAAAAAA02', {
      mpesaCode: 'QJK1AAAA02', fundId: null, personId: null, status: 'unassigned', unassignedReason: 'both', handledBy: null,
    }));
  });

  it('records who received it as the person signed in', async () => {
    await assertFails(record('admin', 'giftAAAAAAAA01', { receivedBy: 'pastor' }));
  });

  it('keeps giving to its organization', async () => {
    const db = as('admin');
    await assertFails(setDoc(doc(db, 'organizations/adia/gifts/giftAAAAAAAA01'), gift('admin', { orgId: 'adia', method: 'cash', mpesaCode: null, personId: null, fundId: null, status: 'unassigned', handledBy: null })));
  });
});

describe('who sees giving', () => {
  beforeEach(async () => {
    await record('pastor', 'giftPASTOR0001', { mpesaCode: 'QJK1PPPP01' });
    await record('admin', 'giftADMIN00001');
    await record('admin', 'giftQUEUE00001', { mpesaCode: 'QJK1QQQQ01', personId: null, status: 'unassigned', unassignedReason: 'person', handledBy: null });
  });

  it('lets the pastor read every gift', async () => {
    await assertSucceeds(getDocs(collection(as('pastor'), `${ORG}/gifts`)));
  });

  it('lets other staff read only gifts they handled and the Unassigned queue', async () => {
    const db = as('admin');
    await assertSucceeds(getDoc(doc(db, `${ORG}/gifts/giftADMIN00001`)));
    await assertFails(getDoc(doc(db, `${ORG}/gifts/giftPASTOR0001`)));
    await assertFails(getDocs(collection(db, `${ORG}/gifts`)));
    await assertSucceeds(getDocs(query(collection(db, `${ORG}/gifts`), where('createdBy', '==', 'admin'))));
    await assertSucceeds(getDocs(query(collection(db, `${ORG}/gifts`), where('status', '==', 'unassigned'))));
  });

  it('keeps receipts and the ledger to the pastor and finance staff', async () => {
    await assertFails(getDoc(doc(as('admin'), `${ORG}/receipts/FCN-2026-000001`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${ORG}/receipts/FCN-2026-000001`)));
    await assertFails(getDoc(doc(as('admin'), `${ORG}/ledger/2026-10`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${ORG}/ledger/2026-10`)));
    await assertFails(getDoc(doc(as('pastor'), `${ORG}/counters/receipts-2026`)));
  });

  it('never lets the app write receipts, the ledger or the counter', async () => {
    const db = as('pastor');
    await assertFails(setDoc(doc(db, `${ORG}/receipts/FCN-2026-000001`), { number: 'FCN-2026-000001' }));
    await assertFails(setDoc(doc(db, `${ORG}/ledger/2026-10`), { totalCents: 1 }));
    await assertFails(setDoc(doc(db, `${ORG}/counters/receipts-2026`), { last: 0 }));
  });
});

describe('changing a gift', () => {
  const touch = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

  beforeEach(async () => {
    await record('admin', 'giftQUEUE00001', { mpesaCode: 'QJK1QQQQ01', personId: null, fundId: null, status: 'unassigned', unassignedReason: 'both', handledBy: null });
    await record('admin', 'giftADMIN00001');
  });

  it('lets staff assign a queued payment to a person and fund', async () => {
    await assertSucceeds(updateDoc(doc(as('settingsAdmin'), `${ORG}/gifts/giftQUEUE00001`), {
      personId: 'p1', fundId: 'tithes', status: 'confirmed', unassignedReason: null, handledBy: 'settingsAdmin', ...touch('settingsAdmin'),
    }));
  });

  it('refuses confirming in someone else\'s name', async () => {
    await assertFails(updateDoc(doc(as('admin'), `${ORG}/gifts/giftQUEUE00001`), {
      personId: 'p1', fundId: 'tithes', status: 'confirmed', unassignedReason: null, handledBy: 'pastor', ...touch('admin'),
    }));
  });

  it('never changes the amount, date, method or code', async () => {
    const ref = doc(as('pastor'), `${ORG}/gifts/giftADMIN00001`);
    await assertFails(updateDoc(ref, { amountCents: 200000, ...touch('pastor') }));
    await assertFails(updateDoc(ref, { date: '2026-10-17', ...touch('pastor') }));
    await assertFails(updateDoc(ref, { method: 'cash', mpesaCode: null, ...touch('pastor') }));
  });

  it('fixes the giver and fund once a receipt is numbered', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `${ORG}/gifts/giftADMIN00001`), { receiptNumber: 'FCN-2026-000001', receiptIssuedAt: old, updatedBy: 'system' });
    });
    const ref = doc(as('pastor'), `${ORG}/gifts/giftADMIN00001`);
    await assertFails(updateDoc(ref, { fundId: 'offerings', ...touch('pastor') }));
    await assertSucceeds(updateDoc(ref, { notes: 'Thanksgiving', ...touch('pastor') }));
    await assertFails(updateDoc(ref, { personId: null, ...touch('pastor') }));
  });

  it('lets a name-only gift be linked to its giver after the receipt', async () => {
    await record('admin', 'giftNAME000001', { mpesaCode: null, method: 'cash', personId: null });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `${ORG}/gifts/giftNAME000001`), { receiptNumber: 'FCN-2026-000002', receiptIssuedAt: old, updatedBy: 'system' });
    });
    const ref = doc(as('admin'), `${ORG}/gifts/giftNAME000001`);
    await assertFails(updateDoc(ref, { personId: 'p1', giverName: 'Someone else', ...touch('admin') }));
    await assertSucceeds(updateDoc(ref, { personId: 'p1', ...touch('admin') }));
  });

  it('voids with a reason, keeps the record, and allows no change after', async () => {
    const ref = doc(as('admin'), `${ORG}/gifts/giftADMIN00001`);
    await assertFails(updateDoc(ref, { status: 'void', voidReason: '', voidedAt: serverTimestamp(), ...touch('admin') }));
    await assertSucceeds(updateDoc(ref, { status: 'void', voidReason: 'Entered twice', voidedAt: serverTimestamp(), ...touch('admin') }));
    await assertFails(updateDoc(ref, { status: 'confirmed', ...touch('admin') }));
    await assertFails(deleteDoc(ref));
  });

  it('lets a voided M-Pesa payment be entered again', async () => {
    await updateDoc(doc(as('admin'), `${ORG}/gifts/giftADMIN00001`), { status: 'void', voidReason: 'Wrong fund', voidedAt: serverTimestamp(), ...touch('admin') });
    await assertSucceeds(record('admin', 'giftADMIN00002', { fundId: 'offerings' }));
  });

  it('does not let staff change gifts they cannot see', async () => {
    await record('pastor', 'giftPASTOR0001', { mpesaCode: 'QJK1PPPP01' });
    await assertFails(updateDoc(doc(as('admin'), `${ORG}/gifts/giftPASTOR0001`), { status: 'void', voidReason: 'Mistake', voidedAt: serverTimestamp(), ...touch('admin') }));
  });
});

describe('statement imports', () => {
  const line = (uid: string, overrides: Record<string, unknown> = {}) => ({ orgId: 'fcn', date: '2026-10-11', amountCents: 100000, importId: 'imp1', createdAt: serverTimestamp(), createdBy: uid, ...overrides });

  it('stores each statement line once, and the same line again changes nothing', async () => {
    const ref = doc(as('admin'), `${ORG}/statementLines/QJK1AAAA01`);
    await assertSucceeds(setDoc(ref, line('admin')));
    await assertFails(setDoc(ref, line('admin', { amountCents: 1 })));
  });

  it('records the import totals', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), `${ORG}/giftImports/imp1`), {
      orgId: 'fcn', fileName: 'statement.csv', firstDate: '2026-10-11', lastDate: '2026-10-12', statementTotalCents: 400000,
      paymentCount: 3, importedCount: 2, importedCents: 150000, duplicateCount: 1, duplicateCents: 250000, unassignedCount: 1, skippedCount: 2,
      ...created('admin'),
    }));
  });
});

describe('gifts the server refused', () => {
  const review = (uid: string, overrides: Record<string, unknown> = {}) => ({
    orgId: 'fcn', giftId: 'giftLOST000001', giverName: 'Grace Wanjiku', personId: 'p1', date: '2026-10-18', amountCents: 100000,
    fundId: 'tithes', method: 'mpesa', mpesaCode: 'QJK1AAAA01', notes: '', savedAt: '2026-10-18T07:00:00.000Z',
    reason: 'The same M-Pesa code was already recorded.', status: 'open', resolvedNote: '', ...created(uid), ...overrides,
  });

  it('keeps a refused gift for review, and lets staff mark it checked', async () => {
    const ref = doc(as('admin'), `${ORG}/giftReviews/giftLOST000001`);
    await assertSucceeds(setDoc(ref, review('admin')));
    await assertSucceeds(updateDoc(ref, { status: 'resolved', resolvedNote: 'Same as the imported payment', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(ref, { amountCents: 1, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('is only for gifts that never reached the server', async () => {
    await record('admin', 'giftLOST000001');
    await assertFails(setDoc(doc(as('admin'), `${ORG}/giftReviews/giftLOST000001`), review('admin')));
  });

  it('shows a staff member that their own missing gift was refused', async () => {
    await record('pastor', 'giftOTHER00001');
    await assertFails(getDoc(doc(as('admin'), `${ORG}/gifts/giftLOST000001`)));
  });
});
