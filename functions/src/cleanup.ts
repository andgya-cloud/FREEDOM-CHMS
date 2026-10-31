import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { db, FieldValue, requireCaller, requireString, type Caller } from './common.js';
import { verifyPin } from './pettyPins.js';
import { canAccessOrg, canKeepAccounts, isDirectorProfile } from './shared/permissions.js';
import { localDateKey } from './shared/datetime.js';
import {
  BIN_DAYS, KINDS, MAX_ITEMS, MAX_LINKED, daysLeft, describeEntry, isCleanupKind, isOfficial, linkedSummary, looksLikeTest, matchesText,
  type CleanupBinEntry, type CleanupKind,
} from './shared/cleanup.js';

/**
 * Clean-up (Andy, 2026-10-30): find, remove and put back entries. Only Andrew Guya and Doreen use it;
 * money and official records need the Director (Andy) and his password. Removing marks the entry and
 * everything linked to it as deleted (so every list, total and report leaves it out) and keeps a
 * Recycle Bin record of exactly which records it marked, so putting it back restores exactly those.
 */
const CALLABLE = { invoker: 'public', memory: '512MiB', timeoutSeconds: 120 } as const;
const BIN = (orgId: string) => db.collection(`organizations/${orgId}/cleanupBin`);

function requireKeeper(caller: Caller, orgId: string) {
  if (!canKeepAccounts(caller.profile)) throw new HttpsError('permission-denied', 'Only Andrew Guya and Doreen can clean up entries.');
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You cannot reach this organization.');
}

const isDeleted = (d: FirebaseFirestore.DocumentData | undefined) => !!d && d.deletedAt != null;
const millis = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);

async function namesOf(uids: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set([...uids].filter((u) => u && u !== 'system'))];
  const out = new Map<string, string>([['system', 'System']]);
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db.getAll(...ids.slice(i, i + 100).map((u) => db.doc(`users/${u}`)));
    snaps.forEach((s) => { if (s.exists) out.set(s.id, String(s.get('displayName') || s.get('email') || '')); });
  }
  return out;
}

function readItems(value: unknown): { kind: CleanupKind; id: string }[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ITEMS) throw new HttpsError('invalid-argument', `Choose between 1 and ${MAX_ITEMS} entries.`);
  const seen = new Set<string>();
  return value.map((v) => {
    const kind = (v as { kind?: unknown })?.kind;
    const id = (v as { id?: unknown })?.id;
    if (!isCleanupKind(kind) || typeof id !== 'string' || !id || id.length > 200 || id.includes('/')) throw new HttpsError('invalid-argument', 'Please check the entries.');
    return { kind, id };
  }).filter((i) => !seen.has(`${i.kind}/${i.id}`) && !!seen.add(`${i.kind}/${i.id}`));
}

/** Everything linked to an entry that is not already deleted, labelled for the "this also removes" line. */
async function linkedOf(orgId: string, kind: CleanupKind, id: string) {
  const found = new Map<string, { ref: DocumentReference; snap: DocumentSnapshot; label: string; official: boolean }>();
  for (const l of KINDS[kind].linked) {
    const snaps = l.field === 'id'
      ? [await db.doc(`organizations/${orgId}/${l.collection}/${id}`).get()].filter((s) => s.exists)
      : (await db.collection(`organizations/${orgId}/${l.collection}`).where(l.field, '==', id).get()).docs;
    for (const s of snaps) {
      if (isDeleted(s.data()) || found.has(s.ref.path)) continue;
      found.set(s.ref.path, { ref: s.ref, snap: s, label: l.label, official: !!l.official });
    }
    if (found.size > MAX_LINKED) throw new HttpsError('resource-exhausted', 'This entry has too many linked records to remove in one go.');
  }
  const counts: Record<string, number> = {};
  for (const f of found.values()) counts[f.label] = (counts[f.label] ?? 0) + 1;
  return { docs: [...found.values()], counts, official: [...found.values()].some((f) => f.official) };
}

async function inspect(orgId: string, kind: CleanupKind, id: string) {
  const snap = await db.doc(`organizations/${orgId}/${KINDS[kind].collection}/${id}`).get();
  const data = snap.data();
  if (!snap.exists || !data) throw new HttpsError('not-found', 'One of these entries is no longer there.');
  if (isDeleted(data)) throw new HttpsError('failed-precondition', `"${describeEntry(kind, id, data).label}" has already been removed.`);
  const linked = await linkedOf(orgId, kind, id);
  const { label, detail } = describeEntry(kind, id, data);
  return { snap, data, label, detail, linked, official: isOfficial(kind, data) || linked.official };
}

