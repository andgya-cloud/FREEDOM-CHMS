import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import type { InventoryCount, InventoryItem, InventoryReopen } from '../../functions/src/shared/inventory';

const ref = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'inventoryCounts', id);

/** Admin opens a count for one department (Andy, 2026-10-29): it starts from the last count's items, if any. */
export function openInventoryCount(orgId: string, id: string, c: Pick<InventoryCount, 'cohort' | 'courseId' | 'courseName' | 'phase' | 'deadline' | 'items'>) {
  return trackWrite(setDoc(ref(orgId, id), {
    orgId, ...c, status: 'open', reopenRequest: null, reopenUntil: null, reopens: [], preparedByName: null, signedName: null,
    submittedAt: null, verifiedAt: null, verifiedByName: null, verifyNote: null, returnNote: null, ...createStamps(),
  }));
}

export const saveInventoryItems = (orgId: string, id: string, items: InventoryItem[], preparedByName: string) =>
  updateRecord(ref(orgId, id), { items, preparedByName });

export const submitInventory = (orgId: string, id: string, items: InventoryItem[], signedName: string) =>
  updateRecord(ref(orgId, id), { items, preparedByName: signedName, signedName, status: 'submitted', submittedAt: serverTimestamp(), reopenRequest: null });

export const askInventoryReopen = (orgId: string, id: string, reason: string, byName: string) =>
  updateRecord(ref(orgId, id), { reopenRequest: { reason: reason.slice(0, 300), byName: byName.slice(0, 120) } });

export const setInventoryDeadline = (orgId: string, id: string, deadline: string) => updateRecord(ref(orgId, id), { deadline });

/** Admin reopens a closed form until a day; it is recorded and printed on the form. */
export const reopenInventory = (orgId: string, id: string, c: Pick<InventoryCount, 'reopens' | 'reopenRequest'>, until: string, grantedByName: string, today: string) => {
  const entry: InventoryReopen = { reason: c.reopenRequest?.reason ?? '', byName: c.reopenRequest?.byName ?? '', grantedByName: grantedByName.slice(0, 120), until, at: today };
  return updateRecord(ref(orgId, id), { reopenUntil: until, reopenRequest: null, reopens: [...(c.reopens ?? []), entry].slice(-20) });
};

export const verifyInventory = (orgId: string, id: string, byName: string, note: string) =>
  updateRecord(ref(orgId, id), { status: 'verified', verifiedByName: byName.slice(0, 120), verifiedAt: serverTimestamp(), verifyNote: note.trim().slice(0, 300) || null });

/** Admin sends a submitted form back for correction, open for a few more days. */
export const returnInventory = (orgId: string, id: string, note: string, until: string) =>
  updateRecord(ref(orgId, id), { status: 'open', returnNote: note.trim().slice(0, 300) || null, reopenUntil: until, submittedAt: null });

export const removeInventoryCount = (orgId: string, id: string) => softDelete(ref(orgId, id));

/** An item's photo, made small on the phone first; returns its id. */
export function saveInventoryPhoto(orgId: string, courseId: string, data: string): string {
  const photo = doc(db, 'organizations', orgId, 'inventoryPhotos', `${courseId}_${crypto.randomUUID().slice(0, 12)}`);
  void trackWrite(setDoc(photo, { orgId, courseId, data, ...createStamps() }));
  return photo.id;
}

export async function emailInventory(orgId: string, countId: string, file: File, to: 'managers' | string) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const r = await httpsCallable<Record<string, string>, { sent: number }>(functions, 'inventoryEmail')({ orgId, countId, to, fileName: file.name, pdf: btoa(bin) });
  return r.data.sent;
}
