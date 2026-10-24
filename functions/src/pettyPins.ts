import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { auth, db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg, isPettyTitle } from './shared/permissions.js';
import { canTopUpAlone, checkPin, fundStatusAfter, parseAmountCents, PIN_LOCK_MINUTES, PIN_MAX_TRIES, REQUEST_SIGNATURES_NEEDED, waitingForAccountant, type PettyCashSignature } from './shared/pettyCash.js';
import { ACCOUNTANT_TITLE } from './shared/permissions.js';
import { contactEmail, isDirector, personKey } from './pettyContacts.js';

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

/**
 * Keeps a hash of the password the pastor sets in Staff accounts, so that password signs petty cash on the
 * server directly, with no sign-in email involved (Andy, 2026-10-24). Kept beside the PIN, never readable.
 */
export async function saveSigningPassword(uid: string, password: string) {
  const salt = randomBytes(16);
  await db.doc(`pettyPins/${uid}`).set({
    pwSalt: salt.toString('base64'), pwHash: (await hashPin(password, salt)).toString('base64'), pwSetAt: FieldValue.serverTimestamp(),
    failed: 0, lockedUntil: null,
  }, { merge: true });
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
      const isPastor = (u.permissions ?? []).includes('users.manage');
      return { uid: d.id, name, title: u.pettyTitle ?? '', email: u.email, canAuthorize, isPastor, isDirector: isDirector(u), canTopUp: canAuthorize && canTopUpAlone(orgType, name, isPastor) };
    });
  const pins = people.length ? await db.getAll(...people.map((p) => db.doc(`pettyPins/${p.uid}`))) : [];
  // Signing with a password uses the sign-in email, which can differ from the profile's. A person may also
  // have a second account (made again with another email), so every email that is theirs is offered.
  const everyone = users.docs.slice(0, 100);
  const logins = everyone.length ? await auth.getUsers(everyone.map((d) => ({ uid: d.id }))).catch(() => null) : null;
  const loginEmail = new Map((logins?.users ?? []).map((u) => [u.uid, u.email ?? '']));
  const emailsOf = (uid: string, name: string, profileEmail: string) => {
    const key = personKey(name);
    const sameName = everyone.filter((d) => d.id !== uid && personKey((d.get('displayName') as string) || '') === key).map((d) => loginEmail.get(d.id) || (d.get('email') as string));
    return [...new Set([loginEmail.get(uid), profileEmail, contactEmail(name), ...sameName].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
  };
  return {
    signers: people.map((p, i) => ({ ...p, email: loginEmail.get(p.uid) || p.email, emails: emailsOf(p.uid, p.name, p.email), hasPin: pins[i].exists })).sort((a, b) => a.name.localeCompare(b.name)),
  };
});

/**
 * A stakeholder may also sign with their Insight-IQ password (Andy, 2026-10-24): the device signs them in
 * for a moment and sends proof in place of a PIN, so the password itself never reaches the server.
 */
const TOKEN_PREFIX = 'idtoken:';

/**
 * The Director (the pastor account) signing as himself, from his own signed-in account, needs no PIN or
 * password for top-ups and resets (Andy, 2026-10-24): being signed in is the proof.
 */
function directorSelf(callerUid: string, signerUid: string, signer: UserProfile | undefined) {
  return callerUid === signerUid && isDirector(signer);
}

/**
 * Whether a password proof from account `proofUid` speaks for signer `uid`: the same account, or another
 * active account of the same person (same name, or their built-in email), made when an account was created twice.
 */
async function sameSigner(uid: string, proofUid: string, proofEmail: string | undefined) {
  if (proofUid === uid) return true;
  const [a, b] = await db.getAll(db.doc(`users/${uid}`), db.doc(`users/${proofUid}`));
  const signer = a.data() as UserProfile | undefined;
  const other = b.data() as UserProfile | undefined;
  if (!signer?.active) return false;
  const email = (proofEmail ?? '').toLowerCase();
  if (email && email === contactEmail(signer.displayName || '').toLowerCase()) return true;
  return !!other?.active && !!signer.displayName && personKey(other.displayName || '') === personKey(signer.displayName);
}

