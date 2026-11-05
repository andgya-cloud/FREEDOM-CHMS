import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, functions } from '../firebase';
import { trackWrite } from './sync';
import type { ChildNote, FeeMethod, FeePayment, MealDay, NoteKind } from '../../functions/src/shared/hopeRecords';

/** Hope Centre records (Andy, 2026-11-05): notes and fees go through the server, which checks who may see them. */
export type StoredNote = ChildNote & { id: string };
export type StoredFee = FeePayment & { id: string };
type Action = 'owing' | 'notes' | 'addNote' | 'fees' | 'addFee' | 'termFee' | 'receipt';
const call = <R,>(data: Record<string, unknown> & { orgId: string; action: Action }) =>
  httpsCallable<typeof data, R>(functions, 'hopeRecords', { timeout: 120_000 })(data).then((r) => r.data);

export const listNotes = (orgId: string, childId?: string) => call<{ notes: StoredNote[] }>({ orgId, action: 'notes', ...(childId ? { childId } : {}) });
export const addNote = (orgId: string, childId: string, kind: NoteKind, text: string, day?: string) => call<{ id: string }>({ orgId, action: 'addNote', childId, kind, text, ...(day ? { day } : {}) });

export interface FeesView { payments: StoredFee[]; termFee: number; termFeeSaved: boolean; today: string }
export const feesOwing = (orgId: string) => call<{ term: string; owing: { childId: string; left: number; fee: number }[] }>({ orgId, action: 'owing' });
export const listFees = (orgId: string, childId: string) => call<FeesView>({ orgId, action: 'fees', childId });
export interface FeeInput { date: string; term: string; amount: number; method: FeeMethod; code: string; note: string; receipt: string | null }
export const addFee = (orgId: string, childId: string, input: FeeInput) => call<{ id: string }>({ orgId, action: 'addFee', childId, ...input });
export const setTermFee = (orgId: string, childId: string, amount: number) => call<{ ok: true }>({ orgId, action: 'termFee', childId, amount });
export const feeReceipt = (orgId: string, feeId: string) => call<{ photo: string }>({ orgId, action: 'receipt', feeId });

/** Meals served on a day (9A): saved on the device first, like the registers. */
export function saveMeals(orgId: string, date: string, counts: Pick<MealDay, 'breakfast' | 'lunch' | 'fruit'>) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'hopeMeals', date), { orgId, date, ...counts, updatedAt: serverTimestamp(), updatedBy: uid }));
}
