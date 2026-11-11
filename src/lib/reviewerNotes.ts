import { addDoc, collection, doc, orderBy, query, serverTimestamp, updateDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useLiveQuery } from './useQuery';

/** A suggestion from a Reviewer (Andy, 2026-11-11, 4A), with the page it is about. Only Andy reads them. */
export interface ReviewerNote { id: string; uid: string; name: string; orgId: string; path: string; page: string; text: string; status: 'new' | 'done'; createdAt?: Timestamp }

export function sendReviewerNote(n: { uid: string; name: string; orgId: string; path: string; page: string; text: string }) {
  return addDoc(collection(db, 'reviewerNotes'), {
    uid: n.uid, name: n.name.slice(0, 80), orgId: n.orgId.slice(0, 60), path: n.path.slice(0, 200), page: n.page.slice(0, 120),
    text: n.text.trim().slice(0, 2000), status: 'new', createdAt: serverTimestamp(),
  });
}

export const markNote = (id: string, status: 'new' | 'done') => updateDoc(doc(db, 'reviewerNotes', id), { status });

export function useReviewerNotes(enabled: boolean) {
  return useLiveQuery<ReviewerNote>(() => (enabled ? query(collection(db, 'reviewerNotes'), orderBy('createdAt', 'desc')) : null), [enabled]);
}
