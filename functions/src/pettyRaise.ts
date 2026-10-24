import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, requireMember, requireSelfOrKeeper, verifyPin } from './pettyPins.js';
import { canAccessOrg } from './shared/permissions.js';
import { itemsTotalCents, lineAmountCents, MAX_PETTY_CASH_ITEMS, pettyCashCategoriesFor, type PettyCashItem } from './shared/pettyCash.js';
import { requireMonthOpen } from './pettyMonths.js';
import { cleanMpesaCode, MPESA_CODE } from './shared/pettyCash.js';

/**
 * ADIA requester list (Andy, 2026-10-23): any of the stakeholders can raise a requisition on the shared
 * device by picking their name and typing their own PIN. The request is saved as theirs, so they cannot
 * sign it, and the person signed in on the device is kept as `raisedBy`.
 */
const CALLABLE = { invoker: 'public' } as const;

function readItems(value: unknown): PettyCashItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PETTY_CASH_ITEMS) throw new HttpsError('invalid-argument', 'Please check the items.');
  return value.map((v) => {
    const i = (v ?? {}) as Record<string, unknown>;
    const description = requireString(i.description, 'an item', { max: 200 });
    const quantity = i.quantity;
    const unitPriceCents = i.unitPriceCents;
    if (typeof quantity !== 'number' || !(quantity > 0) || quantity > 100000) throw new HttpsError('invalid-argument', 'Please check the quantities.');
    if (!Number.isInteger(unitPriceCents) || (unitPriceCents as number) <= 0) throw new HttpsError('invalid-argument', 'Please check the prices.');
    const amountCents = lineAmountCents(quantity, unitPriceCents as number);
    if (amountCents <= 0) throw new HttpsError('invalid-argument', 'Please check the prices.');
    return { description, quantity, unitPriceCents: unitPriceCents as number, amountCents };
  });
}

export const raisePettyRequest = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const requesterUid = requireString(data.requesterUid, 'the requester', { max: 128 });
  requireMember(caller.profile, orgId);
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (org?.type !== 'college') throw new HttpsError('failed-precondition', 'Raising a request for another stakeholder is only for ADIA.');

  const requester = (await db.doc(`users/${requesterUid}`).get()).data() as UserProfile | undefined;
  const mayRequest = !!requester?.active && canAccessOrg(requester, orgId)
    && (canSign(requester, orgId, 'request') || (requester.permissions ?? []).includes('pettycash.request'));
  if (!mayRequest) throw new HttpsError('permission-denied', 'That person cannot raise petty cash requests here.');
  await requireSelfOrKeeper(caller, requesterUid, orgId);
  await verifyPin(requesterUid, typeof data.pin === 'string' ? data.pin.trim() : '');

  const category = data.category as string;
  if (!(pettyCashCategoriesFor(org.type) as readonly string[]).includes(category)) throw new HttpsError('invalid-argument', 'Choose a category.');
  const note = typeof data.categoryNote === 'string' ? data.categoryNote.trim().slice(0, 120) : '';
  if (category === 'Other' && !note) throw new HttpsError('invalid-argument', 'Say what "Other" is for.');
  const month = typeof data.month === 'string' && /^\d{4}-\d{2}$/.test(data.month) ? data.month : null;
  if (!month) throw new HttpsError('invalid-argument', 'Please check the month.');
  const items = readItems(data.items);
  await requireMonthOpen(null, orgId, month);
  const payee = typeof data.payee === 'string' ? data.payee.trim().slice(0, 120) || null : null;
  const code = typeof data.mpesaCode === 'string' ? cleanMpesaCode(data.mpesaCode) : '';
  if (code && !MPESA_CODE.test(code)) throw new HttpsError('invalid-argument', 'An M-Pesa code has 10 letters and numbers, such as SJK4H2XQ7P.');

  const ref = db.collection(`organizations/${orgId}/pettyCash`).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    orgId, number: null, requesterId: requesterUid, requesterName: requester!.displayName || requester!.email,
    category, categoryNote: category === 'Other' ? note : null, items, totalCents: itemsTotalCents(items), month, payee, mpesaCode: code || null,
    status: 'submitted', checked: null, approved: null, rejection: null, signatures: {},
    raisedBy: caller.uid, raisedByName: caller.profile.displayName || caller.profile.email,
    deletedAt: null, deletedBy: null, createdAt: now, createdBy: requesterUid, updatedAt: now, updatedBy: requesterUid,
  });
  await writeAudit({
    actorUid: requesterUid, actorEmail: requester!.email, action: 'petty_request_raised_with_pin', path: ref.path, collection: 'pettyCash', docId: ref.id, orgId,
    note: `On ${caller.profile.displayName || caller.profile.email}'s device`,
  });
  return { id: ref.id, name: requester!.displayName || requester!.email };
});
