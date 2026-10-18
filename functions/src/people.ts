import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { endOfLocalDay } from './shared/followups.js';
import { createFollowUp } from './followups.js';

const SYSTEM = 'system';

/**
 * When a person is added or their phone number changes:
 * - flag anyone else in the organization with the same number as a possible duplicate;
 * - when a new visitor is added, create the same-day welcome and the 48-hour check-in follow-ups.
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
    const timeZone = ((await db.doc(`organizations/${orgId}`).get()).get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE;
    const now = new Date();
    const task = { personId, personName: (after.fullName as string | undefined) ?? '' };
    // A welcome the same day, then a check-in two days later.
    await createFollowUp(orgId, `${personId}_first_visit`, { ...task, reason: 'first_visit', dueAt: endOfLocalDay(now, timeZone) });
    await createFollowUp(orgId, `${personId}_48h`, { ...task, reason: 'checkin_48h', dueAt: endOfLocalDay(now, timeZone, 2) });
  }
});
