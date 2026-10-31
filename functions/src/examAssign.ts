import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db, type UserProfile } from './common.js';
import { TRAINER_ROLE_ID } from './shared/permissions.js';
import { cohortKey } from './shared/examCohorts.js';

/**
 * Each lecturer gets every course of their department (Andy, 2026-10-28, 1A).
 * Courses of graduated (closed) cohorts stay as they are; the principal can
 * still give any one course to someone else afterwards.
 */
interface Lecturer { uid: string; name: string; courseIds: string[] }

const lecturerOf = (uid: string, u: UserProfile & { trainerCourseIds?: string[] }): Lecturer => ({
  uid, name: (u.displayName || u.email).slice(0, 120), courseIds: u.trainerCourseIds ?? [],
});

/** The active lecturers of an organization's departments. */
async function lecturers(orgId: string): Promise<Lecturer[]> {
  const users = await db.collection('users').where('roleId', '==', TRAINER_ROLE_ID).where('active', '==', true).get();
  return users.docs
    .map((d) => ({ d, u: d.data() as UserProfile & { trainerCourseIds?: string[] } }))
    .filter(({ u }) => u.allOrgs || (u.orgIds ?? []).includes(orgId))
    .map(({ d, u }) => lecturerOf(d.id, u))
    .filter((l) => l.courseIds.length > 0);
}

async function closedCohorts(orgId: string): Promise<Set<string>> {
  const snap = await db.collection(`organizations/${orgId}/examCohorts`).where('closed', '==', true).get();
  return new Set(snap.docs.map((d) => d.id));
}

/** After a lecturer's account is saved: their department's open courses become theirs. */
export async function giveDepartmentCourses(uid: string, profile: UserProfile & { trainerCourseIds?: string[] }, actorUid: string): Promise<number> {
  const me = lecturerOf(uid, profile);
  if (profile.roleId !== TRAINER_ROLE_ID || !profile.active || !me.courseIds.length) return 0;
  let moved = 0;
  for (const orgId of profile.orgIds ?? []) {
    const sheets = await db.collection(`organizations/${orgId}/examSheets`).where('courseId', 'in', me.courseIds.slice(0, 10)).get();
    if (sheets.empty) continue;
    const closed = await closedCohorts(orgId);
    const others = (await lecturers(orgId)).filter((l) => l.uid !== uid);
    const batch = db.batch();
    for (const sh of sheets.docs) {
      const d = sh.data();
      if (d.deletedAt || d.ownerUid === uid || closed.has(cohortKey(String(d.cohort ?? '')))) continue;
      // Shared departments: a course already with another lecturer of the same department stays with them.
      if (others.some((l) => l.uid === d.ownerUid && l.courseIds.includes(String(d.courseId)))) continue;
      batch.update(sh.ref, { ownerUid: uid, ownerName: me.name, teacherName: me.name, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid });
      moved++;
    }
    if (moved) await batch.commit();
  }
  return moved;
}

/** A new course goes to its department's lecturer, unless the principal already chose one of that department's lecturers. */
export const examSheetToLecturer = onDocumentCreated('organizations/{orgId}/examSheets/{sheetId}', async (event) => {
  const d = event.data?.data();
  const courseId = typeof d?.courseId === 'string' ? d.courseId : '';
  if (!d || !courseId) return;
  const mine = (await lecturers(event.params.orgId)).filter((l) => l.courseIds.includes(courseId));
  if (!mine.length || mine.some((l) => l.uid === d.ownerUid)) return;
  const pick = mine[0]!;
  await event.data!.ref.update({ ownerUid: pick.uid, ownerName: pick.name, teacherName: pick.name, updatedAt: FieldValue.serverTimestamp(), updatedBy: String(d.createdBy ?? 'system') });
});
