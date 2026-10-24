import { collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db } from '../firebase';
import { createStamps, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { fundStatusAfter, itemsTotalCents, MAX_RECEIPT_BYTES, MAX_RECEIPT_PARTS, receiptTypeOf, REQUEST_SIGNATURES_NEEDED, SHRINK_PHOTOS_OVER_BYTES, splitReceiptData, type PettyCashCategory, type PettyCashItem, type PettyFund, type PettyFundKind } from '../../functions/src/shared/pettyCash';

const me = () => {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
};
const reqRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'pettyCash', id);

/** Saves a new requisition on the device straight away; the server gives it its number (ADIA-00015). */
export function submitRequisition(orgId: string, input: { requesterName: string; category: PettyCashCategory; categoryNote: string | null; items: PettyCashItem[]; month: string }): { id: string; saved: Promise<unknown> } {
  const ref = doc(collection(db, 'organizations', orgId, 'pettyCash'));
  const saved = trackWrite(setDoc(ref, {
    orgId, number: null, requesterId: me(), requesterName: input.requesterName, category: input.category,
    categoryNote: input.category === 'Other' ? input.categoryNote : null,
    items: input.items, totalCents: itemsTotalCents(input.items), month: input.month,
    status: 'submitted', checked: null, approved: null, rejection: null, signatures: {}, ...createStamps(),
  }));
  return { id: ref.id, saved };
}

const signOff = (name: string, role: string) => ({ uid: me(), name, role, at: serverTimestamp() });

/** A stakeholder's signature; the third one approves the request and records that signer as the approver. */
export function signRequisition(orgId: string, r: { id: string; signatures?: Record<string, unknown> }, name: string, role: string) {
  const uid = me();
  const count = Object.keys(r.signatures ?? {}).length + 1;
  const approved = count >= REQUEST_SIGNATURES_NEEDED;
  return updateRecord(reqRef(orgId, r.id), {
    [`signatures.${uid}`]: { name, role, at: serverTimestamp() },
    ...(approved ? { status: 'approved', approved: signOff(name, role) } : {}),
  });
}

/** The accountant's check, on a request made before signatures. */
export function checkRequisition(orgId: string, id: string, name: string) {
  return updateRecord(reqRef(orgId, id), { status: 'checked', checked: signOff(name, 'Accountant') });
}

/** A board member's final approval, on a request made before signatures. */
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

/** Marks a requisition deleted: it leaves every list and total but stays on record. */

export function cancelFund(orgId: string, id: string) {
  return updateRecord(fundRef(orgId, id), { status: 'cancelled' });
}

/** Each category's share of the budget, in cents. */
export function saveAllocations(orgId: string, allocations: Record<string, number>) {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'pettySettings', 'budget'), { orgId, allocations, ...updateStamps() }));
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('That file could not be read.'));
    fr.readAsDataURL(file);
  });
}

/** A photo made small enough to keep: at most 1600 pixels on its longest side, as a JPEG. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That photo could not be opened. Try a JPEG or PNG.'));
      i.src = url;
    });
    let side = 1600;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This device could not prepare the photo.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.72 : 0.6);
      if (data.length * 0.75 <= 900_000) return data;
      side = Math.round(side * 0.75);
    }
    throw new Error('That photo is too large. Take it again a little further away.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Adds a receipt to a requisition: photos, PDF, Word, Excel or CSV up to 10 MB. Big photos are made smaller first. */
export async function addReceipt(orgId: string, reqId: string, file: File, uploadedByName: string, itemIndex: number | null = null) {
  const type = receiptTypeOf(file.name, file.type);
  if (!type) throw new Error(`${file.name} is not a receipt format this app takes. Use a photo, PDF, Word, Excel or CSV file.`);
  if (file.size > MAX_RECEIPT_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
  let data: string;
  let savedType = type;
  if (['image/jpeg', 'image/png', 'image/webp'].includes(type) && file.size > SHRINK_PHOTOS_OVER_BYTES) {
    data = await shrinkPhoto(file);
    savedType = 'image/jpeg';
  } else {
    data = (await readAsDataUrl(file)).replace(/^data:[^;,]*(;base64)?,/, `data:${type};base64,`);
  }
  const parts = splitReceiptData(data);
  if (parts.length > MAX_RECEIPT_PARTS) throw new Error(`${file.name} is larger than 10 MB.`);
  const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
  const ref = doc(collection(db, 'organizations', orgId, 'pettyReceipts'));
  const stamps = createStamps();
  const name = file.name.slice(0, 200) || 'Receipt';
  return Promise.all([
    ...parts.map((part, index) => trackWrite(setDoc(doc(db, 'organizations', orgId, 'pettyReceiptParts', `${ref.id}_${index}`),
      { orgId, reqId, receiptId: ref.id, index, data: part, createdAt: stamps.createdAt, createdBy: stamps.createdBy }))),
    trackWrite(setDoc(doc(db, 'organizations', orgId, 'pettyReceiptFiles', ref.id), { orgId, reqId, parts: parts.length, ...stamps })),
    trackWrite(setDoc(ref, { orgId, reqId, name, type: savedType, size, uploadedByName, ...(itemIndex != null ? { itemIndex } : {}), ...stamps })),
  ]);
}

/** A receipt's file as a data URL, read when someone opens it. */
export async function receiptData(orgId: string, id: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'organizations', orgId, 'pettyReceiptFiles', id));
  const file = snap.data();
  if (!file) return null;
  if (typeof file.data === 'string') return file.data;
  const parts = await Promise.all(Array.from({ length: (file.parts as number) ?? 0 }, (_, i) => getDoc(doc(db, 'organizations', orgId, 'pettyReceiptParts', `${id}_${i}`))));
  if (parts.some((p) => !p.exists())) return null;
  return parts.map((p) => p.data()!.data as string).join('');
}
