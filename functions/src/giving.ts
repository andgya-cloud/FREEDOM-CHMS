import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { formatReceiptNumber, ledgerChanges, type GiftForLedger } from './shared/giving.js';

const SYSTEM = 'system';

function yearIn(timeZone: string, at = new Date()): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(at));
  } catch {
    return at.getUTCFullYear();
  }
}

/**
 * Runs for every gift, whichever device saved it and however late it synced:
 * - a confirmed gift gets the next receipt number for its organization, once,
 *   in a transaction, so numbers are sequential and never reused;
 * - voiding a gift marks its receipt void (the receipt stays on record);
 * - the monthly fund ledger is adjusted, so financial reports never need to
 *   read individual gifts.
 */
export const onGiftWritten = onDocumentWritten('organizations/{orgId}/gifts/{giftId}', async (event) => {
  const { orgId, giftId } = event.params;
  const before = event.data?.before.exists ? (event.data.before.data() as DocumentData) : undefined;
  const after = event.data?.after.exists ? (event.data.after.data() as DocumentData) : undefined;

  const b = before as GiftForLedger | undefined;
  const a = after as GiftForLedger | undefined;
  const confirmed = ledgerChanges(b, a);
  const queued = ledgerChanges(b, a, 'unassigned');
  if (confirmed.length || queued.length) {
    const total = (cents: number, count: number) => ({ cents: FieldValue.increment(cents), count: FieldValue.increment(count) });
    // Triggers can run twice for one change; the event id makes sure the
    // ledger is adjusted only once.
    const seen = db.doc(`organizations/${orgId}/ledgerEvents/${event.id}`);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(seen)).exists) return;
      tx.set(seen, { giftId, at: FieldValue.serverTimestamp() });
      for (const c of confirmed) {
        tx.set(db.doc(`organizations/${orgId}/ledger/${c.month}`), {
          orgId,
          month: c.month,
          totalCents: FieldValue.increment(c.cents),
          count: FieldValue.increment(c.count),
          funds: { [c.fund]: total(c.cents, c.count) },
          methods: { [c.method]: total(c.cents, c.count) },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      for (const c of queued) {
        tx.set(db.doc(`organizations/${orgId}/ledger/${c.month}`), {
          orgId,
          month: c.month,
          unassigned: { methods: { [c.method]: total(c.cents, c.count) } },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
  }

  if (after && after.status === 'confirmed' && !after.receiptNumber) await issueReceipt(orgId, giftId);

  if (after && after.status === 'void' && before?.status !== 'void' && after.receiptNumber) {
    await db.doc(`organizations/${orgId}/receipts/${after.receiptNumber}`).set({
      void: true,
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: after.updatedBy ?? null,
      voidReason: after.voidReason ?? '',
    }, { merge: true });
  }
});

async function issueReceipt(orgId: string, giftId: string) {
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (!org) return;
  const prefix = (org.receiptPrefix as string) || 'RCT';
  const year = yearIn((org.timeZone as string) || 'Africa/Nairobi');
  const giftRef = db.doc(`organizations/${orgId}/gifts/${giftId}`);
  const counterRef = db.doc(`organizations/${orgId}/counters/receipts-${year}`);

  await db.runTransaction(async (tx) => {
    const [giftSnap, counterSnap] = await Promise.all([tx.get(giftRef), tx.get(counterRef)]);
    const gift = giftSnap.data();
    // Another run of this trigger may have numbered it already.
    if (!gift || gift.status !== 'confirmed' || gift.receiptNumber) return;
    const sequence = ((counterSnap.data()?.last as number | undefined) ?? 0) + 1;
    const number = formatReceiptNumber(prefix, year, sequence);
    tx.set(counterRef, { orgId, year, last: sequence, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.doc(`organizations/${orgId}/receipts/${number}`), {
      orgId,
      number,
      giftId,
      year,
      sequence,
      personId: gift.personId ?? null,
      amountCents: gift.amountCents,
      issuedBy: gift.handledBy ?? gift.createdBy ?? null,
      issuedAt: FieldValue.serverTimestamp(),
      void: false,
    });
    tx.update(giftRef, {
      receiptNumber: number,
      receiptIssuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM,
    });
  });
}
