import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg, isPettyTitle } from './shared/permissions.js';
import { canTopUpAlone, checkPin, fundStatusAfter, parseAmountCents, PIN_LOCK_MINUTES, PIN_MAX_TRIES, REQUEST_SIGNATURES_NEEDED, waitingForAccountant, type PettyCashSignature } from './shared/pettyCash.js';
import { ACCOUNTANT_TITLE } from './shared/permissions.js';

/**
 * Petty cash signing PINs (Andy, 2026-10-23): a stakeholder picks their name on the shared device and
 * types their own PIN instead of an email and password. Each person sets their PIN once, signed in as
 * themselves. Only a salted scrypt hash is kept, in pettyPins/{uid}, which no app user can read, and
 * five wrong tries lock that person's PIN for 15 minutes.
 */
const CALLABLE = { invoker: 'public' } as const;
const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

async function hashPin(pin: string, salt: Buffer) {
  return scrypt(pin, salt, 32);
}

/** Who may sign in this organization: requests need check/approve/authorize, top-ups and resets authorize. */
export function canSign(profile: UserProfile | undefined, orgId: string, kind: 'request' | 'fund') {
  if (!profile?.active || !canAccessOrg(profile, orgId)) return false;
  const p = profile.permissions ?? [];
  if (p.includes('users.manage')) return true;
  return kind === 'fund' ? p.includes('pettycash.authorize') : p.some((x) => ['pettycash.check', 'pettycash.approve', 'pettycash.authorize'].includes(x));
}

export function requireMember(profile: UserProfile, orgId: string) {
  if (!canSign(profile, orgId, 'request') && !(profile.permissions ?? []).includes('pettycash.request')) {
    throw new HttpsError('permission-denied', 'You do not have petty cash access here.');
  }
}

/** Sets or changes the caller's own signing PIN. */
export const setPettyPin = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const pin = checkPin((request.data as Record<string, unknown> | null)?.pin);
  if (!pin) throw new HttpsError('invalid-argument', 'A PIN is 4 to 6 digits, and not all the same digit.');
  const salt = randomBytes(16);
  await db.doc(`pettyPins/${caller.uid}`).set({
    salt: salt.toString('base64'), hash: (await hashPin(pin, salt)).toString('base64'),
    failed: 0, lockedUntil: null, setAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'petty_pin_set', path: `pettyPins/${caller.uid}`, collection: 'pettyPins', docId: caller.uid, orgId: null });
  return { ok: true };
});

/** The people who can sign in this organization, for the name list on the signing box. */
export const listPettySigners = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | null)?.orgId, 'the organization', { max: 80 });
  requireMember(caller.profile, orgId);
  const [users, org] = await Promise.all([db.collection('users').where('active', '==', true).get(), db.doc(`organizations/${orgId}`).get()]);
  const orgType = (org.data() as { type?: string } | undefined)?.type;
  const people = users.docs
    .filter((d) => canSign(d.data() as UserProfile, orgId, 'request'))
    .map((d) => {
      const u = d.data() as UserProfile;
      const name = u.displayName || u.email;
      const canAuthorize = canSign(u, orgId, 'fund');
      return { uid: d.id, name, title: u.pettyTitle ?? '', email: u.email, canAuthorize, canTopUp: canAuthorize && canTopUpAlone(orgType, name, (u.permissions ?? []).includes('users.manage')) };
    });
  const pins = people.length ? await db.getAll(...people.map((p) => db.doc(`pettyPins/${p.uid}`))) : [];
  return {
    signers: people.map((p, i) => ({ ...p, hasPin: pins[i].exists })).sort((a, b) => a.name.localeCompare(b.name)),
  };
});

