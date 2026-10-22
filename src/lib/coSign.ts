import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, serverTimestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { app, usingEmulators } from '../firebase';
import { fundStatusAfter, REQUEST_SIGNATURES_NEEDED } from '../../functions/src/shared/pettyCash';

/**
 * Signing at one desk: another stakeholder types their own email and password on this device, and their
 * signature is written as them, through a separate short-lived sign-in that never touches the account
 * already signed in here. Firestore rules still check that person's own permissions, so nobody can sign
 * for someone else. Needs a connection.
 */
async function asSigner<T>(email: string, password: string, work: (db: Firestore, uid: string, name: string, permissions: string[]) => Promise<T>): Promise<T> {
  const second = initializeApp(app.options, `cosign-${Date.now()}`);
  try {
    const a = initializeAuth(second, { persistence: inMemoryPersistence });
    const db = initializeFirestore(second, {});
    if (usingEmulators) {
      connectAuthEmulator(a, `http://${location.hostname}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(db, location.hostname, 8080);
    }
    const { user } = await signInWithEmailAndPassword(a, email.trim(), password);
    const profile = (await getDoc(doc(db, 'users', user.uid))).data() as { displayName?: string; permissions?: string[] } | undefined;
    return await work(db, user.uid, profile?.displayName || user.displayName || email.trim(), profile?.permissions ?? []);
  } finally {
    await deleteApp(second).catch(() => undefined);
  }
}

const roleFrom = (permissions: string[]) => (permissions.includes('pettycash.check') ? 'Accountant'
  : permissions.includes('pettycash.approve') ? 'Board member' : permissions.includes('pettycash.authorize') ? 'Stakeholder' : 'Pastor');

/** Adds another stakeholder's signature to a top-up or reset; the third one completes it. Returns their name. */
export function coSignFund(orgId: string, fund: { id: string; signatures: Record<string, unknown> }, email: string, password: string) {
  return asSigner(email, password, async (db, uid, name) => {
    if (uid in fund.signatures) throw new Error(`${name} has already signed.`);
    const status = fundStatusAfter(Object.keys(fund.signatures).length + 1);
    await updateDoc(doc(db, 'organizations', orgId, 'pettyFunds', fund.id), {
      [`signatures.${uid}`]: { name, at: serverTimestamp() }, status, ...(status === 'done' ? { doneAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(), updatedBy: uid,
    });
    return name;
  });
}

/** Adds another stakeholder's signature to a requisition; the third one approves it. Returns their name. */
export function coSignRequisition(orgId: string, r: { id: string; requesterId: string; signatures?: Record<string, unknown> }, email: string, password: string) {
  return asSigner(email, password, async (db, uid, name, permissions) => {
    if (uid === r.requesterId) throw new Error('Nobody can sign their own request.');
    if (uid in (r.signatures ?? {})) throw new Error(`${name} has already signed.`);
    const role = roleFrom(permissions);
    const approved = Object.keys(r.signatures ?? {}).length + 1 >= REQUEST_SIGNATURES_NEEDED;
    await updateDoc(doc(db, 'organizations', orgId, 'pettyCash', r.id), {
      [`signatures.${uid}`]: { name, role, at: serverTimestamp() },
      ...(approved ? { status: 'approved', approved: { uid, name, role, at: serverTimestamp() } } : {}),
      updatedAt: serverTimestamp(), updatedBy: uid,
    });
    return name;
  });
}