/** Lists entries of one type, newest first, filtered by words, the dates they were made, and test-looking names. */
export const cleanupFind = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  requireKeeper(caller, orgId);
  if (!isCleanupKind(data.kind)) throw new HttpsError('invalid-argument', 'Choose a type of entry.');
  const kind = data.kind;
  const text = typeof data.text === 'string' ? data.text.slice(0, 80) : '';
  const from = typeof data.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.from) ? data.from : '';
  const to = typeof data.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.to) ? data.to : '';
  const testOnly = data.testOnly === true;

  const snaps = (await db.collection(`organizations/${orgId}/${KINDS[kind].collection}`).get()).docs.filter((s) => !isDeleted(s.data()));
  const rows = snaps.map((s) => {
    const d = s.data();
    const at = millis(d.createdAt);
    return { id: s.id, ...describeEntry(kind, s.id, d), createdAt: at, made: at ? localDateKey(new Date(at)) : '', createdBy: String(d.createdBy ?? ''), official: isOfficial(kind, d) };
  }).filter((r) => matchesText(r.label, r.detail, text)
    && (!from || (r.made && r.made >= from)) && (!to || (r.made && r.made <= to))
    && (!testOnly || looksLikeTest(r.label, r.detail)));
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.label.localeCompare(b.label));
  const shown = rows.slice(0, 300);
  const names = await namesOf(shown.map((r) => r.createdBy));
  return { total: rows.length, rows: shown.map(({ createdBy, made: _made, ...r }) => ({ ...r, createdByName: names.get(createdBy) ?? '' })) };
});

/** Before removing: what each entry is, what else goes with it, and whether it needs the Director's password. */
export const cleanupCheck = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  requireKeeper(caller, orgId);
  const items = readItems(data.items);
  const out = [];
  for (const { kind, id } of items) {
    const e = await inspect(orgId, kind, id);
    out.push({ kind, id, label: e.label, detail: e.detail, official: e.official, linked: e.linked.counts, linkedText: linkedSummary(e.linked.counts) });
  }
  return { items: out, isDirector: isDirectorProfile(caller.profile) };
});

/** Removes entries (with their linked records) to the Recycle Bin. */
export const cleanupDelete = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  requireKeeper(caller, orgId);
  const items = readItems(data.items);
  const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
  const checked = [];
  for (const { kind, id } of items) checked.push({ kind, id, ...(await inspect(orgId, kind, id)) });

  if (checked.some((c) => c.official)) {
    if (!isDirectorProfile(caller.profile)) throw new HttpsError('permission-denied', 'Money and official records can only be removed by Andrew Guya.');
    if (!reason) throw new HttpsError('invalid-argument', 'Please give a reason for removing money or official records.');
    const proof = typeof data.proof === 'string' ? data.proof : '';
    if (!proof.startsWith('idtoken:')) throw new HttpsError('permission-denied', 'Please type your password to remove money or official records.');
    await verifyPin(caller.uid, proof);
  }

  const at = Timestamp.now();
  const name = caller.profile.displayName || caller.email;
  const binIds: string[] = [];
  for (const c of checked) {
    const docs = [{ ref: c.snap.ref, snap: c.snap }, ...c.linked.docs];
    const refs = docs.map((d) => d.ref.path.split('/').slice(2).join('/'));
    // Records that never had a deletedAt field get it taken off again when put back, so their own forms still save.
    const bare = docs.filter((d) => !('deletedAt' in (d.snap.data() ?? {}))).map((d) => d.ref.path.split('/').slice(2).join('/'));
    const binRef = BIN(orgId).doc();
    const entry: CleanupBinEntry & Record<string, unknown> = {
      orgId, kind: c.kind, targetId: c.id, label: c.label, detail: c.detail, official: c.official, refs, linked: c.linked.counts,
      reason, deletedBy: caller.uid, deletedByName: name, state: 'bin', bare, deletedAt: at, foreverAt: null, restoredAt: null, restoredBy: null, restoredByName: null,
    };
    if (KINDS[c.kind].fixedId) {
      // Kept whole in the bin record, so the same month or form can be made again (Andy can still put this one back).
      await db.runTransaction(async (tx) => {
        tx.set(binRef, { ...entry, copy: c.data });
        tx.delete(c.snap.ref);
      });
      binIds.push(binRef.id);
      continue;
    }
    await binRef.set(entry);
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 400)) batch.update(d.ref, { deletedAt: at, deletedBy: caller.uid, updatedAt: at, updatedBy: caller.uid });
      await batch.commit();
    }
    binIds.push(binRef.id);
  }
  logger.info(`Clean-up: ${name} removed ${checked.length} entries from ${orgId}`);
  return { removed: checked.length, binIds };
});

