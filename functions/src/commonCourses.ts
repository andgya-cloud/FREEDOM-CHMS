import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common.js';
import { TRAINER_ROLE_ID } from './shared/permissions.js';
import { cohortKey } from './shared/examCohorts.js';
import { COMMON_DEPARTMENT, commonClassName, commonRosterId } from './shared/commonCourses.js';
import type { RosterStudent } from './rosters.js';

/**
 * "Common courses" is a department of its own (Andy, 2026-10-28, 1A-5A). A lecturer with it ticked
 * sees every student of the cohorts their common courses are taught to (names and admission numbers
 * only), marks one register per common course ("Communication Skills · Cohort 4"), and keys in its
 * marks. Their account carries commonClasses (those registers) and commonRosters (those cohorts'
 * class lists), kept up to date here whenever the principal gives a common course to someone.
 */

/** A cohort's names-only class list across every department. Only rebuilt once a common course needs it, unless forced. */
export async function rebuildCommonRoster(orgId: string, cohort: string, force = false): Promise<void> {
  if (!orgId || !cohort) return;
  const ref = db.doc(`organizations/${orgId}/rosters/${commonRosterId(cohort)}`);
  if (!force && !(await ref.get()).exists) return;
  const intakes = await db.collection(`organizations/${orgId}/intakes`).where('name', '==', cohort).get();
  const intakeIds = intakes.docs.filter((d) => !d.get('deletedAt')).map((d) => d.id);
  const students = [];
  for (let i = 0; i < intakeIds.length; i += 30) {
    const snap = await db.collection(`organizations/${orgId}/students`).where('intakeId', 'in', intakeIds.slice(i, i + 30)).get();
    students.push(...snap.docs.filter((d) => !d.get('deletedAt')));
  }
  const people = students.length ? await db.getAll(...students.map((d) => db.doc(`organizations/${orgId}/people/${d.id}`))) : [];
  const names = new Map(people.map((p) => [p.id, p.exists && !p.get('deletedAt') ? String(p.get('fullName') ?? '') : '']));
  const list: (RosterStudent & { courseId: string })[] = students
    .filter((d) => names.get(d.id))
    .map((d) => ({
      id: d.id, name: names.get(d.id)!, admissionNo: String(d.get('admissionNo') ?? ''), intakeId: String(d.get('intakeId') ?? ''),
      status: String(d.get('status') ?? ''), enrolledOn: (d.get('enrolledOn') as string | undefined) ?? null, courseId: String(d.get('courseId') ?? ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  await ref.set({ orgId, courseId: COMMON_DEPARTMENT, cohort, students: list, updatedAt: FieldValue.serverTimestamp() });
}

/** The cohort a student's intake belongs to, or ''. */
export async function cohortOfIntake(orgId: string, intakeId: unknown): Promise<string> {
  if (typeof intakeId !== 'string' || !intakeId) return '';
  const intake = await db.doc(`organizations/${orgId}/intakes/${intakeId}`).get();
  return intake.exists ? String(intake.get('name') ?? '') : '';
}

/** Recount which common-course registers and class lists a lecturer has, from the common courses given to them. */
export async function refreshCommonAccess(uid: unknown): Promise<void> {
  if (typeof uid !== 'string' || !uid) return;
  const ref = db.doc(`users/${uid}`);
  const user = await ref.get();
  if (!user.exists) return;
  const u = user.data() as { roleId?: string; orgIds?: string[]; trainerCourseIds?: string[]; registerClasses?: string[]; commonClasses?: string[]; commonRosters?: string[] };
  const before = { classes: u.commonClasses ?? [], rosters: u.commonRosters ?? [] };
  const departmentClasses = (u.registerClasses ?? []).filter((c) => !before.classes.includes(c));
  const classes = new Set<string>();
  const rosters = new Set<string>();
  if (u.roleId === TRAINER_ROLE_ID && (u.trainerCourseIds ?? []).includes(COMMON_DEPARTMENT)) {
    for (const orgId of u.orgIds ?? []) {
      const sheets = await db.collection(`organizations/${orgId}/examSheets`).where('ownerUid', '==', uid).get();
      const closed = new Set((await db.collection(`organizations/${orgId}/examCohorts`).where('closed', '==', true).get()).docs.map((d) => d.id));
      for (const sh of sheets.docs) {
        const d = sh.data();
        const cohort = String(d.cohort ?? '');
        if (d.deletedAt || d.courseId != null || !cohort || closed.has(cohortKey(cohort))) continue;
        classes.add(commonClassName(String(d.courseName ?? ''), cohort));
        if (!rosters.has(commonRosterId(cohort))) {
          rosters.add(commonRosterId(cohort));
          if (!before.rosters.includes(commonRosterId(cohort))) await rebuildCommonRoster(orgId, cohort, true);
        }
      }
    }
  }
  const commonClasses = [...classes].sort();
  const commonRosters = [...rosters].sort();
  const registerClasses = [...departmentClasses, ...commonClasses];
  if (commonClasses.join('|') === before.classes.join('|') && commonRosters.join('|') === before.rosters.join('|')
    && registerClasses.join('|') === (u.registerClasses ?? []).join('|')) return;
  await ref.update({ commonClasses, commonRosters, registerClasses });
}

/** A common course given to, taken from, renamed or removed: both lecturers' registers follow. */
export const commonCourseAccess = onDocumentWritten('organizations/{orgId}/examSheets/{sheetId}', async (event) => {
  const b = event.data?.before.data();
  const a = event.data?.after.data();
  if ((b?.courseId ?? null) != null && (a?.courseId ?? null) != null) return;
  const same = b && a && b.ownerUid === a.ownerUid && b.courseName === a.courseName && b.cohort === a.cohort
    && (b.courseId ?? null) === (a.courseId ?? null) && !!b.deletedAt === !!a.deletedAt;
  if (same) return;
  const uids = new Set([b?.ownerUid, a?.ownerUid].filter((x): x is string => typeof x === 'string' && !!x));
  for (const uid of uids) await refreshCommonAccess(uid);
});
