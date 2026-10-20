import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common.js';
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
    const sequence = ((counter.data()?.last as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { orgId, last: sequence, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM }, { merge: true });
    tx.update(reqRef, { number: pettyCashNumber((org.get('receiptPrefix') as string | undefined) ?? '', sequence), updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
  });
});
