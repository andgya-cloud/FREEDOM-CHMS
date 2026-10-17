import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './common.js';
import { zonedParts, zonedMidnight, DEFAULT_TIME_ZONE } from './shared/datetime.js';

const SYSTEM = 'system';

function endOfLocalDay(now: Date, timeZone: string): Date {
  const p = zonedParts(now, timeZone);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  // 23:59 local, so it reads as "due today" rather than midnight tomorrow.
  const midnight = zonedMidnight(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), timeZone);
  return new Date(midnight.getTime() - 60_000);
}

/**
 * When a person is added or their phone number changes:
 * - flag anyone else in the organization with the same number as a possible duplicate;
 * - when a new visitor is added, create the same-day welcome follow-up.
 */
export const onPersonWritten = onDocumentWritten('organizations/{orgId}/people/{personId}', async (event) => {
  const { orgId, personId } = event.params;
  const before = event.data?.before.exists ? event.data.before.data() : undefined;
  const after = event.data?.after.exists ? event.data.after.data() : undefined;
  if (!after) return;

  const created = !before;
  const phoneChanged = created || before?.phone !== after.phone;
  const ref = event.data!.after.ref;

  if (phoneChanged) {
    const others = after.phone
      ? (await db.collection(`organizations/${orgId}/people`).where('phone', '==', after.phone).get()).docs
          .filter((d) => d.id !== personId && d.get('deletedAt') == null)
      : [];
    const ids = others.map((d) => d.id).sort();
    const current = ((after.possibleDuplicateIds as string[] | undefined) ?? []).slice().sort();
    const batch = db.batch();
    if (JSON.stringify(ids) !== JSON.stringify(current)) {
      batch.update(ref, { possibleDuplicateIds: ids, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
    }
    for (const other of others) {
      if (!((other.get('possibleDuplicateIds') as string[] | undefined) ?? []).includes(personId)) {
        batch.update(other.ref, { possibleDuplicateIds: FieldValue.arrayUnion(personId), updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
      }
    }
    await batch.commit();
  }

  if (created && after.status === 'visitor' && after.deletedAt == null) {
    const org = await db.doc(`organizations/${orgId}`).get();
    const timeZone = (org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE;
    // A fixed id makes this safe to run twice.
    await db.doc(`organizations/${orgId}/followUps/${personId}_first_visit`).create({
      orgId,
      personId,
      personName: after.fullName ?? '',
      reason: 'first_visit',
      templateId: 'visitor_welcome',
      status: 'open',
      assignedTo: null,
      dueAt: Timestamp.fromDate(endOfLocalDay(new Date(), timeZone)),
      outcome: null,
      deletedAt: null,
      deletedBy: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: SYSTEM,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM,
    }).catch((err: { code?: number }) => {
      if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
    });
  }
});
