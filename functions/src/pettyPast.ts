import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, directorSelf, requireMember, requireSelfOrKeeper, verifyPin } from './pettyPins.js';
import { isDirector, personKey } from './pettyContacts.js';
import { requireMonthOpen } from './pettyMonths.js';
import { canAccessOrg, isPettyTitle } from './shared/permissions.js';
import { PETTY_CASH_ORG_TYPES, canTopUpAlone, itemsTotalCents, pettyCashCategoriesFor } from './shared/pettyCash.js';
import { nairobiMoment, readPastSheets, renumberShift, sequenceOf } from './shared/pettyPast.js';

/**
 * Adds past months of petty cash from the Excel sheet (Andy, 2026-11-08). Only those who may add money
 * (Andrew Guya, Doreen Mayaka, Elias Omondi), with their own PIN; Andy signed in as himself needs none.
 * Requisitions come in approved and marked pastRecord, with the approvers named on the sheet; money in
 * comes in as top-ups. Requisitions made in the app move up after the past numbers (Andy 5B). Uploading
 * the same sheet again adds nothing twice.
 */
const CALLABLE = { invoker: 'public', timeoutSeconds: 120 } as const;
type Cell = string | number | boolean | null;

function readRows(v: unknown, what: string): Cell[][] {
  if (!Array.isArray(v) || v.length > 5000) throw new HttpsError('invalid-argument', `Please check the ${what} sheet.`);
  return v.map((r) => (Array.isArray(r) ? r.slice(0, 30).map((c) => (typeof c === 'string' ? c.slice(0, 300) : typeof c === 'number' || typeof c === 'boolean' ? c : null)) : []));
}

