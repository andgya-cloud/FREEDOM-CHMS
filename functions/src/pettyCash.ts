import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db, type UserProfile } from './common.js';
import { isDirector } from './pettyContacts.js';
import { pettyCashNumber } from './shared/pettyCash.js';

const SYSTEM = 'system';

/**
 * A new petty cash requisition gets the next number (ADIA-00015) once, in a transaction, so numbers are
 * sequential and never reused. Requests made offline are numbered when they reach the server.
 */
export const onPettyCashCreated = onDocumentCreated('organizations/{orgId}/pettyCash/{reqId}', async (event) => {
  const { orgId, reqId } = event.params;
  const reqRef = db.doc(`organizations/${orgId}/pettyCash/${reqId}`);
  const counterRef = db.doc(`organizations/${orgId}/counters/pettyCash`);
  const orgRef = db.doc(`organizations/${orgId}`);
  await db.runTransaction(async (tx) => {
    const [req, counter, org] = await Promise.all([tx.get(reqRef), tx.get(counterRef), tx.get(orgRef)]);
    if (!req.exists || req.get('number')) return;
    // The Director's own requests need no extra signature above the spending limit (Andy, 2026-10-24).
    const requester = (await tx.get(db.doc(`users/${req.get('requesterId')}`))).data() as UserProfile | undefined;
    const sequence = ((counter.data()?.last as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { orgId, last: sequence, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM }, { merge: true });
    tx.update(reqRef, { number: pettyCashNumber((org.get('receiptPrefix') as string | undefined) ?? '', sequence), ...(isDirector(requester) ? { byDirector: true } : {}), updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
  });
});