/** Checks a signer's PIN, counting wrong tries and locking after too many. */
export async function verifyPin(uid: string, pin: string) {
  const ref = db.doc(`pettyPins/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'This person has not set a PIN yet.');
  const d = snap.data() as { salt: string; hash: string; failed?: number; lockedUntil?: FirebaseFirestore.Timestamp | null };
  if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) {
    throw new HttpsError('resource-exhausted', `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes, or set a new PIN with your password.`);
  }
  const ok = timingSafeEqual(await hashPin(pin, Buffer.from(d.salt, 'base64')), Buffer.from(d.hash, 'base64'));
  if (!ok) {
    const failed = (d.failed ?? 0) + 1;
    const lock = failed >= PIN_MAX_TRIES;
    await ref.update({ failed: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null });
    throw new HttpsError('permission-denied', lock ? `Wrong PIN. That PIN is now locked for ${PIN_LOCK_MINUTES} minutes.` : `Wrong PIN. ${PIN_MAX_TRIES - failed} tries left.`);
  }
  if (d.failed || d.lockedUntil) await ref.update({ failed: 0, lockedUntil: null });
}

/** Signs a waiting request, top-up or reset as the chosen stakeholder, after checking their PIN. */
export const signWithPin = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const docId = requireString(data.docId, 'the record', { max: 80 });
  const signerUid = requireString(data.signerUid, 'the stakeholder', { max: 128 });
  const kind = data.kind === 'fund' ? 'fund' : data.kind === 'request' ? 'request' : null;
  if (!kind) throw new HttpsError('invalid-argument', 'Please check the record.');
  const pin = typeof data.pin === 'string' ? data.pin.trim() : '';
  requireMember(caller.profile, orgId);
  const signer = (await db.doc(`users/${signerUid}`).get()).data() as UserProfile | undefined;
  if (!canSign(signer, orgId, kind)) throw new HttpsError('permission-denied', 'That person cannot sign this.');
  await verifyPin(signerUid, pin);
  const name = signer!.displayName || signer!.email;
  const ref = db.doc(`organizations/${orgId}/${kind === 'fund' ? 'pettyFunds' : 'pettyCash'}/${docId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data();
    if (!r || r.deletedAt) throw new HttpsError('not-found', 'This record is no longer there.');
    const sigs = (r.signatures ?? null) as Record<string, PettyCashSignature> | null;
    if (!sigs) throw new HttpsError('failed-precondition', 'This record is not signed this way.');
    if (signerUid in sigs) throw new HttpsError('already-exists', `${name} has already signed.`);
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid };
    if (kind === 'fund') {
      if (r.status !== 'collecting') throw new HttpsError('failed-precondition', 'This is no longer waiting for signatures.');
      const status = fundStatusAfter(Object.keys(sigs).length + 1, r.kind === 'topup' ? 'topup' : 'reset');
      tx.update(ref, { [`signatures.${signerUid}`]: { name, at: FieldValue.serverTimestamp() }, status, ...(status === 'done' ? { doneAt: FieldValue.serverTimestamp() } : {}), ...stamp });
      return;
    }
    if (r.status !== 'submitted') throw new HttpsError('failed-precondition', 'This request is no longer waiting for signatures.');
    if (r.requesterId === signerUid) throw new HttpsError('permission-denied', 'Nobody can sign their own request.');
    const title = isPettyTitle(signer!.pettyTitle) ? signer!.pettyTitle! : '';
    if (waitingForAccountant({ status: 'submitted', signatures: sigs }) && title !== ACCOUNTANT_TITLE) {
      throw new HttpsError('failed-precondition', 'The last signature must be the accountant\'s.');
    }
    const role = title || ((signer!.permissions ?? []).includes('users.manage') ? 'Pastor' : 'Stakeholder');
    const approved = Object.keys(sigs).length + 1 >= REQUEST_SIGNATURES_NEEDED;
    tx.update(ref, {
      [`signatures.${signerUid}`]: { name, role, at: FieldValue.serverTimestamp() },
      ...(approved ? { status: 'approved', approved: { uid: signerUid, name, role, at: FieldValue.serverTimestamp() } } : {}),
      ...stamp,
    });
  });
  await writeAudit({
    actorUid: signerUid, actorEmail: signer!.email, action: 'petty_pin_sign', path: ref.path, collection: kind === 'fund' ? 'pettyFunds' : 'pettyCash',
    docId, orgId, note: `Signed with PIN on ${caller.profile.displayName || caller.email}'s device`,
  });
  return { name };
});

/**
 * Tops up petty cash in one step (Andy, 2026-10-24): a stakeholder allowed to top up picks their name,
 * types the amount and their own PIN, and the money is in the budget straight away. At ADIA only
 * Andrew Guya, Daniel Ojwang', Doreen Mayaka and Elias Omondi may do this.
 */
export const topUpWithPin = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const signerUid = requireString(data.signerUid, 'the stakeholder', { max: 128 });
  const amountCents = typeof data.amountCents === 'number' ? data.amountCents : parseAmountCents(String(data.amountCents ?? ''));
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100000000000) {
    throw new HttpsError('invalid-argument', 'Type the top-up amount in numbers, for example 500000.');
  }
  requireMember(caller.profile, orgId);
  const [signerSnap, org] = await Promise.all([db.doc(`users/${signerUid}`).get(), db.doc(`organizations/${orgId}`).get()]);
  const signer = signerSnap.data() as UserProfile | undefined;
  const name = signer ? signer.displayName || signer.email : '';
  const orgType = (org.data() as { type?: string } | undefined)?.type;
  if (!canSign(signer, orgId, 'fund') || !canTopUpAlone(orgType, name, (signer!.permissions ?? []).includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'That person cannot top up here.');
  }
  await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');
  const ref = db.collection(`organizations/${orgId}/pettyFunds`).doc();
  await ref.set({
    orgId, kind: 'topup', amountCents, status: 'done', doneAt: FieldValue.serverTimestamp(),
    signatures: { [signerUid]: { name, at: FieldValue.serverTimestamp() } },
    deletedAt: null, deletedBy: null,
    createdAt: FieldValue.serverTimestamp(), createdBy: signerUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid,
  });
  await writeAudit({
    actorUid: signerUid, actorEmail: signer!.email, action: 'petty_topup', path: ref.path, collection: 'pettyFunds',
    docId: ref.id, orgId, note: `Top-up with PIN on ${caller.profile.displayName || caller.email}'s device`,
  });
  return { name, id: ref.id };
});
