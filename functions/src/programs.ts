import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_PIPELINE, pipelineEntryId, type PipelineStage } from './shared/people.js';
import {
  coverage,
  enrollmentIdFor,
  nextEnrollmentState,
  nextStageStatus,
  type CompletionRule,
  type EnrollmentState,
  type SessionLike,
  type StageStatus,
  type Topic,
} from './shared/programs.js';

const SYSTEM = 'system';
const WATCHED = new Set(['attendance', 'events', 'programs', 'enrollments', 'teamMembers', 'groupMembers']);

const millis = (v: unknown) => (v && typeof (v as { toMillis?: () => number }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const live = (d: DocumentData | undefined) => !!d && d.deletedAt == null;

/**
 * Keeps programme progress and people's journeys up to date, whichever
 * device made the change and however late it synced:
 * - a class check-in, a class's topics or a programme's topics changing
 *   recounts the topics each person has covered, and completes (graduates)
 *   them when the programme's rule is met;
 * - enrolling, completing or dropping moves the programme's journey stage;
 * - joining a Dream Team department or a Freedom Group completes that stage.
 */
export const syncProgrammes = onDocumentWritten('organizations/{orgId}/{collection}/{docId}', async (event) => {
  const { orgId, collection, docId } = event.params;
  if (!WATCHED.has(collection)) return;
  const before = event.data?.before.exists ? event.data.before.data() : undefined;
  const after = event.data?.after.exists ? event.data.after.data() : undefined;
  const data = after ?? before;
  if (!data) return;

  switch (collection) {
    case 'attendance': {
      if (!data.programId) return;
      if (before && after && before.status === after.status && millis(before.deletedAt) === millis(after.deletedAt)) return;
      await recount(orgId, data.programId as string, data.personId as string);
      return;
    }
    case 'events': {
      if (!data.programId) return;
      if (!before || !after || (same(before.topicIds, after.topicIds) && millis(before.deletedAt) === millis(after.deletedAt))) return;
      const marks = await db.collection(`organizations/${orgId}/attendance`).where('eventId', '==', docId).get();
      const people = new Set(marks.docs.map((d) => d.get('personId') as string));
      for (const personId of people) await recount(orgId, data.programId as string, personId);
      return;
    }
    case 'programs': {
      if (!before || !after || (same(before.topics, after.topics) && same(before.completionRule, after.completionRule))) return;
      const enrolled = await db.collection(`organizations/${orgId}/enrollments`).where('programId', '==', docId).get();
      for (const e of enrolled.docs) await recount(orgId, docId, e.get('personId') as string);
      return;
    }
    case 'enrollments': {
      if (!after) return;
      // A new enrolment counts classes the person already attended (a make-up class, say).
      if (!before || before.cohortId !== after.cohortId || (before.deletedAt && !after.deletedAt)) {
        await recount(orgId, after.programId as string, after.personId as string);
      }
      if (!live(after)) return;
      if (before && before.status === after.status && before.completedDate === after.completedDate && live(before)) return;
      const program = await db.doc(`organizations/${orgId}/programs/${after.programId}`).get();
      const stageId = program.get('pipelineStageId') as string | null | undefined;
      if (!stageId) return;
      const wanted: StageStatus = after.status === 'completed' ? 'completed' : after.status === 'dropped' ? 'dropped' : 'in_progress';
      const date = (after.status === 'completed' ? after.completedDate : after.enrolledDate) as string | null;
      // An automatic completion that no longer holds moves the stage back too.
      const undone = before?.status === 'completed' && before.completedAuto === true && after.status === 'active';
      await moveStage(orgId, after.personId as string, stageId, wanted, date, undone);
      return;
    }
    case 'teamMembers':
    case 'groupMembers': {
      if (!after || !live(after) || after.status !== 'active') return;
      if (before && live(before) && before.status === 'active') return;
      const stageId = collection === 'teamMembers' ? 'dream_team' : 'freedom_groups';
      const date = (collection === 'teamMembers' ? after.startDate : after.joinedDate) as string;
      await moveStage(orgId, after.personId as string, stageId, 'completed', date, false);
      return;
    }
  }
});

/** Recounts one person's topics in one programme and records completion. */
async function recount(orgId: string, programId: string, personId: string): Promise<void> {
  const base = `organizations/${orgId}`;
  const ref = db.doc(`${base}/enrollments/${enrollmentIdFor(programId, personId)}`);
  const [program, sessions, marks] = await Promise.all([
    db.doc(`${base}/programs/${programId}`).get(),
    db.collection(`${base}/events`).where('programId', '==', programId).get(),
    db.collection(`${base}/attendance`).where('programId', '==', programId).where('personId', '==', personId).get(),
  ]);
  if (!program.exists) return;
  const topics = (program.get('topics') as Topic[] | undefined) ?? [];
  const rule = (program.get('completionRule') as CompletionRule | undefined) ?? { type: 'all_topics' };
  const progress = coverage(
    topics,
    rule,
    sessions.docs.map((d) => ({ id: d.id, ...d.data() }) as SessionLike),
    marks.docs.map((d) => ({ eventId: d.get('eventId'), status: d.get('status'), deletedAt: d.get('deletedAt') })),
  );
  const topicsCovered = [...progress.covered.keys()].sort();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('deletedAt') != null) return;
    const current: EnrollmentState = {
      status: snap.get('status'),
      completedDate: snap.get('completedDate') ?? null,
      completedAuto: snap.get('completedAuto') === true,
    };
    const next = nextEnrollmentState(current, progress);
    if (same(topicsCovered, snap.get('topicsCovered')) && same(next, current)) return;
    tx.update(ref, { topicsCovered, ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });
  });
}

/** Moves one journey stage forward (or back, after an undone automatic completion). */
async function moveStage(orgId: string, personId: string, stageId: string, wanted: StageStatus, date: string | null, allowBack: boolean): Promise<void> {
  const settings = await db.doc('settings/pipeline').get();
  const stages = (settings.get('stages') as PipelineStage[] | undefined)?.length ? (settings.get('stages') as PipelineStage[]) : DEFAULT_PIPELINE;
  const stage = stages.find((s) => s.id === stageId);
  if (!stage || !stage.active) return; // the pastor removed or switched off this stage
  const sensitive = ((settings.get('sensitiveStageIds') as string[] | undefined) ?? ['salvation', 'baptism']).includes(stageId);
  const ref = db.doc(`organizations/${orgId}/pipeline/${pipelineEntryId(personId, stageId)}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists && snap.get('deletedAt') == null ? (snap.get('status') as StageStatus) : null;
    let next = nextStageStatus(existing, wanted);
    // Only a completion the system recorded is taken back; never one staff entered.
    if (allowBack && existing === 'completed' && snap.get('updatedBy') === SYSTEM) next = wanted;
    if (!next) return;
    const now = FieldValue.serverTimestamp();
    if (snap.exists) {
      tx.update(ref, { status: next, date: date ?? snap.get('date') ?? null, deletedAt: null, deletedBy: null, updatedAt: now, updatedBy: SYSTEM });
    } else {
      tx.set(ref, {
        orgId, personId, stageId, sensitive, status: next, date, notes: '', details: {},
        deletedAt: null, deletedBy: null, createdAt: now, createdBy: SYSTEM, updatedAt: now, updatedBy: SYSTEM,
      });
    }
  });
}
