import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE, zonedParts } from './shared/datetime.js';
import { attended } from './shared/attendance.js';
import { absenceToFollowUp, endOfLocalDay, TEMPLATE_FOR_REASON, type FollowUpReason } from './shared/followups.js';

const SYSTEM = 'system';
const DAY = 86_400_000;

async function timeZoneOf(orgId: string): Promise<string> {
  const org = await db.doc(`organizations/${orgId}`).get();
  return (org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE;
}

/** A new follow-up task. A fixed id makes each one safe to create twice. */
export async function createFollowUp(
  orgId: string,
  taskId: string,
  task: { personId: string; personName: string; reason: FollowUpReason; dueAt: Date; absentSince?: string },
): Promise<boolean> {
  const now = FieldValue.serverTimestamp();
  try {
    await db.doc(`organizations/${orgId}/followUps/${taskId}`).create({
      orgId,
      personId: task.personId,
      personName: task.personName,
      reason: task.reason,
      templateId: TEMPLATE_FOR_REASON[task.reason],
      status: 'open',
      assignedTo: null,
      assignedName: null,
      dueAt: Timestamp.fromDate(task.dueAt),
      outcome: null,
      note: '',
      doneAt: null,
      doneBy: null,
      lastMessageAt: null,
      absentSince: task.absentSince ?? null,
      deletedAt: null,
      deletedBy: null,
      createdAt: now,
      createdBy: SYSTEM,
      updatedAt: now,
      updatedBy: SYSTEM,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // 6 = ALREADY_EXISTS
    throw err;
  }
}

/** Closes a task the system can see is no longer needed (for example, the person was baptised). */
async function closeFollowUp(orgId: string, taskId: string, outcome: string): Promise<void> {
  const ref = db.doc(`organizations/${orgId}/followUps/${taskId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') !== 'open' || snap.get('deletedAt') != null) return;
    tx.update(ref, { status: 'done', outcome, doneAt: FieldValue.serverTimestamp(), doneBy: SYSTEM, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
  });
}

// ---- Staff directory ----------------------------------------------------------

function staffEntry(user: DocumentData): DocumentData {
  const permissions = (user.permissions as string[] | undefined) ?? [];
  return {
    displayName: (user.displayName as string | undefined) ?? '',
    active: user.active === true,
    allOrgs: user.allOrgs === true,
    orgIds: (user.orgIds as string[] | undefined) ?? [],
    followUps: permissions.includes('followups.manage'),
    pastoral: permissions.includes('pastoral.read'),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Staff accounts are private (only the pastor reads them), so follow-ups are
 * assigned from this short directory: each person's name, whether they are
 * active, and which organizations they work in. Nothing else is copied.
 */
export const syncStaffDirectory = onDocumentWritten('users/{uid}', async (event) => {
  const ref = db.doc(`staff/${event.params.uid}`);
  const after = event.data?.after.exists ? event.data.after.data() : undefined;
  if (!after) {
    await ref.delete();
    return;
  }
  await ref.set(staffEntry(after));
});

// ---- Salvation and baptism ------------------------------------------------------

const completed = (d: DocumentData | undefined) => !!d && d.deletedAt == null && d.status === 'completed';

/**
 * When someone's salvation is recorded, the pastoral team gets a salvation
 * follow-up and, a week later, an invitation to the baptism class. When their
 * baptism is recorded, the invitation is closed.
 */
export const onPipelineWritten = onDocumentWritten('organizations/{orgId}/pipeline/{entryId}', async (event) => {
  const { orgId } = event.params;
  const before = event.data?.before.exists ? event.data.before.data() : undefined;
  const after = event.data?.after.exists ? event.data.after.data() : undefined;
  if (!after || !completed(after) || completed(before)) return;
  const personId = after.personId as string;

  if (after.stageId === 'baptism') {
    await closeFollowUp(orgId, `${personId}_baptism_invite`, 'Baptised');
    return;
  }
  if (after.stageId !== 'salvation') return;

  const base = `organizations/${orgId}`;
  const [person, baptism, timeZone] = await Promise.all([
    db.doc(`${base}/people/${personId}`).get(),
    db.doc(`${base}/pipeline/${personId}_baptism`).get(),
    timeZoneOf(orgId),
  ]);
  if (!person.exists || person.get('deletedAt') != null) return;
  const personName = (person.get('fullName') as string | undefined) ?? '';
  const now = new Date();
  await createFollowUp(orgId, `${personId}_salvation`, { personId, personName, reason: 'salvation', dueAt: endOfLocalDay(now, timeZone, 1) });
  if (!completed(baptism.exists ? baptism.data() : undefined)) {
    await createFollowUp(orgId, `${personId}_baptism_invite`, { personId, personName, reason: 'baptism_invite', dueAt: endOfLocalDay(now, timeZone, 7) });
  }
});

// ---- Every morning: care messages after 3 weeks absent -------------------------------

/** How far back attendance is read: the 8 weeks before a 3-week absence, and a little more. */
const LOOKBACK_DAYS = 8 * 7 + 21 + 7;

function isoDate(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * For one church campus: regular attenders who haven't been to a service for
 * 3 weeks get a care follow-up, and an open care follow-up closes itself when
 * the person comes back. Returns how many tasks were created.
 */
export async function careFollowUps(orgId: string, timeZone: string, now = new Date()): Promise<{ created: number; closed: number }> {
  const base = `organizations/${orgId}`;
  const since = isoDate(new Date(now.getTime() - LOOKBACK_DAYS * DAY), timeZone);
  const [marks, people, open] = await Promise.all([
    db.collection(`${base}/attendance`).where('date', '>=', since).get(),
    db.collection(`${base}/people`).where('deletedAt', '==', null).get(),
    db.collection(`${base}/followUps`).where('reason', '==', 'care_absent').where('status', '==', 'open').get(),
  ]);

  // Sunday services and other services only: classes and group meetings don't count here.
  const byPerson = new Map<string, { date: string; status: string; deletedAt?: unknown }[]>();
  for (const m of marks.docs) {
    const d = m.data();
    if (d.programId || d.groupId || d.deletedAt != null) continue;
    const list = byPerson.get(d.personId as string) ?? [];
    list.push({ date: d.date as string, status: d.status as string });
    byPerson.set(d.personId as string, list);
  }
  const lastAttended = (personId: string) =>
    (byPerson.get(personId) ?? []).filter((r) => attended(r.status)).map((r) => r.date).sort().pop() ?? null;

  let closed = 0;
  const stillOpen = new Set<string>();
  for (const task of open.docs) {
    const personId = task.get('personId') as string;
    const since = task.get('absentSince') as string | null;
    const last = lastAttended(personId);
    if (task.get('deletedAt') == null && since && last && last > since) {
      await closeFollowUp(orgId, task.id, 'Came back to church');
      closed += 1;
    } else if (task.get('deletedAt') == null) {
      stillOpen.add(personId);
    }
  }

  let created = 0;
  for (const person of people.docs) {
    const status = person.get('status') as string;
    if (status === 'inactive' || stillOpen.has(person.id)) continue;
    const lastDate = absenceToFollowUp(byPerson.get(person.id) ?? [], now, timeZone);
    if (!lastDate) continue;
    const made = await createFollowUp(orgId, `${person.id}_care_${lastDate}`, {
      personId: person.id,
      personName: (person.get('fullName') as string | undefined) ?? '',
      reason: 'care_absent',
      dueAt: endOfLocalDay(now, timeZone),
      absentSince: lastDate,
    });
    if (made) created += 1;
  }
  return { created, closed };
}

/** Keeps the staff directory complete, including accounts made before it existed. */
export async function refreshStaffDirectory(): Promise<number> {
  const users = await db.collection('users').get();
  const batch = db.batch();
  users.docs.forEach((u) => batch.set(db.doc(`staff/${u.id}`), staffEntry(u.data())));
  if (users.size) await batch.commit();
  return users.size;
}

export async function runDailyFollowUps(now = new Date()): Promise<void> {
  const staff = await refreshStaffDirectory();
  const orgs = await db.collection('organizations').where('type', '==', 'church_campus').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false) continue;
    const result = await careFollowUps(org.id, (org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE, now);
    logger.info(`Follow-ups for ${org.id}: ${result.created} care messages due, ${result.closed} closed because the person came back`);
  }
  logger.info(`Staff directory refreshed: ${staff} accounts`);
}

export const dailyFollowUps = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every day 06:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1' },
  () => runDailyFollowUps(),
);
