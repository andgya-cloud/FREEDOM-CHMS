import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, deleteDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const ORG = 'organizations/fcn';
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const due = Timestamp.fromDate(new Date('2026-10-18T20:59:00Z'));
const system = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'system', updatedAt: old, updatedBy: 'system' };

const task = (reason: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', personId: 'p1', personName: 'Grace Wanjiku', reason, templateId: 'visitor_welcome', status: 'open',
  assignedTo: null, assignedName: null, dueAt: due, outcome: null, note: '', doneAt: null, doneBy: null,
  lastMessageAt: null, absentSince: null, ...overrides,
});
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });
const message = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', personId: 'p1', toPersonId: 'p1', toName: 'Grace Wanjiku', viaGuardian: false, channel: 'whatsapp',
  templateId: 'visitor_welcome', templateName: 'First-time visitor welcome', followUpId: 'p1_first_visit', giftId: null,
  sensitive: false, senderName: uid, createdAt: serverTimestamp(), createdBy: uid, ...overrides,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${ORG}/followUps/p1_first_visit`), { ...task('first_visit'), ...system });
    await setDoc(doc(db, `${ORG}/followUps/p1_salvation`), { ...task('salvation', { templateId: 'salvation_followup' }), ...system });
    await setDoc(doc(db, 'staff/admin'), { displayName: 'Admin', active: true, allOrgs: false, orgIds: ['fcn'], followUps: true, pastoral: false });
    await setDoc(doc(db, 'staff/inactive'), { displayName: 'Gone', active: false, allOrgs: false, orgIds: ['fcn'], followUps: true, pastoral: false });
  });
});

describe('the Follow-ups queue', () => {
  it('shows staff the everyday tasks, and salvation tasks only to pastoral staff', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), `${ORG}/followUps/p1_first_visit`)));
    await assertFails(getDoc(doc(as('admin'), `${ORG}/followUps/p1_salvation`)));
    await assertSucceeds(getDoc(doc(as('pastor'), `${ORG}/followUps/p1_salvation`)));
  });

  it('lets staff list open tasks by leaving out the pastoral ones', async () => {
    const tasks = collection(as('admin'), `${ORG}/followUps`);
    await assertSucceeds(getDocs(query(tasks, where('status', '==', 'open'), where('reason', 'in', ['first_visit', 'checkin_48h', 'care_absent', 'other']))));
    await assertFails(getDocs(query(tasks, where('status', '==', 'open'))));
    await assertSucceeds(getDocs(query(collection(as('pastor'), `${ORG}/followUps`), where('status', '==', 'open'))));
  });

  it('keeps other campuses out', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/followUps/s1_first_visit'), { ...task('first_visit', { orgId: 'adia', personId: 's1' }), ...system });
    });
    await assertFails(getDoc(doc(as('admin'), 'organizations/adia/followUps/s1_first_visit')));
  });
});

describe('working a task', () => {
  const ref = (uid: string, id = 'p1_first_visit') => doc(as(uid), `${ORG}/followUps/${id}`);

  it('marks a task done with an outcome, recording who and when', async () => {
    await assertSucceeds(updateDoc(ref('admin'), { status: 'done', outcome: 'Reached', doneAt: serverTimestamp(), doneBy: 'admin', ...touched('admin') }));
  });

  it('refuses done without an outcome, or recorded as someone else', async () => {
    await assertFails(updateDoc(ref('admin'), { status: 'done', outcome: null, doneAt: serverTimestamp(), doneBy: 'admin', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { status: 'done', outcome: 'Made up', doneAt: serverTimestamp(), doneBy: 'admin', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { status: 'done', outcome: 'Reached', doneAt: serverTimestamp(), doneBy: 'pastor', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { status: 'done', outcome: 'Reached', doneAt: old, doneBy: 'admin', ...touched('admin') }));
  });

  it('can reopen a task, which clears the outcome', async () => {
    await assertSucceeds(updateDoc(ref('admin'), { status: 'done', outcome: 'No answer', doneAt: serverTimestamp(), doneBy: 'admin', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { status: 'open', ...touched('admin') }));
    await assertSucceeds(updateDoc(ref('admin'), { status: 'open', outcome: null, doneAt: null, doneBy: null, ...touched('admin') }));
  });

  it('assigns a task to active staff only', async () => {
    await assertSucceeds(updateDoc(ref('pastor'), { assignedTo: 'admin', assignedName: 'Admin', ...touched('pastor') }));
    await assertFails(updateDoc(ref('pastor'), { assignedTo: 'inactive', assignedName: 'Gone', ...touched('pastor') }));
    await assertFails(updateDoc(ref('pastor'), { assignedTo: 'nobody', assignedName: 'Nobody', ...touched('pastor') }));
  });

  it("doesn't let the reason, person or template change", async () => {
    await assertFails(updateDoc(ref('admin'), { reason: 'other', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { personId: 'p2', ...touched('admin') }));
    await assertFails(updateDoc(ref('admin'), { templateId: 'care_absent', ...touched('admin') }));
  });

  it('keeps salvation tasks to pastoral staff', async () => {
    await assertFails(updateDoc(ref('admin', 'p1_salvation'), { note: 'Called', ...touched('admin') }));
    await assertSucceeds(updateDoc(ref('pastor', 'p1_salvation'), { note: 'Called', ...touched('pastor') }));
  });

  it('needs the update stamped by the person making it', async () => {
    await assertFails(updateDoc(ref('admin'), { note: 'Called', updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
  });

  it('lets staff add their own follow-up, but not the automatic kinds', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), `${ORG}/followUps/manual1`), { ...task('other', { templateId: 'checkin_48h' }), ...created('admin') }));
    await assertFails(setDoc(doc(as('admin'), `${ORG}/followUps/manual2`), { ...task('salvation'), ...created('admin') }));
    await assertFails(setDoc(doc(as('admin'), `${ORG}/followUps/manual3`), { ...task('other', { personId: 'nobody' }), ...created('admin') }));
  });

  it('never deletes a task outright', async () => {
    await assertFails(deleteDoc(ref('pastor')));
  });
});

describe('the message log', () => {
  const add = (uid: string, id: string, overrides: Record<string, unknown> = {}) =>
    setDoc(doc(as(uid), `${ORG}/messages/${id}`), message(uid, overrides));

  it('records a message sent by staff', async () => {
    await assertSucceeds(add('admin', 'm1'));
  });

  it("can't be changed or removed", async () => {
    await assertSucceeds(add('admin', 'm1'));
    await assertFails(updateDoc(doc(as('admin'), `${ORG}/messages/m1`), { toName: 'Someone else' }));
    await assertFails(deleteDoc(doc(as('pastor'), `${ORG}/messages/m1`)));
  });

  it('must say who sent it and when', async () => {
    await assertFails(add('admin', 'm1', { createdBy: 'pastor' }));
    await assertFails(add('admin', 'm2', { createdAt: old }));
  });

  it('marks salvation and baptism messages pastoral, and keeps them from other staff', async () => {
    await assertFails(add('pastor', 'm1', { templateId: 'salvation_followup', sensitive: false }));
    await assertFails(add('admin', 'm2', { templateId: 'salvation_followup', sensitive: true }));
    await assertSucceeds(add('pastor', 'm3', { templateId: 'salvation_followup', sensitive: true }));
    await assertFails(getDoc(doc(as('admin'), `${ORG}/messages/m3`)));
    await assertSucceeds(getDocs(query(collection(as('admin'), `${ORG}/messages`), where('personId', '==', 'p1'), where('sensitive', '==', false))));
  });

  it('only goes to people in this organization', async () => {
    await assertFails(add('admin', 'm1', { toPersonId: 's1' }));
  });
});

describe('the staff directory', () => {
  it('can be read by any active staff member and written by nobody', async () => {
    await assertSucceeds(getDocs(collection(as('admin'), 'staff')));
    await assertFails(getDoc(doc(as('inactive'), 'staff/admin')));
    await assertFails(setDoc(doc(as('pastor'), 'staff/admin'), { displayName: 'Changed' }));
  });
});
