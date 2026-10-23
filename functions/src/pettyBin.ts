import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, requireMember, verifyPin } from './pettyPins.js';
import { canAccessOrg, isPettyTitle } from './shared/permissions.js';
import {
  BIN_DONE_LABELS, BIN_SIGNATURES_NEEDED, binActionsFor, binStateAfter, categoryLabel,
  type BinAction, type BinEntry, type BinKind, type BinSignature, type PettyCashCategory,
} from './shared/pettyCash.js';

/**
 * The petty cash bin (Andy, 2026-10-23). Moving any entry to the bin, putting it back, or deleting it
 * forever needs two stakeholders: whoever asks signs first (from their own account), and a second
 * signs from their own account or picks their name and types their PIN on the same device. Every
 * finished step is kept on the entry's bin record with the signers' names, titles, times and reason.
 * The pastor (Andy, 2026-10-23) carries out any step alone; it is still recorded, marked as sole approval.
 */
const CALLABLE = { invoker: 'public' } as const;
const COLLECTIONS: Record<BinKind, string> = { request: 'pettyCash', fund: 'pettyFunds', receipt: 'pettyReceipts' };

function titleOf(p: UserProfile) {
  return isPettyTitle(p.pettyTitle) ? p.pettyTitle! : (p.permissions ?? []).includes('users.manage') ? 'Pastor' : 'Stakeholder';
}

async function describe(orgId: string, kind: BinKind, data: FirebaseFirestore.DocumentData) {
  if (kind === 'request') {
    return { label: `Requisition ${data.number ?? '(not yet numbered)'} · ${categoryLabel({ category: data.category as PettyCashCategory, categoryNote: data.categoryNote ?? null })} · by ${data.requesterName ?? 'unknown'}`, amountCents: (data.totalCents as number) ?? null, reqId: null as string | null };
  }
  if (kind === 'fund') return { label: data.kind === 'reset' ? 'Budget reset' : 'Top-up', amountCents: data.kind === 'reset' ? null : (data.amountCents as number), reqId: null };
  const req = data.reqId ? (await db.doc(`organizations/${orgId}/pettyCash/${data.reqId}`).get()).data() : undefined;
  return { label: `Receipt "${data.name}" on requisition ${req?.number ?? ''}`.trim(), amountCents: null, reqId: (data.reqId as string) ?? null };
}

function ownerOf(kind: BinKind, data: FirebaseFirestore.DocumentData) {
  return kind === 'request' ? data.requesterId : data.createdBy;
}

/** Deletes a receipt's file record and its saved parts. */
async function purgeReceiptFiles(orgId: string, receiptId: string) {
  const fileRef = db.doc(`organizations/${orgId}/pettyReceiptFiles/${receiptId}`);
  const parts = ((await fileRef.get()).get('parts') as number | undefined) ?? 0;
  const batch = db.batch();
  for (let i = 0; i < parts; i++) batch.delete(db.doc(`organizations/${orgId}/pettyReceiptParts/${receiptId}_${i}`));
  batch.delete(fileRef);
  await batch.commit();
}

