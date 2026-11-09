import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, directorSelf, requireMember, requireSelfOrKeeper, verifyPin } from './pettyPins.js';
import { requireMonthOpen } from './pettyMonths.js';
import { PETTY_CASH_ORG_TYPES, canTopUpAlone, type PettyCashItem } from './shared/pettyCash.js';
import { GROUP_DAYS_AFTER, GROUP_DAYS_BEFORE, MATCH_DAYS_AFTER, MATCH_DAYS_BEFORE, MAX_GROUP_LINES, MAX_MATCHES, closeEnough, daysBetween, readDay } from './shared/bankMatch.js';

/**
 * Confirms the matches between uploaded bank payments and requisitions without a payment code
 * (Andy, 2026-11-09, 2A 4A 5A). One of Andrew Guya, Doreen Mayaka or Elias Omondi confirms them all at
 * once with their PIN (Andy signed in as himself needs none). Each requisition gets the bank reference,
 * keeps the bank line as its receipt, and takes the amount the bank sent; the old amount is kept.
 */
const CALLABLE = { invoker: 'public', timeoutSeconds: 120 } as const;

export const matchBankPayments = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const signerUid = requireString(data.signerUid, 'the stakeholder', { max: 128 });
  const payee = typeof data.payee === 'string' ? data.payee.trim().slice(0, 120) : '';
  if (!Array.isArray(data.matches) || !data.matches.length || data.matches.length > MAX_MATCHES) throw new HttpsError('invalid-argument', 'There are no matches to confirm.');
  const readLine = (v: unknown) => {
    const x = (v ?? {}) as Record<string, unknown>;
    const day = typeof x.day === 'string' ? readDay(x.day) : null;
    const ref = typeof x.ref === 'string' ? x.ref.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 40) : '';
    const cents = typeof x.cents === 'number' && Number.isInteger(x.cents) && x.cents > 0 && x.cents <= 100_000_000_000 ? x.cents : 0;
    if (!day || !cents) throw new HttpsError('invalid-argument', 'One of the matches is not complete.');
    return { day, ref, cents };
  };
  const matches = data.matches.map((m) => {
    const x = (m ?? {}) as Record<string, unknown>;
    const reqId = typeof x.reqId === 'string' ? x.reqId : '';
    const lines = Array.isArray(x.lines) && x.lines.length ? x.lines.slice(0, MAX_GROUP_LINES + 1).map(readLine) : [readLine(x)];
    if (!reqId || reqId.includes('/') || lines.length > MAX_GROUP_LINES) throw new HttpsError('invalid-argument', 'One of the matches is not complete.');
    if (lines.length > 1 && lines.some((l) => l.day !== lines[0]!.day)) throw new HttpsError('invalid-argument', 'Lines matched together must be from one day.');
    const ref = [...new Set(lines.map((l) => l.ref).filter(Boolean))].join(' ').slice(0, 40);
    return { reqId, lines, day: lines[0]!.day, ref, cents: lines.reduce((n, l) => n + l.cents, 0) };
  });
  // A reference may repeat only on shares of one split transfer.
  const refs = matches.flatMap((m) => m.lines.filter((l) => l.ref).map((l) => `${l.ref}|${l.day}|${l.cents}`));
  if (new Set(matches.map((m) => m.reqId)).size !== matches.length || new Set(refs).size !== refs.length) {
    throw new HttpsError('invalid-argument', 'A payment or requisition appears twice.');
  }
  requireMember(caller.profile, orgId);
  const [signerSnap, orgSnap] = await Promise.all([db.doc(`users/${signerUid}`).get(), db.doc(`organizations/${orgId}`).get()]);
  const org = orgSnap.data() as { type?: string } | undefined;
  if (!org || !(PETTY_CASH_ORG_TYPES as readonly string[]).includes(org.type ?? '')) throw new HttpsError('failed-precondition', 'This organization does not keep petty cash.');
  const signer = signerSnap.data() as UserProfile | undefined;
  const name = signer ? signer.displayName || signer.email : '';
  if (!canSign(signer, orgId, 'fund') || !canTopUpAlone(org.type, name, (signer!.permissions ?? []).includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'Only Andrew Guya, Doreen Mayaka or Elias Omondi can confirm bank matches.');
  }
  await requireSelfOrKeeper(caller, signerUid, orgId);
  if (!directorSelf(caller.uid, signerUid, signer)) await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');

  const col = db.collection(`organizations/${orgId}/pettyCash`);
  const all = await col.get();
  const usedRefs = new Set(all.docs.filter((d) => !d.get('deletedAt')).flatMap((d) => [d.get('refNo'), d.get('bankProof')?.ref]).filter(Boolean).flatMap((r) => String(r).toUpperCase().split(' ')).filter(Boolean));
  const byId = new Map(all.docs.map((d) => [d.id, d]));
  const toMs = (t: unknown) => (t && typeof (t as { toMillis?: () => number }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null);
  const plan = matches.map((m) => {
    const d = byId.get(m.reqId);
    const r = d?.data();
    if (!d || !r || r.deletedAt || r.status !== 'approved') throw new HttpsError('failed-precondition', 'A requisition in the list is no longer approved. Upload the file again.');
    if (r.mpesaCode || r.refNo || r.bankProof) throw new HttpsError('failed-precondition', `${r.number ?? 'A requisition'} already has a payment code. Upload the file again.`);
    const taken = m.lines.length === 1 ? m.lines.find((l) => l.ref && usedRefs.has(l.ref)) : undefined;
    if (taken) throw new HttpsError('failed-precondition', `Bank reference ${taken.ref} is already on another requisition.`);
    const at = toMs(r.approved?.at) ?? toMs(r.createdAt);
    const reqDay = at == null ? m.day : new Date(at + 3 * 3_600_000).toISOString().slice(0, 10);
    const gap = daysBetween(reqDay, m.day);
    const fits = m.lines.length > 1
      ? gap >= -GROUP_DAYS_BEFORE && gap <= GROUP_DAYS_AFTER && m.cents === r.totalCents
      : gap >= -MATCH_DAYS_BEFORE && gap <= MATCH_DAYS_AFTER && closeEnough(m.cents, r.totalCents);
    if (!fits) throw new HttpsError('invalid-argument', `The payment for ${r.number ?? 'a requisition'} is too far from its date or amount.`);
    return { d, r, m };
  });
  for (const month of new Set(plan.map((p) => p.r.month as string))) await requireMonthOpen(null, orgId, month);

  let changed = 0;
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const { d, r, m } of plan.slice(i, i + 400)) {
      const items = r.items as PettyCashItem[];
      const update: Record<string, unknown> = {
        ...(m.ref ? { refNo: m.ref } : {}),
        bankProof: { day: m.day, ref: m.ref, cents: m.cents, ...(m.lines.length > 1 ? { lines: m.lines } : {}), ...(payee ? { payee } : {}), by: signerUid, byName: name, at: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid,
      };
      // 2A: what the bank sent is what was paid. A requisition with several items keeps its items.
      if (m.cents !== r.totalCents && items.length === 1) {
        update.items = [{ ...items[0]!, amountCents: m.cents, quantity: 1, unitPriceCents: m.cents }];
        update.totalCents = m.cents;
        update.originalCents = r.totalCents;
        changed++;
      }
      batch.update(d.ref, update);
    }
    await batch.commit();
  }
  await writeAudit({
    actorUid: signerUid, actorEmail: signer!.email, action: 'petty_bank_match', path: `organizations/${orgId}/pettyCash`, collection: 'pettyCash', docId: 'bank-match',
    orgId, note: `Matched ${plan.length} bank payments${payee ? ` to ${payee}` : ''} (${changed} amounts set to what the bank sent), on ${caller.profile.displayName || caller.email}'s device`,
  });
  return { matched: plan.length, changed };
});
