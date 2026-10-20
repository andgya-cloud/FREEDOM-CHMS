import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { itemsTotalCents, type PettyCashCategory, type PettyCashItem } from '../../functions/src/shared/pettyCash';

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

/** The petty cash budget for a month ("2026-10"). */
export function setPettyBudget(orgId: string, month: string, amountCents: number, note: string, exists: boolean) {
  const ref = doc(db, 'organizations', orgId, 'pettyBudgets', month);
  if (exists) return updateRecord(ref, { orgId, amountCents, note });
  return trackWrite(setDoc(ref, { orgId, amountCents, note, ...createStamps() }));
}
