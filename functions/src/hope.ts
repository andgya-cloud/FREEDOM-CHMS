import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { activitiesFor } from './shared/attendance.js';
import { periodFor, periodLabel, type ReportType } from './shared/metrics.js';
import { reportsDue } from './shared/reports.js';
import { isTraining, type OrganizationType } from './shared/organizations.js';
import { endOfLocalDay } from './shared/followups.js';
import {
  absencesDue, buildHopeReport, CAME_BACK, childCode, programmeOfTask,
  type Child, type HopeInput, type HopeReportDoc, type SessionEvent, type SessionRecord,
} from './shared/hope.js';
import { closeFollowUp, createFollowUp } from './followups.js';
import { todayIn } from './reports.js';

const SYSTEM = 'system';
const system = () => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
const rows = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });

/**
 * A newly registered child gets the next code (HC-0042) once, in a transaction, so codes are
 * sequential and never reused. Their person record is marked as a child, which is how WhatsApp
 * messages are sent to the guardian and never to the child.
 */
export const onChildCreated = onDocumentCreated('organizations/{orgId}/children/{childId}', async (event) => {
  const { orgId, childId } = event.params;
  const childRef = db.doc(`organizations/${orgId}/children/${childId}`);
  const counterRef = db.doc(`organizations/${orgId}/counters/children`);
  await db.runTransaction(async (tx) => {
    const [child, counter] = await Promise.all([tx.get(childRef), tx.get(counterRef)]);
    if (!child.exists || child.get('code')) return;
    const sequence = ((counter.data()?.last as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { orgId, last: sequence, ...system() }, { merge: true });
    tx.update(childRef, { code: childCode(sequence), ...system() });
  });
  const person = db.doc(`organizations/${orgId}/people/${childId}`);
  if ((await person.get()).get('status') !== 'child') await person.update({ status: 'child', ...system() });
});

// ---- Missed three sessions: a call to the guardian --------------------------------------------

/** Reads what the Hope Center numbers and absence checks need. */
export async function loadHope(orgId: string) {
  const base = db.doc(`organizations/${orgId}`);
  const [org, children, events, attendance, tasks, people] = await Promise.all([
    base.get(),
    base.collection('children').get(),
    base.collection('events').get(),
    base.collection('attendance').get(),
    base.collection('followUps').where('reason', '==', 'child_absent').get(),
    base.collection('people').where('status', '==', 'child').get(),
  ]);
  const names: Record<string, string> = {};
  for (const p of rows(people)) names[p.id] = (p.fullName as string) ?? '';
  const childRows = rows(children);
  const who: Record<string, { code: string; name: string }> = {};
  for (const c of childRows) who[c.id] = { code: (c.code as string) ?? '', name: names[c.id] ?? '' };
  return {
    org: org.data() ?? {},
    programmes: activitiesFor({ type: (org.get('type') as OrganizationType) ?? 'ministry', activities: org.get('activities') as string[] | undefined }),
    children: childRows as unknown as Child[],
    events: rows(events) as unknown as SessionEvent[],
    records: rows(attendance) as unknown as SessionRecord[],
    tasks: rows(tasks).filter((t) => t.deletedAt == null),
    names,
    who,
  };
}

/**
 * Creates a follow-up to the guardian for each child who has missed three sessions in a row of a programme,
 * and closes an open one when the child has come back (or has left). Safe to run any number of times:
 * each task has a fixed id built from the child, the programme and the first missed session.
 */
export async function checkChildAbsences(orgId: string, now = new Date()): Promise<{ created: number; closed: number }> {
  const data = await loadHope(orgId);
  const timeZone = (data.org.timeZone as string | undefined) ?? DEFAULT_TIME_ZONE;
  const today = todayIn(timeZone, now);
  const due = absencesDue(data.children, data.programmes, data.events, data.records, today);
  const dueIds = new Set(due.map((d) => d.taskId));

  let closed = 0;
  for (const task of data.tasks) {
    if (task.status !== 'open' || dueIds.has(task.id)) continue;
    await closeFollowUp(orgId, task.id, CAME_BACK);
    closed += 1;
  }
  let created = 0;
  for (const d of due) {
    const made = await createFollowUp(orgId, d.taskId, {
      personId: d.childId,
      personName: data.names[d.childId] ?? '',
      reason: 'child_absent',
      dueAt: endOfLocalDay(now, timeZone),
      absentSince: d.since,
      note: `${d.programme}: missed ${d.missed} sessions in a row`,
    });
    if (made) created += 1;
  }
  return { created, closed };
}

export async function runDailyChildChecks(now = new Date()): Promise<void> {
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false) continue;
    try {
      const r = await checkChildAbsences(org.id, now);
      logger.info(`Child absences for ${org.id}: ${r.created} follow-ups made, ${r.closed} closed because the child came back`);
    } catch (err) {
      logger.error(`Child absence check for ${org.id} failed`, err);
    }
  }
}

