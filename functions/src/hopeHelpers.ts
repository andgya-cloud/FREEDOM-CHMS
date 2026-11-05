import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common.js';

const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');

/**
 * A helper's "I'm here" also marks them on the Champions register (Andy, 2026-11-05, v173 4A). The helper is
 * matched to a champion by name the first time (or added as a new champion with the duty "Helper"), and the link
 * is kept in hopeMeta/helperChampions. A mark already on the Champions register is never changed.
 */
export const hopeHelperToChampion = onDocumentWritten('organizations/{orgId}/helperDays/{day}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const { orgId, day } = event.params;
  const before = (event.data?.before?.data()?.marks ?? {}) as Record<string, unknown>;
  const marks = (after.get('marks') ?? {}) as Record<string, { name?: string; t?: string }>;
  const fresh = Object.entries(marks).filter(([uid]) => !before[uid]);
  if (!fresh.length || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const base = `organizations/${orgId}`;
  const linkRef = db.doc(`${base}/hopeMeta/helperChampions`);
  const [linkSnap, champs] = await Promise.all([linkRef.get(), db.collection(`${base}/champions`).get()]);
  const links = { ...((linkSnap.data()?.links ?? {}) as Record<string, string>) };
  const live = champs.docs.filter((d) => !d.get('deletedAt'));
  const byName = new Map(live.map((d) => [plain(String(d.get('name') ?? '')), d.id]));
  const liveIds = new Set(live.map((d) => d.id));
  const dayRef = db.doc(`${base}/championDays/${day}`);
  const marked = ((await dayRef.get()).data()?.marks ?? {}) as Record<string, unknown>;
  const add: Record<string, unknown> = {};
  for (const [uid, m] of fresh) {
    const name = String(m.name ?? '').trim().slice(0, 120);
    let id = links[uid] && liveIds.has(links[uid]!) ? links[uid]! : byName.get(plain(name));
    if (!id) {
      if (name.length < 2) continue;
      const ref = db.collection(`${base}/champions`).doc();
      await ref.set({ orgId, name, phone: '', email: '', duty: 'Helper', status: 'active', joinedOn: day,
        createdAt: FieldValue.serverTimestamp(), createdBy: uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
      id = ref.id;
      byName.set(plain(name), id);
    }
    links[uid] = id;
    if (!marked[id]) add[id] = { s: 'present', in: /^\d{2}:\d{2}$/.test(String(m.t)) ? m.t : null, duty: null, r: null };
  }
  await linkRef.set({ links, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (Object.keys(add).length) {
    await dayRef.set({ orgId, date: day, marks: add, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'helper-check-in' }, { merge: true });
  }
});
