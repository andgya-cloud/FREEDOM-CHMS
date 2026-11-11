import { addDoc, collection, doc, orderBy, query, serverTimestamp, updateDoc, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useLiveQuery } from './useQuery';

/**
 * A review from a Reviewer (Andy, 2026-11-11), with the page it is about. Mr Andrew reads and answers each one;
 * the reviewer sees the answer in My reviews.
 */
export interface ReviewerNote {
  id: string; uid: string; name: string; orgId: string; path: string; page: string; text: string; status: 'new' | 'done'; createdAt?: Timestamp;
  reply?: string; replyBy?: string; replyAt?: Timestamp; replySeen?: boolean;
}

export function sendReviewerNote(n: { uid: string; name: string; orgId: string; path: string; page: string; text: string }) {
  return addDoc(collection(db, 'reviewerNotes'), {
    uid: n.uid, name: n.name.slice(0, 80), orgId: n.orgId.slice(0, 60), path: n.path.slice(0, 200), page: n.page.slice(0, 120),
    text: n.text.trim().slice(0, 2000), status: 'new', createdAt: serverTimestamp(),
  });
}

export const markNote = (id: string, status: 'new' | 'done') => updateDoc(doc(db, 'reviewerNotes', id), { status });

/** Mr Andrew answers a review; answering also marks it done. */
export const replyToNote = (id: string, reply: string, by: string) =>
  updateDoc(doc(db, 'reviewerNotes', id), { reply: reply.trim().slice(0, 2000), replyBy: by.slice(0, 80), replyAt: serverTimestamp(), replySeen: false, status: 'done' });

export const markReplySeen = (id: string) => updateDoc(doc(db, 'reviewerNotes', id), { replySeen: true });

/** Every review, for Mr Andrew. */
export function useReviewerNotes(enabled: boolean) {
  return useLiveQuery<ReviewerNote>(() => (enabled ? query(collection(db, 'reviewerNotes'), orderBy('createdAt', 'desc')) : null), [enabled]);
}

/** A reviewer's own reviews, newest first. */
export function useMyReviews(uid: string) {
  return useLiveQuery<ReviewerNote>(() => (uid ? query(collection(db, 'reviewerNotes'), where('uid', '==', uid)) : null), [uid]);
}

export const sortNewest = (rows: ReviewerNote[]) => [...rows].sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now()));

/** Whether a reviewer wrote a review today (their phone's day). */
export function wroteToday(rows: ReviewerNote[], now = new Date()): boolean {
  const day = now.toDateString();
  return rows.some((r) => !r.createdAt || r.createdAt.toDate().toDateString() === day);
}
