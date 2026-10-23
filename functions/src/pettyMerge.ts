import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { auth, db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { isPettyTitle } from './shared/permissions.js';

/**
 * One person, one account (Andy, 2026-10-23: "Andy and Andrew Guya are the same person"). The pastor
 * renames their own account and sets their signing title, and every petty cash record they raised or
 * signed is changed to match. An extra account of theirs can be folded in: its requests, signatures and
 * bin steps become the pastor's, and it is switched off. A request both accounts signed is reported,
 * since it then has one signature fewer.
 */
type Sig = { name?: string; role?: string; at?: unknown };
type BinSig = { uid: string; name: string; title: string; at: unknown };

export const mergeMyAccount = onCall({ invoker: 'public', timeoutSeconds: 300 }, async (request) => {
  const caller = await requireCaller(request, 'users.manage');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const name = requireString(data.name, 'your name', { min: 2, max: 80 });
  const title = data.title;
  if (!isPettyTitle(title)) throw new HttpsError('invalid-argument', 'Choose your title.');
  const me = caller.uid;
  const fromUid = typeof data.fromUid === 'string' && data.fromUid ? data.fromUid : null;
  if (fromUid === me) throw new HttpsError('invalid-argument', 'Choose another account to fold in.');
  if (fromUid && !(await db.doc(`users/${fromUid}`).get()).exists) throw new HttpsError('not-found', 'That account does not exist.');

  const who = (uid: unknown) => (uid === fromUid ? me : uid);
  const conflicts: string[] = [];
  let changed = 0;
  let batch = db.batch();
  let inBatch = 0;
  const write = async (ref: FirebaseFirestore.DocumentReference, update: Record<string, unknown>) => {
    batch.update(ref, update);
    changed += 1;
    if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  };
  /** A signatures map with the extra account's key moved to mine and my entries renamed. */
  const remap = (sigs: Record<string, Sig> | undefined, withRole: boolean, label: string) => {
    if (!sigs) return { out: sigs, touched: false };
    const out: Record<string, Sig> = {};
    let touched = false;
    for (const [uid, s] of Object.entries(sigs)) {
      const to = who(uid) as string;
      const mine = to === me ? { ...s, name, ...(withRole && s.role !== 'Accountant' ? { role: title } : {}) } : s;
      if (to !== uid || JSON.stringify(mine) !== JSON.stringify(s)) touched = true;
      if (to in out) { conflicts.push(`${label} (signed by both accounts; one signature removed)`); continue; }
      out[to] = mine;
    }
    return { out, touched };
  };
  const signOff = (o: { uid?: string; name?: string; role?: string } | null | undefined) => {
    if (!o || who(o.uid) !== me) return null;
    return { ...o, uid: me, name, ...(o.role && o.role !== 'Accountant' ? { role: title } : {}) };
  };

  const orgs = await db.collection('organizations').get();
  for (const o of orgs.docs) {
    for (const d of (await db.collection(`organizations/${o.id}/pettyCash`).get()).docs) {
      const r = d.data();
      const u: Record<string, unknown> = {};
      if (r.requesterId === fromUid) u.requesterId = me;
      if (who(r.requesterId) === me && r.requesterName !== name) u.requesterName = name;
      if (r.raisedBy === fromUid) u.raisedBy = me;
      if (who(r.raisedBy) === me && r.raisedByName && r.raisedByName !== name) u.raisedByName = name;
      if (r.createdBy === fromUid) u.createdBy = me;
      const s = remap(r.signatures, true, `${r.number ?? d.id}`);
      if (s.touched) u.signatures = s.out;
      if (s.out && who(r.requesterId) === me && me in s.out) conflicts.push(`${r.number ?? d.id} (you both raised and signed it)`);
      for (const k of ['approved', 'checked'] as const) { const x = signOff(r[k]); if (x) u[k] = x; }
      if (r.rejection && who(r.rejection.uid) === me) u.rejection = { ...r.rejection, uid: me, name };
      if (Object.keys(u).length) await write(d.ref, u);
    }
    for (const d of (await db.collection(`organizations/${o.id}/pettyFunds`).get()).docs) {
      const r = d.data();
      const u: Record<string, unknown> = {};
      if (r.createdBy === fromUid) u.createdBy = me;
      const s = remap(r.signatures, false, `a ${r.kind === 'reset' ? 'budget reset' : 'top-up'}`);
      if (s.touched) u.signatures = s.out;
      if (Object.keys(u).length) await write(d.ref, u);
    }
    for (const d of (await db.collection(`organizations/${o.id}/pettyReceipts`).where('createdBy', '==', fromUid ?? '-').get()).docs) {
      await write(d.ref, { createdBy: me });
    }
    for (const d of (await db.collection(`organizations/${o.id}/pettyBin`).get()).docs) {
      const b = d.data();
      const fix = (list: BinSig[]) => list.map((x) => (who(x.uid) === me ? { ...x, uid: me, name, title } : x));
      const history = (b.history ?? []).map((h: { signatures: BinSig[] }) => ({ ...h, signatures: fix(h.signatures ?? []) }));
      const motion = b.motion ? { ...b.motion, startedBy: who(b.motion.startedBy), signatures: fix(b.motion.signatures ?? []) } : null;
      if (JSON.stringify(history) !== JSON.stringify(b.history ?? []) || JSON.stringify(motion) !== JSON.stringify(b.motion ?? null)) await write(d.ref, { history, motion });
    }
  }
  if (inBatch) await batch.commit();

  await db.doc(`users/${me}`).update({ displayName: name, pettyTitle: title, updatedAt: FieldValue.serverTimestamp(), updatedBy: me });
  await auth.updateUser(me, { displayName: name }).catch(() => undefined);
  let folded: string | null = null;
  if (fromUid) {
    const old = (await db.doc(`users/${fromUid}`).get()).data() as UserProfile;
    folded = old.displayName || old.email;
    await db.doc(`users/${fromUid}`).update({ active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: me });
    await auth.updateUser(fromUid, { disabled: true }).catch(() => undefined);
    await db.doc(`pettyPins/${fromUid}`).delete().catch(() => undefined);
  }
  await writeAudit({
    actorUid: me, actorEmail: caller.email, action: 'petty_merge_account', path: `users/${me}`, collection: 'users', docId: me, orgId: null,
    note: `${changed} records${folded ? `, folded in ${folded}` : ''}${conflicts.length ? `, signed twice: ${conflicts.join(', ')}` : ''}`,
  });
  return { changed, folded, conflicts: [...new Set(conflicts)] };
});
