import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';
import { gzipSync } from 'node:zlib';
import { db, FieldValue, writeAudit, type UserProfile } from './common.js';
import { isTraining, TRAINING_ORG_ID } from './shared/organizations.js';
import { TRAINING_ORG, trainingDocs } from './shared/training.js';
import { todayIn } from './reports.js';
import { can } from './shared/permissions.js';
import {
  anonymisedGift,
  backupPath,
  backupsToRemove,
  FINANCIAL_PERSON_COLLECTIONS,
  ORG_COLLECTIONS,
  PERSON_COLLECTIONS,
  toPlain,
} from './shared/dataset.js';

const SYSTEM = 'system';
const BATCH = 400;

async function deleteAll(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    refs.slice(i, i + BATCH).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Removes a person from an organization. Money records are kept for the accounts but no longer name them. */
export async function erasePerson(orgId: string, personId: string): Promise<Record<string, number>> {
  const base = db.doc(`organizations/${orgId}`);
  const counts: Record<string, number> = {};
  for (const name of PERSON_COLLECTIONS) {
    const found = await base.collection(name).where('personId', '==', personId).get();
    counts[name] = found.size;
    await deleteAll(found.docs.map((d) => d.ref));
  }
  for (const name of FINANCIAL_PERSON_COLLECTIONS) {
    const found = await base.collection(name).where('personId', '==', personId).get();
    counts[name] = found.size;
    for (let i = 0; i < found.docs.length; i += BATCH) {
      const batch = db.batch();
      found.docs.slice(i, i + BATCH).forEach((d) => batch.update(d.ref, { ...anonymisedGift(), updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM }));
      await batch.commit();
    }
  }
  // Other people's links to them (a child's guardian, who invited whom) are cleared, not deleted.
  for (const field of ['guardianId', 'invitedById']) {
    const linked = await base.collection('people').where(field, '==', personId).get();
    for (const d of linked.docs) await d.ref.update({ [field]: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
  }
  await base.collection('people').doc(personId).delete();
  counts.people = 1;
  return counts;
}

/** Practice mode: wipes the practice organization and fills it with fresh sample data. Real organizations are never touched. */
export async function resetTraining(): Promise<number> {
  const org = db.doc(`organizations/${TRAINING_ORG_ID}`);
  for (const col of await org.listCollections()) {
    if (col.id !== 'dataRequests') await db.recursiveDelete(col);
  }
  const stamp = () => FieldValue.serverTimestamp();
  await org.set({ ...TRAINING_ORG, deletedAt: null, deletedBy: null, createdAt: stamp(), createdBy: SYSTEM, updatedAt: stamp(), updatedBy: SYSTEM });
  const docs = trainingDocs(todayIn(TRAINING_ORG.timeZone, new Date()), stamp);
  const writer = db.bulkWriter();
  docs.forEach((d) => void writer.set(db.doc(d.path), d.data));
  await writer.close();
  return docs.length;
}

/**
 * "Download everything" and "Export or erase one person" in the app write a request here, so every one
 * is logged. Exports are built on the pastor's own device once this marks the request done.
 */
export const onDataRequested = onDocumentCreated(
  { document: 'organizations/{orgId}/dataRequests/{requestId}', memory: '512MiB', timeoutSeconds: 300 },
  async (event) => {
    const { orgId, requestId } = event.params;
    const req = event.data?.data();
    if (!req || !event.data) return;
    const fail = (error: string) => event.data!.ref.update({ status: 'failed', error, doneAt: FieldValue.serverTimestamp() });
    try {
      const by = req.createdBy as string;
      const profile = (await db.doc(`users/${by}`).get()).data() as UserProfile | undefined;
      if (!profile?.active || !can(profile, 'data.export')) return void (await fail('Only the pastor can do that.'));
      const kind = req.kind as string;
      const personId = (req.personId as string | null) ?? null;
      if (kind === 'reset_training') {
        if (orgId !== TRAINING_ORG_ID) return void (await fail('Practice data lives only in the practice organization.'));
        await resetTraining();
        await writeAudit({ actorUid: by, actorEmail: profile.email, action: 'reset', path: `organizations/${orgId}/dataRequests/${requestId}`, collection: 'organizations', docId: orgId, orgId, note: 'reset_training' });
        return void (await event.data.ref.update({ status: 'done', counts: null, doneAt: FieldValue.serverTimestamp() }));
      }
      if (kind !== 'export_all' && kind !== 'export_person' && kind !== 'erase_person') return void (await fail('Unknown request.'));
      if (kind !== 'export_all' && !personId) return void (await fail('Choose a person first.'));
      if (personId && !(await db.doc(`organizations/${orgId}/people/${personId}`).get()).exists) return void (await fail('That person was not found.'));

      const counts = kind === 'erase_person' ? await erasePerson(orgId, personId!) : null;

      await writeAudit({
        actorUid: by, actorEmail: profile.email, action: kind === 'erase_person' ? 'erase' : 'export',
        path: `organizations/${orgId}/dataRequests/${requestId}`, collection: personId ? 'people' : 'organizations',
        docId: personId ?? orgId, orgId, note: kind,
      });
      await event.data.ref.update({ status: 'done', counts, doneAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error(`Data request ${requestId} failed`, err);
      await fail('That could not be done. Please try again.');
    }
  },
);

// ---- Weekly backup ----------------------------------------------------------------------------

async function readCollection(ref: FirebaseFirestore.CollectionReference) {
  const snap = await ref.get();
  return snap.docs.map((d) => ({ id: d.id, ...(toPlain(d.data()) as object) }));
}

/** Everything in the database as one object (real organizations only, not the training one). */
export async function snapshotAll(): Promise<{ data: Record<string, unknown>; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  const data: Record<string, unknown> = { takenAt: new Date().toISOString() };
  for (const top of ['users', 'staff', 'roles', 'settings', 'auditLog']) {
    const rows = await readCollection(db.collection(top));
    data[top] = rows;
    counts[top] = rows.length;
  }
  const orgs: Record<string, unknown> = {};
  for (const org of (await db.collection('organizations').get()).docs) {
    if (isTraining({ id: org.id, training: org.get('training') })) continue;
    const sub: Record<string, unknown> = {};
    for (const name of ORG_COLLECTIONS) {
      const rows = await readCollection(org.ref.collection(name));
      sub[name] = rows;
      counts[`${org.id}/${name}`] = rows.length;
    }
    orgs[org.id] = { id: org.id, ...(toPlain(org.data()) as object), collections: sub };
  }
  data.organizations = orgs;
  return { data, counts };
}

export async function runBackup(now = new Date()): Promise<{ file: string; bytes: number; removed: number }> {
  const bucket = getStorage().bucket();
  const { data, counts } = await snapshotAll();
  const file = backupPath(now.toISOString().slice(0, 10));
  const body = gzipSync(Buffer.from(JSON.stringify(data)));
  await bucket.file(file).save(body, { contentType: 'application/gzip', resumable: false });
  const [files] = await bucket.getFiles({ prefix: 'backups/' });
  const old = backupsToRemove(files.map((f) => f.name));
  await Promise.all(old.map((n) => bucket.file(n).delete()));
  await db.doc('settings/backupStatus').set({ ok: true, lastAt: FieldValue.serverTimestamp(), file, bytes: body.length, records: Object.values(counts).reduce((a, b) => a + b, 0), error: null });
  return { file, bytes: body.length, removed: old.length };
}

/** Every Sunday at 23:00 Nairobi time. The result, good or bad, is shown in Settings → Data and backups. */
export const weeklyBackup = onSchedule(
  { schedule: 'every sunday 23:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', memory: '1GiB', timeoutSeconds: 540 },
  async () => {
    try {
      const r = await runBackup();
      logger.info(`Backup saved: ${r.file} (${r.bytes} bytes), ${r.removed} old removed`);
    } catch (err) {
      logger.error('Weekly backup failed', err);
      await db.doc('settings/backupStatus').set({ ok: false, lastAt: FieldValue.serverTimestamp(), error: 'The last backup did not work. Check that Storage is switched on in Firebase.' }, { merge: true });
    }
  },
);