export const importPastPetty = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const signerUid = requireString(data.signerUid, 'the stakeholder', { max: 128 });
  const dryRun = data.dryRun === true;
  requireMember(caller.profile, orgId);
  const [signerSnap, orgSnap] = await Promise.all([db.doc(`users/${signerUid}`).get(), db.doc(`organizations/${orgId}`).get()]);
  const org = orgSnap.data() as { type?: string; receiptPrefix?: string } | undefined;
  if (!org || !(PETTY_CASH_ORG_TYPES as readonly string[]).includes(org.type ?? '')) throw new HttpsError('failed-precondition', 'This organization does not keep petty cash.');
  const signer = signerSnap.data() as UserProfile | undefined;
  const name = signer ? signer.displayName || signer.email : '';
  if (!canSign(signer, orgId, 'fund') || !canTopUpAlone(org.type, name, (signer!.permissions ?? []).includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'Only Andrew Guya, Doreen Mayaka or Elias Omondi can add past months.');
  }
  await requireSelfOrKeeper(caller, signerUid, orgId);
  if (!dryRun && !directorSelf(caller.uid, signerUid, signer)) await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');

  const prefix = org.receiptPrefix || 'PC';
  const sheet = readPastSheets(readRows(data.upload, 'Upload'), readRows(data.money ?? [], 'Money in'), pettyCashCategoriesFor(org.type), prefix);
  if (sheet.problems.length) throw new HttpsError('invalid-argument', `Please fix the sheet first: ${sheet.problems.slice(0, 5).join(' ')}${sheet.problems.length > 5 ? ` (and ${sheet.problems.length - 5} more)` : ''}`);
  if (!sheet.requisitions.length && !sheet.moneyIn.length) throw new HttpsError('invalid-argument', 'The sheet has no requisitions or money in.');
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  if ([...sheet.requisitions, ...sheet.moneyIn].some((x) => x.date > today)) throw new HttpsError('invalid-argument', 'Past records cannot have a date after today.');
  for (const month of new Set(sheet.requisitions.map((r) => r.date.slice(0, 7)))) await requireMonthOpen(null, orgId, month);

  // The people named on the sheet, matched to their accounts here when they have one.
  const people = new Map<string, { uid: string; name: string; title: string; director: boolean }>();
  for (const d of (await db.collection('users').get()).docs) {
    const u = d.data() as UserProfile;
    if (!canAccessOrg(u, orgId)) continue;
    const key = personKey(u.displayName ?? '');
    if (key && !people.has(key)) people.set(key, { uid: d.id, name: u.displayName ?? '', title: isPettyTitle(u.pettyTitle) ? u.pettyTitle! : '', director: isDirector(u) });
  }
  const who = (n: string) => people.get(personKey(n)) ?? { uid: `past-${personKey(n)}`, name: n, title: '', director: personKey(n) === 'andrewguya' };

  const all = await db.collection(`organizations/${orgId}/pettyCash`).get();
  const existingPast = new Set(all.docs.filter((d) => d.get('pastRecord')).map((d) => d.get('number') as string));
  const fresh = sheet.requisitions.filter((r) => !existingPast.has(r.number));
  const live = all.docs.filter((d) => !d.get('pastRecord') && d.get('number'));
  const shift = renumberShift([...existingPast, ...fresh.map((r) => r.number)], live.map((d) => d.get('number') as string));
  const funds = db.collection(`organizations/${orgId}/pettyFunds`);
  const fundIds = sheet.moneyIn.map((m, k) => `past-${m.date}-${m.amountCents}-${k}`);
  const fundExists = await Promise.all(fundIds.map((id) => funds.doc(id).get().then((s) => s.exists)));
  const freshMoney = sheet.moneyIn.filter((_, k) => !fundExists[k]);
  const summary = {
    added: fresh.length, skipped: sheet.requisitions.length - fresh.length,
    spentCents: fresh.reduce((n, r) => n + itemsTotalCents(r.items), 0),
    moneyAdded: freshMoney.length, moneyInCents: freshMoney.reduce((n, m) => n + m.amountCents, 0),
    renumbered: shift ? live.length : 0, shift,
    firstAppNumber: shift && live.length ? `${prefix}-${String(Math.min(...live.map((d) => sequenceOf(d.get('number')))) + shift).padStart(5, '0')}` : null,
  };
  if (dryRun) return summary;

  const writes: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
  const stamp = { importedBy: signerUid, importedByName: name, importedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid };
  for (const r of fresh) {
    const at = Timestamp.fromMillis(nairobiMoment(r.date, 13));
    const requester = who(r.requesterName);
    const [a, b] = r.approvers.map(who) as [ReturnType<typeof who>, ReturnType<typeof who>];
    const sig = (p: typeof a) => ({ name: p.name, role: p.title, at, ...(p.director ? { director: true } : {}) });
    writes.push((batch) => batch.set(db.doc(`organizations/${orgId}/pettyCash/past-${r.number}`), {
      orgId, number: r.number, requesterId: requester.uid, requesterName: requester.name, category: r.category, categoryNote: r.categoryNote,
      items: r.items, totalCents: itemsTotalCents(r.items), month: r.date.slice(0, 7), status: 'approved', checked: null,
      approved: { uid: b.uid, name: b.name, role: b.title, at }, rejection: null, signatures: { [a.uid]: sig(a), [b.uid]: sig(b) },
      payee: r.payee, mpesaCode: r.mpesaCode, refNo: r.refNo, pastRecord: true, ...(requester.director ? { byDirector: true } : {}),
      deletedAt: null, deletedBy: null, createdAt: at, createdBy: requester.uid, ...stamp,
    }));
  }
  if (shift) {
    for (const d of live) writes.push((batch) => batch.update(d.ref, { number: `${prefix}-${String(sequenceOf(d.get('number')) + shift).padStart(5, '0')}`, renumberedFrom: d.get('number'), updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid }));
  }
  sheet.moneyIn.forEach((m, k) => {
    if (fundExists[k]) return;
    const at = Timestamp.fromMillis(nairobiMoment(m.date, 8));
    writes.push((batch) => batch.set(funds.doc(fundIds[k]!), {
      orgId, kind: 'topup', amountCents: m.amountCents, status: 'done', doneAt: at, note: m.note ?? 'Past record', pastRecord: true,
      signatures: { [signerUid]: { name, at } }, deletedAt: null, deletedBy: null, createdAt: at, createdBy: signerUid, ...stamp,
    }));
  });
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
  // The next requisition made in the app follows every number in use.
  const counter = db.doc(`organizations/${orgId}/counters/pettyCash`);
  await db.runTransaction(async (tx) => {
    const last = ((await tx.get(counter)).get('last') as number | undefined) ?? 0;
    const maxPast = Math.max(0, ...[...existingPast, ...fresh.map((r) => r.number)].map(sequenceOf));
    tx.set(counter, { orgId, last: Math.max(last + shift, maxPast), updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid }, { merge: true });
  });
  await writeAudit({
    actorUid: signerUid, actorEmail: signer!.email, action: 'petty_past_import', path: `organizations/${orgId}/pettyCash`, collection: 'pettyCash', docId: 'past',
    orgId, note: `Added ${summary.added} past requisitions and ${summary.moneyAdded} money-in records${shift ? `; app requisitions moved up by ${shift}` : ''}, on ${caller.profile.displayName || caller.email}'s device`,
  });
  return summary;
});
