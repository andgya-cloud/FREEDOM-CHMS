import { onDocumentWritten, type FirestoreEvent, type Change, type DocumentSnapshot } from 'firebase-functions/v2/firestore';
import { db, writeAudit } from './common.js';
import { changedFields, classifyWrite } from './shared/audit.js';

type Data = Record<string, unknown>;

const emailCache = new Map<string, string | null>();
async function emailFor(uid: string | null): Promise<string | null> {
  if (!uid) return null;
  if (!emailCache.has(uid)) {
    const snap = await db.doc(`users/${uid}`).get();
    emailCache.set(uid, (snap.get('email') as string | undefined) ?? null);
  }
  return emailCache.get(uid) ?? null;
}

async function record(
  event: FirestoreEvent<Change<DocumentSnapshot> | undefined, Record<string, string>>,
  collection: string,
  docId: string,
  orgId: string | null,
) {
  const before = event.data?.before.exists ? (event.data.before.data() as Data) : undefined;
  const after = event.data?.after.exists ? (event.data.after.data() as Data) : undefined;
  const action = classifyWrite(before, after);
  const fields = changedFields(before, after);
  if (action === 'update' && fields.length === 0) return;
  const stampedBy = (after?.updatedBy as string | undefined) ?? null;
  const bySystem = action === 'purge' || stampedBy === 'system';
  const actorUid = bySystem ? null : stampedBy;
  await writeAudit({
    actorUid,
    actorEmail: bySystem ? 'system' : await emailFor(actorUid),
    action,
    path: event.document,
    collection,
    docId,
    orgId,
    changedFields: action === 'create' ? [] : fields,
  });
}

export const auditOrganizations = onDocumentWritten('organizations/{orgId}', (event) =>
  record(event, 'organizations', event.params.orgId, event.params.orgId),
);

export const auditOrganizationData = onDocumentWritten('organizations/{orgId}/{collection}/{docId}', (event) =>
  record(event, event.params.collection, event.params.docId, event.params.orgId),
);

export const auditRoles = onDocumentWritten('roles/{roleId}', (event) =>
  record(event, 'roles', event.params.roleId, null),
);

export const auditSettings = onDocumentWritten('settings/{settingId}', (event) =>
  record(event, 'settings', event.params.settingId, null),
);
