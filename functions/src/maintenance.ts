import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_RETENTION_DAYS, retentionDays } from './shared/dataset.js';

export const SOFT_DELETE_RETENTION_DAYS = DEFAULT_RETENTION_DAYS;

/**
 * Every night, permanently removes records that were deleted more than 30 days ago.
 * Organization data collections are added to PURGE_COLLECTIONS as each stage adds them.
 */
export const PURGE_COLLECTIONS: string[] = ['people', 'pipeline', 'prayerRequests', 'pastoralNotes', 'followUps', 'events', 'attendance',
  'programs', 'cohorts', 'enrollments', 'teams', 'teamMembers', 'groups', 'groupMembers'];

export const purgeDeletedRecords = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every day 02:30', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1' },
  async () => {
    const days = retentionDays((await db.doc('settings/retention').get()).get('deletedDays'));
    const cutoff = Timestamp.fromMillis(Date.now() - days * 86_400_000);
    let purged = 0;

    for (const name of PURGE_COLLECTIONS) {
      const old = await db.collectionGroup(name).where('deletedAt', '<', cutoff).limit(400).get();
      const batch = db.batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      if (old.size) await batch.commit();
      purged += old.size;
    }

    const orgs = await db.collection('organizations').where('deletedAt', '<', cutoff).get();
    for (const org of orgs.docs) {
      // The audit trigger records each removed document as a "purge" by the system.
      await db.recursiveDelete(org.ref);
      purged += 1;
    }
    logger.info(`Purged ${purged} records deleted before ${cutoff.toDate().toISOString()}`);
  },
);
