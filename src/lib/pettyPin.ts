import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, EmailAuthProvider, inMemoryPersistence, initializeAuth, reauthenticateWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, functions, usingEmulators } from '../firebase';

/** A stakeholder on the signing name list. */
export interface PettySigner { uid: string; name: string; title: string; email: string; canAuthorize: boolean; canTopUp?: boolean; isPastor?: boolean; isDirector?: boolean; emails?: string[]; hasPin: boolean }

/** The people who can sign petty cash in this organization, with whether each has set a PIN. */
export async function listPettySigners(orgId: string): Promise<PettySigner[]> {
  const res = await httpsCallable<{ orgId: string }, { signers: PettySigner[] }>(functions, 'listPettySigners')({ orgId });
  return res.data.signers;
}

/** Signs a waiting request, top-up or reset as the chosen stakeholder with their PIN. Returns their name. */
export async function signWithPin(orgId: string, kind: 'request' | 'fund', docId: string, signerUid: string, pin: string): Promise<string> {
  const res = await httpsCallable<object, { name: string }>(functions, 'signWithPin')({ orgId, kind, docId, signerUid, pin });
  return res.data.name;
}

/** Tops up petty cash in one step, or starts a reset, as the chosen stakeholder with their PIN. Returns their name. */
export async function topUpWithPin(orgId: string, amountCents: number, signerUid: string, pin: string, kind: 'topup' | 'reset' = 'topup'): Promise<string> {
  const res = await httpsCallable<object, { name: string }>(functions, 'topUpWithPin')({ orgId, amountCents, signerUid, pin, kind });
  return res.data.name;
}

/**
 * Sets a stakeholder's PIN on this device: they type their own password once, through a short-lived
 * sign-in that never touches the account already signed in here.
 */
export async function setPinWithPassword(email: string, password: string, pin: string): Promise<void> {
  const second = initializeApp(app.options, `pin-${Date.now()}`);
  try {
    const a = initializeAuth(second, { persistence: inMemoryPersistence });
    const fns = getFunctions(second, functions.region);
    if (usingEmulators) {
      connectAuthEmulator(a, `http://${location.hostname}:9099`, { disableWarnings: true });
      connectFunctionsEmulator(fns, location.hostname, 5001);
    }
    await signInWithEmailAndPassword(a, email, password);
    await httpsCallable(fns, 'setPettyPin')({ pin });
  } finally {
    await deleteApp(second).catch(() => undefined);
  }
}

/** Asks for, signs, or withdraws a bin step (move to bin, put back, delete forever). */
export async function binSign(args: {
  orgId: string; kind: 'request' | 'fund' | 'receipt'; targetId: string; action: 'delete' | 'restore' | 'purge';
  reason?: string; signerUid?: string; pin?: string; withdraw?: boolean;
}): Promise<{ outcome: 'signed' | 'done' | 'withdrawn'; count: number }> {
  const res = await httpsCallable<object, { outcome: 'signed' | 'done' | 'withdrawn'; count: number }>(functions, 'pettyBinSign')(args);
  return res.data;
}

/** ADIA: raises a requisition as the chosen stakeholder, after checking their PIN. Returns its id and their name. */
export async function raisePettyRequest(args: {
  orgId: string; requesterUid: string; pin: string; category: string; categoryNote: string | null; month: string;
  payee?: string | null; mpesaCode?: string | null;
  items: { description: string; quantity: number; unitPriceCents: number; amountCents: number }[];
}): Promise<{ id: string; name: string }> {
  const res = await httpsCallable<object, { id: string; name: string }>(functions, 'raisePettyRequest')(args);
  return res.data;
}

/** "Send Email" on a requisition: asks for approval while it waits, or sends the signed voucher once approved. */
export async function sendPettyEmail(orgId: string, reqId: string): Promise<{ sent: number; of: number; names?: string[] }> {
  const res = await httpsCallable<object, { sent: number; of: number; names?: string[] }>(functions, 'sendPettyEmail')({ orgId, reqId });
  return res.data;
}

/** The stakeholders' names and WhatsApp numbers, for sending a requisition to each one. */
export async function listPettyContacts(orgId: string): Promise<{ name: string; phone: string }[]> {
  const res = await httpsCallable<{ orgId: string }, { contacts: { name: string; phone: string }[] }>(functions, 'listPettyContacts')({ orgId });
  return res.data.contacts;
}

/**
 * Proof that a stakeholder typed their own Insight-IQ password, for signing on a shared device without a
 * PIN. A short-lived sign-in makes it, so the account signed in here is untouched.
 */
export async function passwordProof(uid: string, emails: string | string[], password: string): Promise<string> {
  // The person signed in on this device proves it on their own account, whatever email the list shows.
  const me = auth.currentUser;
  if (me?.uid === uid && me.email) {
    await reauthenticateWithCredential(me, EmailAuthProvider.credential(me.email, password));
    return `idtoken:${await me.getIdToken(true)}`;
  }
  // A person can have more than one account (made again with another email); try each of their emails.
  const list = [...new Set((Array.isArray(emails) ? emails : [emails]).filter(Boolean))];
  let last: unknown = null;
  for (const email of list) {
    const second = initializeApp(app.options, `proof-${Date.now()}`);
    try {
      const a = initializeAuth(second, { persistence: inMemoryPersistence });
      if (usingEmulators) connectAuthEmulator(a, `http://${location.hostname}:9099`, { disableWarnings: true });
      const cred = await signInWithEmailAndPassword(a, email, password);
      return `idtoken:${await cred.user.getIdToken()}`;
    } catch (err) {
      last = err;
      const code = (err as { code?: string })?.code ?? '';
      if (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password' && code !== 'auth/user-not-found' && code !== 'auth/invalid-email') throw err;
    } finally {
      await deleteApp(second).catch(() => undefined);
    }
  }
  throw last ?? Object.assign(new Error('No sign-in email'), { code: 'auth/invalid-credential' });
}

/** Month-end close: one stakeholder's signature; the second closes the month. */
export async function closePettyMonth(orgId: string, month: string, signerUid: string, pin: string): Promise<{ status: 'closing' | 'closed'; name: string }> {
  const res = await httpsCallable<object, { status: 'closing' | 'closed'; name: string }>(functions, 'closePettyMonth')({ orgId, month, signerUid, pin });
  return res.data;
}
/** Only the Director reopens a closed month, with a reason. */
export async function reopenPettyMonth(orgId: string, month: string, reason: string) {
  await httpsCallable(functions, 'reopenPettyMonth')({ orgId, month, reason });
}