/** Puts entries back, exactly as they were: only the records this removal marked, and only if nothing else changed them since. */
export const cleanupRestore = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  requireKeeper(caller, orgId);
  if (!Array.isArray(data.binIds) || !data.binIds.length || data.binIds.length > MAX_ITEMS || !data.binIds.every((b) => typeof b === 'string' && b && !b.includes('/'))) {
    throw new HttpsError('invalid-argument', 'Choose what to put back.');
  }
  const now = Timestamp.now();
  const name = caller.profile.displayName || caller.email;
  let restored = 0;
  for (const binId of data.binIds as string[]) {
    const binRef = BIN(orgId).doc(binId);
    const entry = (await binRef.get()).data() as (CleanupBinEntry & { deletedAt: Timestamp; bare?: string[] }) | undefined;
    if (!entry || entry.state === 'restored') continue;
    if (entry.official && !isDirectorProfile(caller.profile)) throw new HttpsError('permission-denied', `Only Andrew Guya can put back "${entry.label}".`);
    const copy = (entry as { copy?: FirebaseFirestore.DocumentData }).copy;
    if (copy) {
      const target = db.doc(`organizations/${orgId}/${entry.refs[0]}`);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(target)).exists) throw new HttpsError('already-exists', `"${entry.label}" has been made again since it was removed, so the old one cannot come back.`);
        tx.set(target, { ...copy, updatedAt: now, updatedBy: caller.uid });
        tx.update(binRef, { state: 'restored', restoredAt: now, restoredBy: caller.uid, restoredByName: name });
      });
      restored += 1;
      continue;
    }
    const bare = new Set(entry.bare ?? []);
    const refs = entry.refs.map((r) => db.doc(`organizations/${orgId}/${r}`));
    for (let i = 0; i < refs.length; i += 300) {
      const part = refs.slice(i, i + 300);
      const snaps = await db.getAll(...part);
      const batch = db.batch();
      snaps.forEach((s, j) => {
        const d = s.data();
        // Only what this removal marked; something deleted again later (or re-made) is left alone.
        if (!d || d.deletedBy !== entry.deletedBy || !(d.deletedAt instanceof Timestamp) || !d.deletedAt.isEqual(entry.deletedAt)) return;
        const rel = entry.refs[i + j];
        batch.update(part[j], bare.has(rel)
          ? { deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(), updatedAt: now, updatedBy: caller.uid }
          : { deletedAt: null, deletedBy: null, updatedAt: now, updatedBy: caller.uid });
      });
      await batch.commit();
    }
    await binRef.update({ state: 'restored', restoredAt: now, restoredBy: caller.uid, restoredByName: name });
    restored += 1;
  }
  return { restored };
});

/** The Recycle Bin and Forever for Andrew Guya and Doreen; the Director also gets the full deletion register. */
export const cleanupBin = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  requireKeeper(caller, orgId);
  const director = isDirectorProfile(caller.profile);
  const snaps = (await BIN(orgId).orderBy('deletedAt', 'desc').limit(1000).get()).docs;
  const entries = snaps.map((s) => {
    const d = s.data();
    const deletedAt = millis(d.deletedAt) ?? 0;
    return {
      id: s.id, kind: d.kind, label: d.label, detail: d.detail, official: !!d.official, linkedText: linkedSummary(d.linked ?? {}),
      reason: d.reason ?? '', deletedByName: d.deletedByName ?? '', deletedAt, state: d.state, daysLeft: d.state === 'bin' ? daysLeft(deletedAt) : null,
      restoredAt: millis(d.restoredAt), restoredByName: d.restoredByName ?? null,
    };
  });
  return { entries: director ? entries : entries.filter((e) => e.state !== 'restored'), isDirector: director, binDays: BIN_DAYS };
});

/** Every night: Recycle Bin entries older than 30 days move to Forever (kept, only Andrew Guya and Doreen see them). */
export const cleanupToForever = onSchedule(
  { schedule: 'every day 02:15', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1' },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - BIN_DAYS * 86_400_000);
    let moved = 0;
    for (const org of (await db.collection('organizations').get()).docs) {
      const old = (await BIN(org.id).where('state', '==', 'bin').get()).docs.filter((d) => (millis(d.get('deletedAt')) ?? 0) < cutoff.toMillis());
      for (let i = 0; i < old.length; i += 400) {
        const batch = db.batch();
        old.slice(i, i + 400).forEach((d) => batch.update(d.ref, { state: 'forever', foreverAt: FieldValue.serverTimestamp() }));
        await batch.commit();
      }
      moved += old.length;
    }
    logger.info(`Clean-up: ${moved} entries moved to Forever`);
  },
);

/** Paths (full document paths) kept by the Recycle Bin or Forever, which the nightly purge must never erase. */
export async function keptByCleanup(): Promise<Set<string>> {
  const kept = new Set<string>();
  for (const org of (await db.collection('organizations').get()).docs) {
    const snaps = await BIN(org.id).where('state', 'in', ['bin', 'forever']).get();
    for (const s of snaps.docs) for (const r of (s.get('refs') as string[] | undefined) ?? []) kept.add(`organizations/${org.id}/${r}`);
  }
  return kept;
}
