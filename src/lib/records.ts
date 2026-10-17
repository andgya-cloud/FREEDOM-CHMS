import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { trackWrite } from './sync';

/**
 * Every record carries who created it, who last changed it and when.
 * The server rules reject writes without these stamps, and the audit log
 * reads the actor from them.
 *
 * These helpers never await the server: offline, the change is saved on the
 * device straight away and synced later. The returned promise resolves when
 * the server has accepted it.
 */
function uid(): string {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
}

/** The stamps every new record carries. */
export function createStamps(): DocumentData {
  const me = uid();
  return {
    deletedAt: null,
    deletedBy: null,
    createdAt: serverTimestamp(),
    createdBy: me,
    updatedAt: serverTimestamp(),
    updatedBy: me,
  };
}

/** The stamps every change carries. */
export function updateStamps(): DocumentData {
  return { updatedAt: serverTimestamp(), updatedBy: uid() };
}

export function createRecord(path: string | CollectionReference, data: DocumentData): { ref: DocumentReference; synced: Promise<unknown> } {
  const me = uid();
  const col = typeof path === 'string' ? collection(db, path) : path;
  const ref = doc(col);
  const synced = trackWrite(
    setDoc(ref, {
      ...data,
      deletedAt: null,
      deletedBy: null,
      createdAt: serverTimestamp(),
      createdBy: me,
      updatedAt: serverTimestamp(),
      updatedBy: me,
    }),
  );
  return { ref, synced };
}

export function updateRecord(ref: DocumentReference, changes: DocumentData): Promise<unknown> {
  const me = uid();
  return trackWrite(updateDoc(ref, { ...changes, updatedAt: serverTimestamp(), updatedBy: me }));
}

/** Moves a record to the bin. It is kept for 30 days and can be restored. */
export function softDelete(ref: DocumentReference): Promise<unknown> {
  const me = uid();
  return trackWrite(updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: me, updatedAt: serverTimestamp(), updatedBy: me }));
}

export function restoreRecord(ref: DocumentReference): Promise<unknown> {
  const me = uid();
  return trackWrite(updateDoc(ref, { deletedAt: null, deletedBy: null, updatedAt: serverTimestamp(), updatedBy: me }));
}
