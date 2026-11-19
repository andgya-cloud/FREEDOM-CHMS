import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { db, FieldValue, requireCaller, requireString, type UserProfile } from './common.js';
import { canAccessOrg, isAttachmentKeeper, PRINCIPAL_ROLE_ID } from './shared/permissions.js';
import { cohortKey } from './shared/examCohorts.js';
import { EXAM_COMPONENTS, type ExamComponent } from './shared/exams.js';
import { examEventId, lastExamDate, type ExamTimetable } from './shared/timetable.js';

const perms = (u: UserProfile) => [...(u.permissions ?? []), ...((u as { extraPermissions?: string[] }).extraPermissions ?? [])];

/**
 * What the timetable keepers choose from (Andy, 2026-11-20, 4A 7A): the cohort's courses with their lecturers
 * (from Exam Records, which Admin cannot open), and the ADIA staff who may invigilate.
 */
export const timetableOptions = onCall({ invoker: 'public' }, async (request) => {
  const caller = await requireCaller(request, undefined, { reviewerOk: true });
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const cohort = requireString(data.cohort, 'the cohort', { max: 80 });
  if (!canAccessOrg(caller.profile, orgId) || !isAttachmentKeeper(caller.profile)) throw new HttpsError('permission-denied', 'Only the principal, Admin, Mr Andrew or Doreen change the timetables.');
  const [sheets, users] = await Promise.all([
    db.collection(`organizations/${orgId}/examSheets`).where('cohort', '==', cohort).get(),
    db.collection('users').where('active', '==', true).get(),
  ]);
  const courses = sheets.docs.filter((d) => !d.get('deletedAt')).map((d) => ({
    sheetId: d.id, name: String(d.get('courseName') ?? ''), courseId: (d.get('courseId') as string | null) ?? null, semester: (d.get('semester') as number | null) ?? null,
    lecturer: String(d.get('teacherName') || d.get('ownerName') || ''), lecturerUid: String(d.get('ownerUid') ?? ''),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const staff = users.docs.map((d) => ({ uid: d.id, u: d.data() as UserProfile }))
    .filter(({ u }) => canAccessOrg(u, orgId) && (u.roleId === PRINCIPAL_ROLE_ID || ['admin', 'head', 'trainer'].includes(u.roleId ?? '') || perms(u).some((p) => p === 'exams.mark' || p === 'exams.manage')))
    .map(({ uid, u }) => ({ uid, name: u.displayName || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { courses, staff };
});

/**
 * A published exam timetable reaches the rest of the system (Andy, 2026-11-20, 8A 13A): each paper goes on the
 * ADIA Events calendar with a pop-up for everyone the day before, and the last paper's date becomes that paper's
 * deadline in Exam Records (unless the cohort is closed). Unpublishing takes the papers off the calendar again.
 */
export const onExamTimetableWritten = onDocumentWritten('organizations/{orgId}/examTimetables/{ttId}', async (event) => {
  const { orgId, ttId } = event.params;
  const after = event.data?.after.exists ? (event.data.after.data() as ExamTimetable & { deletedAt?: unknown; updatedBy?: string }) : null;
  const live = !!after && after.published && !after.deletedAt;
  const cal = db.collection(`organizations/${orgId}/calendar`);
  const prefix = examEventId(ttId, '');
  const existing = await cal.where(FieldPath.documentId(), '>=', prefix).where(FieldPath.documentId(), '<', `${prefix}\uf8ff`).get().catch(() => null);
  const keep = new Set<string>();
  const batch = db.batch();
  if (live) {
    for (const r of after.rows) {
      if (!r.date || !r.course) continue;
      const id = examEventId(ttId, r.id);
      keep.add(id);
      batch.set(cal.doc(id), {
        orgId, title: `${r.course} · ${after.cohort}`.slice(0, 120), type: 'exam', allDay: false, date: r.date, endDate: r.date,
        start: /^\d{2}:\d{2}$/.test(r.start) ? r.start : null, end: /^\d{2}:\d{2}$/.test(r.end) ? r.end : null,
        place: r.room.slice(0, 160), inCharge: r.invigilator ? `Invigilator: ${r.invigilator}`.slice(0, 120) : '', notes: `${after.name}. From the ADIA exam timetable; change it there.`,
        repeat: 'none', repeatUntil: null, skipDates: [], seriesId: null, seriesDate: null, reminders: [1440], remindAll: true,
        invited: [], invitedNames: {}, responses: {}, endsOn: r.date, createdByName: 'Exam timetable',
        deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: after.updatedBy ?? 'system', updatedAt: FieldValue.serverTimestamp(), updatedBy: after.updatedBy ?? 'system',
      });
    }
  }
  for (const d of existing?.docs ?? []) if (!keep.has(d.id) && !d.get('deletedAt')) batch.update(d.ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: 'system' });
  await batch.commit();

  if (live && (EXAM_COMPONENTS as readonly string[]).includes(after.paper)) {
    const last = lastExamDate(after.rows);
    const ref = db.doc(`organizations/${orgId}/examCohorts/${cohortKey(after.cohort)}`);
    const c = await ref.get();
    if (last && c.exists && c.get('closed') !== true && c.get(`deadlines.${after.paper}`) !== last) {
      await ref.update({ [`deadlines.${after.paper as ExamComponent}`]: last, updatedAt: FieldValue.serverTimestamp(), updatedBy: after.updatedBy ?? 'system' });
      logger.info(`Exam timetable ${ttId}: ${after.cohort} ${after.paper} deadline ${last}`);
    }
  }
});
