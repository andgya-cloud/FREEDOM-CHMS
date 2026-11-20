import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { requireMember, verifyPin } from './pettyPins.js';
import { canAccessOrg } from './shared/permissions.js';
import { PETTY_CASH_ORG_TYPES } from './shared/pettyCash.js';
import { bankMoney, type BankStatement, type TypedBalance } from './shared/finance.js';
import { canTypeBankBalance, typesWithoutPin } from './shared/bankTyped.js';
import { readDay } from './shared/bankMatch.js';

const CALLABLE = { invoker: 'public', timeoutSeconds: 60 } as const;
const eatDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
const toMs = (t: unknown) => (t && typeof (t as { toMillis?: () => number }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null);

async function pettyOrg(orgId: string) {
  const org = (await db.doc(`organizations/${orgId}`).get()).data() as { type?: string } | undefined;
  if (!org || !(PETTY_CASH_ORG_TYPES as readonly string[]).includes(org.type ?? '')) throw new HttpsError('failed-precondition', 'This organization does not keep petty cash.');
}

/** The typed balances of an organization, oldest typed first. */
export async function typedBalances(orgId: string): Promise<TypedBalance[]> {
  const snap = await db.collection(`organizations/${orgId}/bankTyped`).get();
  return snap.docs.map((d) => d.data()).filter((d) => !d.deletedAt)
    .sort((a, b) => (toMs(a.at) ?? 0) - (toMs(b.at) ?? 0))
    .map((d) => ({ day: d.day as string, cents: d.cents as number, byName: d.byName as string }));
}

/**
 * Types the bank balance for a day (Andy, 2026-11-20, 1A 2A). Andrew and Doreen need no PIN; Elias and
 * Daniel type their own PIN. Money in the bank then counts it when it is as new as the statements (3A).
 */
export const typeBankBalance = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const day = typeof data.day === 'string' ? readDay(data.day) : null;
  const cents = typeof data.cents === 'number' && Number.isInteger(data.cents) && Math.abs(data.cents) <= 100_000_000_000 ? data.cents : null;
  if (!day || cents == null) throw new HttpsError('invalid-argument', 'Type the balance and its date.');
  if (day > eatDay(Date.now())) throw new HttpsError('invalid-argument', 'The date cannot be after today.');
  const profile: UserProfile = caller.profile;
  if (!profile.active || !canAccessOrg(profile, orgId)) throw new HttpsError('permission-denied', 'You do not have petty cash access here.');
  requireMember(profile, orgId);
  await pettyOrg(orgId);
  const name = profile.displayName || profile.email || '';
  if (!canTypeBankBalance(name)) throw new HttpsError('permission-denied', 'Only Andrew Guya, Doreen Mayaka, Elias Omondi or Daniel Ojwang\' can type the bank balance.');
  if (!typesWithoutPin(name)) await verifyPin(caller.uid, typeof data.pin === 'string' ? data.pin.trim() : '');
  await db.collection(`organizations/${orgId}/bankTyped`).add({ orgId, day, cents, by: caller.uid, byName: name, at: FieldValue.serverTimestamp() });
  await writeAudit({
    actorUid: caller.uid, actorEmail: profile.email, action: 'bank_balance_typed', path: `organizations/${orgId}/bankTyped`, collection: 'bankTyped', docId: day,
    orgId, note: `${name} typed the bank balance ${(cents / 100).toFixed(2)} for ${day}`,
  });
  return { name };
});

/**
 * What petty cash can still use, for anyone with petty cash access (Andy, 2026-11-20, 5A): requesters see it on
 * the New requisition form without seeing the bank statements themselves.
 */
export const pettyAvailable = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | null)?.orgId, 'the organization', { max: 80 });
  if (!caller.profile.active || !canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have petty cash access here.');
  requireMember(caller.profile, orgId);
  await pettyOrg(orgId);
  const [sts, spent, typed] = await Promise.all([
    db.collection(`organizations/${orgId}/bankStatements`).get(),
    db.collection(`organizations/${orgId}/pettyCash`).where('status', '==', 'approved').get(),
    typedBalances(orgId),
  ]);
  const live = <T>(q: FirebaseFirestore.QuerySnapshot) => q.docs.map((d) => d.data()).filter((d) => !d.deletedAt) as T[];
  const paid = live<{ pastRecord?: boolean; totalCents: number; approved?: { at?: unknown }; createdAt?: unknown }>(spent)
    .filter((x) => !x.pastRecord).map((x) => ({ day: eatDay(toMs(x.approved?.at) ?? toMs(x.createdAt) ?? Date.now()), cents: x.totalCents }));
  const m = bankMoney(live<BankStatement>(sts), paid, eatDay(Date.now()), typed);
  return { asOf: m.asOf, availableCents: m.availableCents };
});