export const dailyChildAbsences = onSchedule(
  { schedule: 'every day 06:30', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300 },
  () => runDailyChildChecks(),
);

/** "Check now" button: the same check on request. */
export const onAbsenceCheckRequested = onDocumentCreated(
  { document: 'organizations/{orgId}/absenceCheckRequests/{requestId}', timeoutSeconds: 120 },
  async (event) => {
    if (!event.data) return;
    try {
      const r = await checkChildAbsences(event.params.orgId);
      await event.data.ref.update({ status: 'done', created: r.created, closed: r.closed, doneAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error(`Absence check request ${event.params.requestId} failed`, err);
      await event.data.ref.update({ status: 'failed', error: 'The check could not be run. Please try again.', doneAt: FieldValue.serverTimestamp() });
    }
  },
);

// ---- Reports -------------------------------------------------------------------------------

export async function generateHopeReport(orgId: string, type: ReportType, from: string, now = new Date(), by: string = SYSTEM): Promise<string> {
  const data = await loadHope(orgId);
  if (!Object.keys(data.org).length) throw new Error('Organization not found');
  const today = todayIn((data.org.timeZone as string | undefined) ?? DEFAULT_TIME_ZONE, now);
  const period = periodFor(type, from);
  const input: HopeInput = {
    children: data.children, programmes: data.programmes, events: data.events, records: data.records, today,
    absenceTasks: data.tasks.map((t) => ({ status: t.status as string, outcome: (t.outcome ?? null) as string | null })),
  };
  const open = data.tasks
    .filter((t) => t.status === 'open')
    .map((t) => ({ childId: t.personId as string, programme: programmeOfTask(t.id, t.personId as string, data.programmes) ?? 'Programme', since: (t.absentSince as string) ?? '' }));
  const doc: HopeReportDoc = buildHopeReport(input, type, period, periodLabel(type, period), open, data.who);
  // Weekly reports are for the pastor, monthly ones are counts only: they are stored apart so the rules can tell them apart.
  const id = `${type}_${period.from}`;
  await db.doc(`organizations/${orgId}/hopeReports/${id}`).set({
    ...doc, orgId, orgName: data.org.name, generatedAt: FieldValue.serverTimestamp(), generatedBy: by,
  });
  return id;
}

export const onHopeReportRequested = onDocumentCreated(
  { document: 'organizations/{orgId}/hopeReportRequests/{requestId}', memory: '512MiB', timeoutSeconds: 300 },
  async (event) => {
    const req = event.data?.data();
    if (!req || !event.data) return;
    try {
      if (req.type !== 'weekly' && req.type !== 'monthly') throw new Error('Unknown report type');
      const id = await generateHopeReport(event.params.orgId, req.type as ReportType, req.from as string, new Date(), req.createdBy as string);
      await event.data.ref.update({ status: 'done', reportId: id, doneAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error(`Hope report request ${event.params.requestId} failed`, err);
      await event.data.ref.update({ status: 'failed', error: 'The report could not be made. Please try again.', doneAt: FieldValue.serverTimestamp() });
    }
  },
);

export async function runScheduledHopeReports(now = new Date()): Promise<string[]> {
  const made: string[] = [];
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false || isTraining({ id: org.id, training: org.get('training') })) continue;
    const today = todayIn((org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE, now);
    for (const { type, period } of reportsDue(today)) {
      try {
        made.push(`${org.id}/${await generateHopeReport(org.id, type, period.from, now)}`);
      } catch (err) {
        logger.error(`Hope report ${org.id} ${type} failed`, err);
      }
    }
  }
  return made;
}

export const scheduledHopeReports = onSchedule(
  { schedule: 'every day 07:15', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', memory: '1GiB', timeoutSeconds: 540 },
  async () => { await runScheduledHopeReports(); },
);
