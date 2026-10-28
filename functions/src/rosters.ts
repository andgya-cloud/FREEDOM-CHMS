import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common.js';

/**
 * A lecturer sees only their own department (Andy, 2026-10-28, 1A-3A): names
 * and admission numbers, nothing else. Each department keeps a names-only
 * class list at organizations/{orgId}/rosters/{courseId}, written here and
 * readable by that department's lecturers; they never read people or students.
 */
export interface RosterStudent {
  id: string;
  name: string;
  admissionNo: string;
  intakeId: string;
  status: string;
  enrolledOn: string | null;
}

export async function rebuildRoster(orgId: string, courseId: string): Promise<void> {
  if (!orgId || !courseId) return;
  const students = await db.collection(`organizations/${orgId}/students`).where('courseId', '==', courseId).get();
  const live = students.docs.filter((d) => !d.get('deletedAt'));
  const people = live.length ? await db.getAll(...live.map((d) => db.doc(`organizations/${orgId}/people/${d.id}`))) : [];
  const names = new Map(people.map((p) => [p.id, p.exists && !p.get('deletedAt') ? String(p.get('fullName') ?? '') : '']));
  const list: RosterStudent[] = live
    .filter((d) => names.get(d.id))
    .map((d) => ({
      id: d.id, name: names.get(d.id)!, admissionNo: String(d.get('admissionNo') ?? ''), intakeId: String(d.get('intakeId') ?? ''),
      status: String(d.get('status') ?? ''), enrolledOn: (d.get('enrolledOn') as string | undefined) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  await db.doc(`organizations/${orgId}/rosters/${courseId}`).set({ orgId, courseId, students: list, updatedAt: FieldValue.serverTimestamp() });
}

/** A student joining, leaving or moving department changes the class lists. */
export const rosterOnStudent = onDocumentWritten('organizations/{orgId}/students/{studentId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const courses = new Set([before?.courseId, after?.courseId].filter((c): c is string => typeof c === 'string' && !!c));
  for (const courseId of courses) await rebuildRoster(event.params.orgId, courseId);
});

/** A student's name changing, or their record being deleted, changes their class list. */
export const rosterOnPerson = onDocumentWritten('organizations/{orgId}/people/{personId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (before?.fullName === after?.fullName && !!before?.deletedAt === !!after?.deletedAt) return;
  const student = await db.doc(`organizations/${event.params.orgId}/students/${event.params.personId}`).get();
  const courseId = student.get('courseId');
  if (student.exists && typeof courseId === 'string') await rebuildRoster(event.params.orgId, courseId);
});
