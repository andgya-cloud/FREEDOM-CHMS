import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { fundStatusAfter, itemsTotalCents, type PettyCashCategory, type PettyCashItem, type PettyFund, type PettyFundKind } from '../../functions/src/shared/pettyCash';

const me = () => {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
};
const reqRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'pettyCash', id);

/** Saves a new requisition on the device straight away; the server gives it its number (ADIA-00015). */
export function submitRequisition(orgId: string, input: { requesterName: string; category: PettyCashCategory; items: PettyCashItem[]; month: string }): { id: string; saved: Promise<unknown> } {
  const ref = doc(collection(db, 'organizations', orgId, 'pettyCash'));
  const saved = trackWrite(setDoc(ref, {
    orgId, number: null, requesterId: me(), requesterName: input.requesterName, category: input.category,
    items: input.items, totalCents: itemsTotalCents(input.items), month: input.month,
    status: 'submitted', checked: null, approved: null, rejection: null, ...createStamps(),
  }));
  return { id: ref.id, saved };
}

const signOff = (name: string, role: string) => ({ uid: me(), name, role, at: serverTimestamp() });

/** The accountant's check: the second of three signatures. */
export function checkRequisition(orgId: string, id: string, name: string) {
  return updateRecord(reqRef(orgId, id), { status: 'checked', checked: signOff(name, 'Accountant') });
}

/** A board member's final approval: the third signature. */
export function approveRequisition(orgId: string, id: string, name: string) {
  return updateRecord(reqRef(orgId, id), { status: 'approved', approved: signOff(name, 'Board member') });
}

export function rejectRequisition(orgId: string, id: string, name: string, reason: string) {
  return updateRecord(reqRef(orgId, id), { status: 'rejected', rejection: { uid: me(), name, reason, at: serverTimestamp() } });
}

/** A stakeholder's signature is their own Insight-IQ password, checked again before they sign. */
export async function confirmOwnPassword(password: string) {
  const u = auth.currentUser;
  if (!u?.email) throw new Error('Please sign in again.');
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
}

const fundRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'pettyFunds', id);

/** Starts a top-up or a reset with the first signature. Two more stakeholders must sign it. */
export function startFund(orgId: string, kind: PettyFundKind, amountCents: number, name: string) {
  const ref = doc(collection(db, 'organizations', orgId, 'pettyFunds'));
  return trackWrite(setDoc(ref, {
    orgId, kind, amountCents: kind === 'topup' ? amountCents : 0,
    signatures: { [me()]: { name, at: serverTimestamp() } }, status: 'collecting', doneAt: null, ...createStamps(),
  }));
}

/** Adds this person's signature; the third one completes it. */
export function signFund(orgId: string, fund: Pick<PettyFund, 'id' | 'signatures'>, name: string) {
  const uid = me();
  const status = fundStatusAfter(Object.keys(fund.signatures).length + 1);
  return updateRecord(fundRef(orgId, fund.id), {
    [`signatures.${uid}`]: { name, at: serverTimestamp() }, status, ...(status === 'done' ? { doneAt: serverTimestamp() } : {}),
  });
}

export function cancelFund(orgId: string, id: string) {
  return updateRecord(fundRef(orgId, id), { status: 'cancelled' });
}
