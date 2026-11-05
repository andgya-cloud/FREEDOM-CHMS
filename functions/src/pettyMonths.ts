import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, requireMember, requireSelfOrKeeper, verifyPin } from './pettyPins.js';
import { isDirector } from './pettyContacts.js';
import { isPettyTitle } from './shared/permissions.js';
import { MONTH_CLOSE_SIGNATURES, type PettyMonth } from './shared/pettyCash.js';
import { todayIn } from './reports.js';

/**
 * Month-end close (Andy, 2026-10-24): any two stakeholders close a month that has ended; after that no
 * request, signature, receipt or deletion in it can change. Only the Director reopens it, with a reason.
 * Records: organizations/{org}/pettyMonths/{YYYY-MM}, written here only.
 */
const CALLABLE = { invoker: 'public' } as const;
const monthRef = (orgId: string, month: string) => db.doc(`organizations/${orgId}/pettyMonths/${month}`);
const readMonth = (v: unknown) => {
  const month = typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
  if (!month) throw new HttpsError('invalid-argument', 'Please check the month.');
  return month;
};
const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Refuses a change that belongs to a closed month. Pass the transaction when inside one. */
export async function requireMonthOpen(tx: FirebaseFirestore.Transaction | null, orgId: string, month: unknown) {
  if (typeof month !== 'string' || !month) return;
  const ref = monthRef(orgId, month);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (snap.get('status') === 'closed') {
    throw new HttpsError('failed-precondition', `${monthName(month)} is closed, so nothing in it can change. Only the Director can reopen it.`);
  }
}

export const closePettyMonth = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const month = readMonth(data.month);
  const signerUid = requireString(data.signerUid, 'the stakeholder', { max: 128 });
  requireMember(caller.profile, orgId);
  const signer = (await db.doc(`users/${signerUid}`).get()).data() as UserProfile | undefined;
  if (!canSign(signer, orgId, 'request')) throw new HttpsError('permission-denied', 'That person cannot close the month.');
  const proxy = await requireSelfOrKeeper(caller, signerUid, orgId);
  await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');
  if (month >= todayIn('Africa/Nairobi', new Date()).slice(0, 7)) throw new HttpsError('failed-precondition', 'A month can be closed only after it has ended.');
  const waiting = (await db.collection(`organizations/${orgId}/pettyCash`).where('month', '==', month).get()).docs
    .filter((d) => !d.get('deletedAt') && ['submitted', 'checked'].includes(d.get('status')));
  if (waiting.length) {
    throw new HttpsError('failed-precondition', `${waiting.length} request${waiting.length === 1 ? ' is' : 's are'} still waiting for signatures (${waiting.map((d) => d.get('number') ?? 'new').slice(0, 5).join(', ')}). Approve or reject ${waiting.length === 1 ? 'it' : 'them'} first.`);
  }
  const name = signer!.displayName || signer!.email;
  const role = isPettyTitle(signer!.pettyTitle) ? signer!.pettyTitle! : 'Stakeholder';
  const ref = monthRef(orgId, month);
  const status = await db.runTransaction(async (tx) => {
    const m = (await tx.get(ref)).data() as PettyMonth | undefined;
    if (m?.status === 'closed') throw new HttpsError('failed-precondition', `${monthName(month)} is already closed.`);
    const sigs = m?.status === 'closing' ? m.signatures ?? {} : {};
    if (signerUid in sigs) throw new HttpsError('already-exists', `${name} has already signed.`);
    const done = Object.keys(sigs).length + 1 >= MONTH_CLOSE_SIGNATURES;
    const entry = { action: done ? 'closed' : 'started', name, at: new Date().toISOString(), reason: null };
    tx.set(ref, {
      orgId, month, status: done ? 'closed' : 'closing',
      signatures: { ...sigs, [signerUid]: { name, role, at: FieldValue.serverTimestamp(), ...proxy } },
      closedAt: done ? FieldValue.serverTimestamp() : null,
      history: [...(m?.history ?? []), entry],
      updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid,
    });
    return done ? 'closed' : 'closing';
  });
  await writeAudit({ actorUid: signerUid, actorEmail: signer!.email, action: `petty_month_${status}`, path: ref.path, collection: 'pettyMonths', docId: month, orgId, note: `On ${caller.profile.displayName || caller.email}'s device` });
  return { status, name };
});

export const reopenPettyMonth = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const month = readMonth(data.month);
  const reason = requireString(data.reason, 'the reason', { max: 300 });
  requireMember(caller.profile, orgId);
  if (!isDirector(caller.profile)) throw new HttpsError('permission-denied', 'Only the Director can reopen a closed month.');
  const ref = monthRef(orgId, month);
  const name = caller.profile.displayName || caller.email;
  await db.runTransaction(async (tx) => {
    const m = (await tx.get(ref)).data() as PettyMonth | undefined;
    if (!m || m.status === 'open') throw new HttpsError('failed-precondition', `${monthName(month)} is not closed.`);
    tx.update(ref, {
      status: 'open', signatures: {}, closedAt: null,
      history: [...(m.history ?? []), { action: m.status === 'closed' ? 'reopened' : 'cancelled', name, at: new Date().toISOString(), reason }],
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
  });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'petty_month_reopened', path: ref.path, collection: 'pettyMonths', docId: month, orgId, note: reason });
  return { ok: true };
});
