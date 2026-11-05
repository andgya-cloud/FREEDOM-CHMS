import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db, requireCaller, requireString, type UserProfile } from './common.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { contactEmail } from './pettyContacts.js';
import { isPhotoApprover, PHOTO_PROOF_MINUTES } from './shared/hopePhotos.js';

const PHOTO_MAX = 300_000;

/**
 * A child's photo (Andy, 2026-11-05): taking, uploading or removing one needs the password of the Director, Andy or
 * Doreen, whoever is holding the phone. The phone proves the password with a short sign-in (`proof`), and the
 * photo is saved here, never straight from the phone. A removed photo goes to the Bin, which only Andy and Doreen open.
 * - "approvers": who may approve, with the sign-in emails their password is tried on
 * - "save" { childId, photo, proof } and "remove" { childId, proof }
 */
export const hopeChildPhoto = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as UserProfile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId) || !can(me, 'people.write')) throw new HttpsError('permission-denied', 'You cannot change photos here.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (org?.type !== 'ministry') throw new HttpsError('failed-precondition', 'Photos are for the Hope Center.');
  const base = `organizations/${orgId}`;
  const action = String(data.action ?? '');

  if (action === 'approvers') {
    const users = (await db.collection('users').where('active', '==', true).get()).docs.filter((d) => isPhotoApprover(d.data() as UserProfile, orgId));
    const logins = users.length ? await auth.getUsers(users.map((d) => ({ uid: d.id }))).catch(() => null) : null;
    const login = new Map((logins?.users ?? []).map((u) => [u.uid, u.email ?? '']));
    return {
      approvers: users.map((d) => {
        const u = d.data() as UserProfile;
        const name = u.displayName || u.email;
        return { uid: d.id, name, emails: [...new Set([login.get(d.id), u.email, contactEmail(name)].filter((e): e is string => !!e).map((e) => e.toLowerCase()))] };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // Whose password was typed: it must be one of the three, and typed in the last few minutes.
  const proof = typeof data.proof === 'string' && data.proof.startsWith('idtoken:') ? data.proof.slice(8) : '';
  const token = proof ? await auth.verifyIdToken(proof).catch(() => null) : null;
  if (!token || Date.now() / 1000 - token.auth_time > PHOTO_PROOF_MINUTES * 60) throw new HttpsError('permission-denied', 'The password could not be confirmed. Please type it again.');
  const approver = (await db.doc(`users/${token.uid}`).get()).data() as UserProfile | undefined;
  if (!approver || approver.active === false || !isPhotoApprover(approver, orgId)) throw new HttpsError('permission-denied', 'Only the Director, Andrew Guya or Doreen can approve a photo.');
  const approverName = approver.displayName || approver.email;

  const childId = requireString(data.childId, 'the child', { max: 80 });
  if (childId.includes('/')) throw new HttpsError('invalid-argument', 'Please check the child.');
  const childRef = db.doc(`${base}/children/${childId}`);
  const photoRef = db.doc(`${base}/childPhotos/${childId}`);
  const [c, p] = await Promise.all([childRef.get(), db.doc(`${base}/people/${childId}`).get()]);
  if (!c.exists || c.data()?.deletedAt) throw new HttpsError('not-found', 'This child was not found.');
  const childName = String(p.data()?.fullName ?? 'Child');
  const now = Timestamp.now();

  if (action === 'save') {
    const photo = data.photo;
    if (typeof photo !== 'string' || photo.length > PHOTO_MAX || !photo.startsWith('data:image/jpeg;base64,')) throw new HttpsError('invalid-argument', 'The photo is too big or not a picture.');
    if (c.data()?.photoConsent?.given !== true) throw new HttpsError('failed-precondition', `There is no photo consent for ${childName}.`);
    const batch = db.batch();
    batch.set(photoRef, { orgId, photo, updatedAt: now, updatedBy: caller.uid, approvedBy: token.uid, approvedByName: approverName });
    batch.update(childRef, { hasPhoto: true, updatedAt: now, updatedBy: caller.uid });
    await batch.commit();
    return { ok: true, approvedByName: approverName };
  }

  if (action === 'remove') {
    const binRef = db.collection(`${base}/cleanupBin`).doc();
    const name = me.displayName || caller.email;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(photoRef);
      if (!snap.exists) return;
      tx.set(binRef, {
        orgId, kind: 'childPhoto', targetId: childId, label: `${childName} · photo`, detail: `Approved by ${approverName}`, official: false,
        refs: [`childPhotos/${childId}`], linked: {}, reason: '', deletedBy: caller.uid, deletedByName: name, state: 'bin', bare: [],
        deletedAt: now, foreverAt: null, restoredAt: null, restoredBy: null, restoredByName: null, copy: { ...snap.data(), childName },
      });
      tx.delete(photoRef);
      tx.update(childRef, { hasPhoto: false, updatedAt: now, updatedBy: caller.uid });
    });
    return { ok: true, approvedByName: approverName };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});
