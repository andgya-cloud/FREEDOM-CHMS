import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, requireCaller, requireString, type UserProfile } from './common.js';
import { canAccessOrg } from './shared/permissions.js';
import { localDateKey } from './shared/datetime.js';
import { chatRole } from './shared/hopeChats.js';
import {
  canAddLeavingNote, canKeepFees, canReadNotes, feeFromLine, isFeeMethod, isNoteKind, isTerm, NOTE_TEXT_MAX, termOf,
  type ChildNote, type FeePayment, type NoteKind,
} from './shared/hopeRecords.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECEIPT_MAX = 450_000;

/**
 * Hope Centre records (Andy, 2026-11-05). Every read and write is checked here:
 * - "notes" (one child's, or every child's for Reports → Records) and "addNote" (a new dated, signed entry)
 * - "fees" (one child's payments, term fee and balance), "addFee" (with an optional receipt photo),
 *   "termFee" (set the fee for a term) and "receipt" (open a receipt photo)
 * The old one-box welfare notes and home visits are copied into notes the first time a reader opens them (4A).
 * Removing a note or payment goes through Clean-up, to the Bin.
 */
export const hopeRecords = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as UserProfile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(me, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (org?.type !== 'ministry') throw new HttpsError('failed-precondition', 'Records are for the Hope Center.');
  const tz = String(org.timeZone || 'Africa/Nairobi');
  const action = String(data.action ?? '');
  const base = `organizations/${orgId}`;
  const myName = me.displayName || me.email;
  const nowIso = new Date().toISOString();

  async function childOf(childId: string) {
    const [c, p] = await Promise.all([db.doc(`${base}/children/${childId}`).get(), db.doc(`${base}/people/${childId}`).get()]);
    if (!c.exists || c.data()?.deletedAt) throw new HttpsError('not-found', 'This child was not found.');
    return { child: c.data()!, childName: String(p.data()?.fullName ?? 'Child'), childCode: String(c.data()?.code ?? '') };
  }
  const childIdOf = (v: unknown) => {
    const id = requireString(v, 'the child', { max: 120 });
    if (id.includes('/')) throw new HttpsError('invalid-argument', 'Please check the child.');
    return id;
  };

  /** Copies the old welfare boxes and home visits into dated notes, once (4A). The old records are kept as they were. */
  async function moveOld() {
    const flag = db.doc(`${base}/hopeMeta/notesMoved`);
    if ((await flag.get()).exists) return;
    const [privates, visits, children, people] = await Promise.all([
      db.collection(`${base}/childPrivate`).get(), db.collection(`${base}/homeVisits`).get(),
      db.collection(`${base}/children`).get(), db.collection(`${base}/people`).get(),
    ]);
    const code = new Map(children.docs.map((d) => [d.id, String(d.get('code') ?? '')]));
    const name = new Map(people.docs.map((d) => [d.id, String(d.get('fullName') ?? 'Child')]));
    const notes: [string, ChildNote][] = [];
    const add = (id: string, childId: string, kind: NoteKind, text: string, day: string, byUid: string, at: string) => {
      if (!text.trim() || !code.has(childId)) return;
      notes.push([id, { orgId, childId, childName: name.get(childId) ?? 'Child', childCode: code.get(childId) ?? '', kind, text: text.trim().slice(0, NOTE_TEXT_MAX), day, byUid, byName: 'Earlier notes', byRole: '', at, fromOld: id }]);
    };
    const iso = (v: unknown) => (v && typeof (v as { toDate?: unknown }).toDate === 'function' ? (v as { toDate: () => Date }).toDate().toISOString() : nowIso);
    for (const d of privates.docs) {
      if (d.get('deletedAt')) continue;
      const at = iso(d.get('updatedAt') ?? d.get('createdAt'));
      const by = String(d.get('updatedBy') ?? d.get('createdBy') ?? '');
      for (const k of ['welfare', 'health', 'home'] as const) add(`old_${k}_${d.id}`, d.id, k, String(d.get(k) ?? ''), at.slice(0, 10), by, at);
    }
    for (const d of visits.docs) {
      if (d.get('deletedAt')) continue;
      const at = iso(d.get('createdAt'));
      add(`old_visit_${d.id}`, String(d.get('childId') ?? ''), 'visit', String(d.get('note') ?? ''), String(d.get('date') ?? at.slice(0, 10)), String(d.get('createdBy') ?? ''), at);
    }
    for (let i = 0; i < notes.length; i += 400) {
      const batch = db.batch();
      notes.slice(i, i + 400).forEach(([id, n]) => batch.set(db.doc(`${base}/childNotes/${id}`), n));
      await batch.commit();
    }
    await flag.set({ at: nowIso, by: caller.uid, moved: notes.length });
  }

  switch (action) {
    case 'notes': {
      if (!canReadNotes(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, Andrew Guya and Doreen read these notes.');
      await moveOld();
      const childId = data.childId ? childIdOf(data.childId) : null;
      const q = childId ? db.collection(`${base}/childNotes`).where('childId', '==', childId) : db.collection(`${base}/childNotes`);
      const snaps = (await q.limit(3000).get()).docs.filter((d) => !d.get('deletedAt'));
      const notes = snaps.map((d) => ({ id: d.id, ...(d.data() as ChildNote), deletedAt: undefined, deletedBy: undefined }))
        .sort((a, b) => (b.day + b.at).localeCompare(a.day + a.at));
      return { notes };
    }

    case 'addNote': {
      const kind = data.kind;
      if (!isNoteKind(kind)) throw new HttpsError('invalid-argument', 'Please choose the kind of note.');
      if (kind === 'leaving' ? !canAddLeavingNote(me, orgId) : !canReadNotes(me, orgId)) throw new HttpsError('permission-denied', 'You cannot add this note.');
      const childId = childIdOf(data.childId);
      const text = requireString(data.text, 'the note', { max: NOTE_TEXT_MAX });
      const today = localDateKey(new Date(), tz);
      const day = typeof data.day === 'string' && DATE.test(data.day) && data.day <= today ? data.day : today;
      const c = await childOf(childId);
      const note: ChildNote = { orgId, childId, childName: c.childName, childCode: c.childCode, kind, text, day, byUid: caller.uid, byName: myName, byRole: chatRole(me, orgId), at: nowIso };
      const ref = await db.collection(`${base}/childNotes`).add(note);
      return { id: ref.id };
    }

    case 'fees': {
      if (!canKeepFees(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, the accountant, Andrew Guya and Doreen see fees paid.');
      const childId = childIdOf(data.childId);
      const c = await childOf(childId);
      const [pays, plan] = await Promise.all([
        db.collection(`${base}/hopeFees`).where('childId', '==', childId).get(),
        db.doc(`${base}/hopeFeePlans/${childId}`).get(),
      ]);
      const payments = pays.docs.filter((d) => !d.get('deletedAt')).map((d) => ({ id: d.id, ...(d.data() as FeePayment), deletedAt: undefined, deletedBy: undefined }))
        .sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
      const saved = plan.data()?.termFee;
      const guess = feeFromLine((c.child.payment as { amount?: string } | null)?.amount);
      return { payments, termFee: typeof saved === 'number' ? saved : guess, termFeeSaved: typeof saved === 'number', today: localDateKey(new Date(), tz) };
    }

    case 'addFee': {
      if (!canKeepFees(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, the accountant, Andrew Guya and Doreen record fees paid.');
      const childId = childIdOf(data.childId);
      await childOf(childId);
      const today = localDateKey(new Date(), tz);
      const date = typeof data.date === 'string' && DATE.test(data.date) && data.date <= today ? data.date : null;
      if (!date) throw new HttpsError('invalid-argument', 'Please check the date paid.');
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new HttpsError('invalid-argument', 'Please check the amount.');
      const term = isTerm(data.term) ? data.term : termOf(date);
      const method = isFeeMethod(data.method) ? data.method : 'mpesa';
      const code = typeof data.code === 'string' ? data.code.trim().toUpperCase().slice(0, 30) : '';
      const note = typeof data.note === 'string' ? data.note.trim().slice(0, 300) : '';
      const receipt = typeof data.receipt === 'string' && data.receipt ? data.receipt : null;
      if (receipt && (!/^data:image\/jpeg;base64,/.test(receipt) || receipt.length > RECEIPT_MAX)) throw new HttpsError('invalid-argument', 'The receipt photo could not be saved. Please take it again.');
      const fee: FeePayment = { orgId, childId, date, term, amount: Math.round(amount), method, code, note, hasReceipt: !!receipt, byUid: caller.uid, byName: myName, at: nowIso };
      const ref = db.collection(`${base}/hopeFees`).doc();
      const batch = db.batch();
      batch.set(ref, fee);
      if (receipt) batch.set(db.doc(`${base}/hopeFeeReceipts/${ref.id}`), { orgId, childId, photo: receipt, at: nowIso });
      await batch.commit();
      return { id: ref.id };
    }

    case 'termFee': {
      if (!canKeepFees(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, the accountant, Andrew Guya and Doreen set the term fee.');
      const childId = childIdOf(data.childId);
      await childOf(childId);
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new HttpsError('invalid-argument', 'Please check the term fee.');
      await db.doc(`${base}/hopeFeePlans/${childId}`).set({ orgId, childId, termFee: Math.round(amount), updatedBy: caller.uid, updatedByName: myName, at: nowIso });
      return { ok: true };
    }

    case 'receipt': {
      if (!canKeepFees(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, the accountant, Andrew Guya and Doreen see receipts.');
      const feeId = requireString(data.feeId, 'the payment', { max: 120 });
      if (feeId.includes('/')) throw new HttpsError('invalid-argument', 'Please check the payment.');
      const snap = await db.doc(`${base}/hopeFeeReceipts/${feeId}`).get();
      if (!snap.exists) throw new HttpsError('not-found', 'No receipt photo was kept for this payment.');
      return { photo: String(snap.get('photo') ?? '') };
    }

    default:
      throw new HttpsError('invalid-argument', 'Unknown action.');
  }
});