/** Checks a signer's PIN (or password proof), counting wrong PIN tries and locking after too many. */
export async function verifyPin(uid: string, pin: string) {
  if (pin.startsWith(TOKEN_PREFIX)) {
    const t = await auth.verifyIdToken(pin.slice(TOKEN_PREFIX.length)).catch(() => null);
    // The proof must be this person's and freshly made by typing their password.
    if (!t || Date.now() / 1000 - t.auth_time > 300 || !(await sameSigner(uid, t.uid, t.email))) throw new HttpsError('permission-denied', 'That password could not be confirmed. Please type it again.');
    return;
  }
  const ref = db.doc(`pettyPins/${uid}`);
  const snap = await ref.get();
  // Four to six digits is a PIN; anything else is the signing password set in Staff accounts.
  const isPin = /^\d{4,6}$/.test(pin);
  const word = isPin ? 'PIN' : 'password';
  const d = (snap.data() ?? {}) as { salt?: string; hash?: string; pwSalt?: string; pwHash?: string; failed?: number; lockedUntil?: FirebaseFirestore.Timestamp | null };
  const salt = isPin ? d.salt : d.pwSalt;
  const hash = isPin ? d.hash : d.pwHash;
  if (!salt || !hash) {
    throw new HttpsError('failed-precondition', isPin ? 'This person has not set a PIN yet.' : 'NO_SIGNING_PASSWORD');
  }
  if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) {
    throw new HttpsError('resource-exhausted', `Too many wrong tries. Try again in ${PIN_LOCK_MINUTES} minutes.`);
  }
  const ok = timingSafeEqual(await hashPin(pin, Buffer.from(salt, 'base64')), Buffer.from(hash, 'base64'));
  if (!ok) {
    const failed = (d.failed ?? 0) + 1;
    const lock = failed >= PIN_MAX_TRIES;
    await ref.update({ failed: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null });
    throw new HttpsError('permission-denied', lock ? `Wrong ${word}. Signing is now locked for ${PIN_LOCK_MINUTES} minutes.` : `Wrong ${word}. ${PIN_MAX_TRIES - failed} tries left.`);
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
  if (!(kind === 'fund' && directorSelf(caller.uid, signerUid, signer))) await verifyPin(signerUid, pin);
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
  // A reset is started the same way (name + PIN) but still waits for a second stakeholder.
  const kind = data.kind === 'reset' ? 'reset' : 'topup';
  const amountCents = kind === 'reset' ? 0 : typeof data.amountCents === 'number' ? data.amountCents : parseAmountCents(String(data.amountCents ?? ''));
  if (kind === 'topup' && (amountCents == null || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100000000000)) {
    throw new HttpsError('invalid-argument', 'Type the top-up amount in numbers, for example 500000.');
  }
  requireMember(caller.profile, orgId);
  const [signerSnap, org] = await Promise.all([db.doc(`users/${signerUid}`).get(), db.doc(`organizations/${orgId}`).get()]);
  const signer = signerSnap.data() as UserProfile | undefined;
  const name = signer ? signer.displayName || signer.email : '';
  const orgType = (org.data() as { type?: string } | undefined)?.type;
  if (!canSign(signer, orgId, 'fund') || (kind === 'topup' && !canTopUpAlone(orgType, name, (signer!.permissions ?? []).includes('users.manage')))) {
    throw new HttpsError('permission-denied', kind === 'topup' ? 'That person cannot top up here.' : 'That person cannot sign a reset.');
  }
  if (!directorSelf(caller.uid, signerUid, signer)) await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');
  const funds = db.collection(`organizations/${orgId}/pettyFunds`);
  if (kind === 'reset') {
    const waiting = await funds.where('kind', '==', 'reset').where('status', '==', 'collecting').get();
    if (waiting.docs.some((d) => !d.data().deletedAt)) throw new HttpsError('already-exists', 'A reset is already waiting for a signature.');
  }
  const ref = funds.doc();
  const status = fundStatusAfter(1, kind);
  await ref.set({
    orgId, kind, amountCents, status, doneAt: status === 'done' ? FieldValue.serverTimestamp() : null,
    signatures: { [signerUid]: { name, at: FieldValue.serverTimestamp() } },
    deletedAt: null, deletedBy: null,
    createdAt: FieldValue.serverTimestamp(), createdBy: signerUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid,
  });
  await writeAudit({
    actorUid: signerUid, actorEmail: signer!.email, action: kind === 'topup' ? 'petty_topup' : 'petty_reset_start', path: ref.path, collection: 'pettyFunds',
    docId: ref.id, orgId, note: `${kind === 'topup' ? 'Top-up' : 'Reset signed'} with PIN on ${caller.profile.displayName || caller.email}'s device`,
  });
  return { name, id: ref.id };
});