/** Asks for, signs, or withdraws a bin step. Returns what happened and how many signatures it has. */
export const pettyBinSign = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const targetId = requireString(data.targetId, 'the entry', { max: 80 });
  const kind = (['request', 'fund', 'receipt'] as const).find((k) => k === data.kind);
  const action = (['delete', 'restore', 'purge'] as const).find((a) => a === data.action);
  if (!kind || !action) throw new HttpsError('invalid-argument', 'Please check the entry.');
  requireMember(caller.profile, orgId);

  // Who signs: the person signed in, or a stakeholder picked on this device who types their PIN.
  let signerUid = caller.uid;
  let signer = caller.profile;
  if (typeof data.signerUid === 'string' && data.signerUid !== caller.uid) {
    signerUid = data.signerUid;
    signer = (await db.doc(`users/${signerUid}`).get()).data() as UserProfile;
    if (!signer?.active) throw new HttpsError('permission-denied', 'That person cannot sign this.');
    await verifyPin(signerUid, typeof data.pin === 'string' ? data.pin.trim() : '');
  }
  const withdraw = data.withdraw === true;
  const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';

  const targetRef = db.doc(`organizations/${orgId}/${COLLECTIONS[kind]}/${targetId}`);
  const binRef = db.doc(`organizations/${orgId}/pettyBin/${kind}_${targetId}`);
  const result = await db.runTransaction(async (tx) => {
    const [targetSnap, binSnap] = await Promise.all([tx.get(targetRef), tx.get(binRef)]);
    const target = targetSnap.data();
    if (!target || target.orgId !== orgId) throw new HttpsError('not-found', 'This entry is no longer there.');
    let bin = binSnap.data() as BinEntry | undefined;
    if (!bin) {
      if (target.deletedAt) throw new HttpsError('failed-precondition', 'This entry was deleted before the bin existed.');
      bin = { orgId, kind, targetId, ...(await describe(orgId, kind, target)), state: 'live', motion: null, history: [] };
    }
    const motion = bin.motion;

    if (withdraw) {
      if (!motion) throw new HttpsError('failed-precondition', 'Nothing is waiting here.');
      if (motion.startedBy !== caller.uid && !(caller.profile.permissions ?? []).includes('users.manage')) {
        throw new HttpsError('permission-denied', 'Only whoever asked, or the pastor, can withdraw this.');
      }
      tx.set(binRef, { ...bin, motion: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      return { outcome: 'withdrawn' as const, count: 0, action: motion.action };
    }

    if (motion && motion.action !== action) throw new HttpsError('failed-precondition', `This is already waiting for "${motion.action}". Sign or withdraw that first.`);
    if (!motion && !binActionsFor(bin.state).includes(action)) throw new HttpsError('failed-precondition', 'That cannot be done to this entry now.');
    const sigs = motion?.signatures ?? [];
    if (sigs.some((s) => s.uid === signerUid)) throw new HttpsError('already-exists', `${signer.displayName || signer.email} has already signed this.`);
    // Any petty cash signer may sign; whoever made the entry may also ask to delete it (and counts as the first).
    const mayAsk = !motion && action === 'delete' && ownerOf(kind, target) === signerUid && canAccessOrg(signer, orgId);
    if (!canSign(signer, orgId, 'request') && !mayAsk) throw new HttpsError('permission-denied', 'That person cannot sign this.');
    if (!motion && action === 'delete' && reason.length < 3) throw new HttpsError('invalid-argument', 'Please give a reason for deleting.');

    const sig: BinSignature = { uid: signerUid, name: signer.displayName || signer.email, title: titleOf(signer), at: Timestamp.now() };
    const next = { action, reason: motion?.reason ?? reason, startedBy: motion?.startedBy ?? signerUid, signatures: [...sigs, sig] };
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: signerUid };
    const sole = (signer.permissions ?? []).includes('users.manage') && next.signatures.length < BIN_SIGNATURES_NEEDED;
    if (next.signatures.length < BIN_SIGNATURES_NEEDED && !sole) {
      tx.set(binRef, { ...bin, motion: next, ...stamp });
      return { outcome: 'signed' as const, count: next.signatures.length, action };
    }

    // The second signature: carry it out and keep the record.
    if (action === 'delete') tx.update(targetRef, { deletedAt: FieldValue.serverTimestamp(), deletedBy: signerUid, ...stamp });
    else if (action === 'restore') tx.update(targetRef, { deletedAt: null, deletedBy: null, ...stamp });
    else tx.delete(targetRef);
    tx.set(binRef, {
      ...bin, state: binStateAfter(action), motion: null,
      history: [...bin.history, { action, reason: next.reason, signatures: next.signatures, doneAt: Timestamp.now(), ...(sole ? { sole: true } : {}) }], ...stamp,
    });
    return { outcome: 'done' as const, count: next.signatures.length, action };
  });

  // Deleting forever also removes a receipt's file, or a requisition's receipts and their files.
  if (result.outcome === 'done' && action === 'purge') {
    if (kind === 'receipt') await purgeReceiptFiles(orgId, targetId);
    if (kind === 'request') {
      const receipts = await db.collection(`organizations/${orgId}/pettyReceipts`).where('reqId', '==', targetId).get();
      for (const r of receipts.docs) {
        await purgeReceiptFiles(orgId, r.id);
        await (r.ref as DocumentReference).delete();
      }
    }
  }
  await writeAudit({
    actorUid: signerUid, actorEmail: signer.email, action: `petty_bin_${result.outcome}`, path: targetRef.path, collection: COLLECTIONS[kind], docId: targetId, orgId,
    note: result.outcome === 'done' ? `${BIN_DONE_LABELS[action]}${result.count === 1 ? ' (pastor alone)' : ''}` : `${action} (${result.count} of ${BIN_SIGNATURES_NEEDED})`,
  });
  return result;
});
