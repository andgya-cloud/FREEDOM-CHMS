import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const O = 'organizations/hope';
const ADMIN_PERMS = ['people.read', 'people.write', 'followups.manage'];
const WA = { enabled: true, phoneNumberId: '1234567890', modes: { visitor_welcome: 'approve', child_absent: 'auto' }, metaNames: {}, language: 'en' };

const outbox = (over: Record<string, unknown> = {}) => ({
  orgId: 'hope', followUpId: 'f1', templateId: 'child_absent', personId: 'c1', personName: 'Baraka', toPersonId: 'g1', toName: 'Mary',
  viaGuardian: true, params: ['Mary'], preview: 'Hello Mary', mode: 'approve', status: 'pending_approval', approvedBy: null, approvedByName: null,
  createdAt: old, createdBy: 'system', updatedAt: old, updatedBy: 'system', ...over,
});
const approve = (uid: string) => ({ status: 'queued', approvedBy: uid, approvedByName: 'Grace', updatedAt: serverTimestamp(), updatedBy: uid });

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/hopeAdmin'), { email: 'x@example.org', displayName: 'x', roleId: 'admin', extraPermissions: [], orgIds: ['hope'], allOrgs: false, permissions: ADMIN_PERMS, active: true });
    await setDoc(doc(db, 'users/noFollow'), { email: 'y@example.org', displayName: 'y', roleId: 'admin', extraPermissions: [], orgIds: ['hope'], allOrgs: false, permissions: ['people.read'], active: true });
    await setDoc(doc(db, 'organizations/hope'), { name: 'Freedom Hope Center', type: 'ministry', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FHC', active: true, deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' });
    await setDoc(doc(db, `${O}/whatsappOutbox/f1`), outbox());
  });
});

const stampedSettings = (uid: string, over: Record<string, unknown> = {}) => ({ ...WA, ...over, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });

describe('WhatsApp outbox', () => {
  it('staff who manage follow-ups can read it, others cannot', async () => {
    await assertSucceeds(getDoc(doc(as('hopeAdmin'), `${O}/whatsappOutbox/f1`)));
    await assertFails(getDoc(doc(as('noFollow'), `${O}/whatsappOutbox/f1`)));
  });

  it('nobody creates or deletes outbox messages from the app', async () => {
    await assertFails(setDoc(doc(as('hopeAdmin'), `${O}/whatsappOutbox/f2`), outbox()));
    await assertFails(setDoc(doc(as('pastor'), `${O}/whatsappOutbox/f2`), outbox()));
    await assertFails(deleteDoc(doc(as('pastor'), `${O}/whatsappOutbox/f1`)));
  });

  it('an admin can approve a waiting message', async () => {
    await assertSucceeds(updateDoc(doc(as('hopeAdmin'), `${O}/whatsappOutbox/f1`), approve('hopeAdmin')));
  });

  it('an admin can cancel a waiting message', async () => {
    await assertSucceeds(updateDoc(doc(as('hopeAdmin'), `${O}/whatsappOutbox/f1`), { status: 'cancelled', updatedAt: serverTimestamp(), updatedBy: 'hopeAdmin' }));
  });

  it('approval cannot change the text, the recipient or the status to sent', async () => {
    const ref = doc(as('hopeAdmin'), `${O}/whatsappOutbox/f1`);
    await assertFails(updateDoc(ref, { ...approve('hopeAdmin'), preview: 'Something else' }));
    await assertFails(updateDoc(ref, { ...approve('hopeAdmin'), toPersonId: 'x' }));
    await assertFails(updateDoc(ref, { ...approve('hopeAdmin'), status: 'sent' }));
    await assertFails(updateDoc(ref, { ...approve('hopeAdmin'), approvedBy: 'someoneElse' }));
  });

  it('a message that is no longer waiting cannot be changed', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `${O}/whatsappOutbox/f1`), { status: 'sent' }));
    await assertFails(updateDoc(doc(as('hopeAdmin'), `${O}/whatsappOutbox/f1`), { status: 'cancelled', updatedAt: serverTimestamp(), updatedBy: 'hopeAdmin' }));
  });

  it('staff without follow-up access cannot approve', async () => {
    await assertFails(updateDoc(doc(as('noFollow'), `${O}/whatsappOutbox/f1`), approve('noFollow')));
  });

  it('the server-only lookups are closed to every signed-in user', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'waMessages/wamid.1'), { orgId: 'hope', outboxId: 'f1' }));
    await assertFails(getDoc(doc(as('pastor'), 'waMessages/wamid.1')));
    await assertFails(setDoc(doc(as('pastor'), 'waRecipients/254700000000'), { orgId: 'hope', personId: 'g1' }));
  });
});

describe('settings/whatsapp', () => {
  it('the pastor saves them; an admin cannot', async () => {
    await assertSucceeds(setDoc(doc(as('pastor'), 'settings/whatsapp'), stampedSettings('pastor')));
    await assertFails(setDoc(doc(as('hopeAdmin'), 'settings/whatsapp'), stampedSettings('hopeAdmin')));
  });

  it('only known message types can have a mode', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'settings/whatsapp'), stampedSettings('pastor', { modes: { salvation_followup: 'auto' } })));
  });

  it('needs a true/false switch and a sensible number id', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'settings/whatsapp'), stampedSettings('pastor', { enabled: 'yes' })));
    await assertFails(setDoc(doc(as('pastor'), 'settings/whatsapp'), stampedSettings('pastor', { phoneNumberId: 'x'.repeat(40) })));
  });
});
