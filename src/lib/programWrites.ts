import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import { createEvent } from './attendanceWrites';
import {
  enrollmentIdFor,
  groupMeetingIdFor,
  groupMemberIdFor,
  programSessionIdFor,
  STANDARD_PROGRAMS,
  teamMemberIdFor,
  type EnrollmentStatus,
  type ProgramConfig,
  type Weekday,
} from '../../functions/src/shared/programs';
import type { Cohort, Enrollment, Group, Program } from '../state/usePrograms';

/**
 * Writes for programmes, Dream Team and Freedom Groups. Like everything
 * else, each change is saved on the device straight away and synced when
 * online. Membership records have fixed ids (programme + person), so adding
 * someone twice, even on two devices offline, gives one record.
 */

const ref = (orgId: string, name: string, id: string) => doc(db, 'organizations', orgId, name, id);
const newId = (orgId: string, name: string) => doc(collection(db, 'organizations', orgId, name)).id;

// ---- Programmes -------------------------------------------------------------

/** Adds Growth Track, Freedom 252 and Communication Master Class (any not already there). */
export function addStandardPrograms(orgId: string, existingIds: readonly string[]) {
  const batch = writeBatch(db);
  for (const [id, config] of Object.entries(STANDARD_PROGRAMS)) {
    if (existingIds.includes(id)) continue;
    batch.set(ref(orgId, 'programs', id), { orgId, ...config, ...createStamps() });
  }
  return trackWrite(batch.commit());
}

export function saveProgram(orgId: string, id: string, config: ProgramConfig, exists: boolean) {
  if (exists) return updateRecord(ref(orgId, 'programs', id), { ...config });
  return trackWrite(setDoc(ref(orgId, 'programs', id), { orgId, ...config, ...createStamps() }));
}

export function addCohort(orgId: string, input: Pick<Cohort, 'programId' | 'name' | 'startDate' | 'endDate' | 'schedule'>) {
  const id = newId(orgId, 'cohorts');
  const synced = trackWrite(setDoc(ref(orgId, 'cohorts', id), { orgId, ...input, active: true, ...createStamps() }));
  return { id, synced };
}

export function updateCohort(orgId: string, cohortId: string, changes: Partial<Pick<Cohort, 'name' | 'startDate' | 'endDate' | 'schedule' | 'active'>>) {
  return updateRecord(ref(orgId, 'cohorts', cohortId), changes);
}

/**
 * Enrols someone, or brings back an enrolment that was dropped or deleted.
 * Topics they already covered (at a make-up class, say) still count.
 */
export function enrol(orgId: string, programId: string, personId: string, cohortId: string | null, date: string, existing?: Enrollment) {
  const r = ref(orgId, 'enrollments', enrollmentIdFor(programId, personId));
  if (existing) return updateRecord(r, { cohortId, status: existing.status === 'dropped' ? 'active' : existing.status, deletedAt: null, deletedBy: null });
  return trackWrite(setDoc(r, {
    orgId, programId, personId, cohortId, status: 'active', enrolledDate: date,
    completedDate: null, completedAuto: false, topicsCovered: [], notes: '', ...createStamps(),
  }));
}

/** Staff can complete, drop or re-activate an enrolment by hand; the server then leaves it alone. */
export function setEnrollmentStatus(orgId: string, enrollment: Enrollment, status: EnrollmentStatus, date: string) {
  return updateRecord(ref(orgId, 'enrollments', enrollment.id), {
    status,
    completedDate: status === 'completed' ? date : null,
    completedAuto: false,
  });
}

export function updateEnrollment(orgId: string, enrollmentId: string, changes: Partial<Pick<Enrollment, 'cohortId' | 'notes'>>) {
  return updateRecord(ref(orgId, 'enrollments', enrollmentId), changes);
}

export function removeEnrollment(orgId: string, enrollmentId: string) {
  return softDelete(ref(orgId, 'enrollments', enrollmentId));
}

/**
 * Opens a class for a programme on a date: the cohort's class, or a make-up
 * class (no cohort) open to everyone enrolled. Returns the class's id; if it
 * already exists (another device started it), it is simply opened.
 */
export function startProgramSession(
  orgId: string,
  program: Pick<Program, 'id' | 'name'>,
  cohort: Pick<Cohort, 'id' | 'name'> | null,
  date: string,
  topicIds: string[],
  mentor: { id: string | null; name: string },
  alreadyOpen: boolean,
) {
  const id = programSessionIdFor(date, program.id, cohort?.id ?? null);
  if (alreadyOpen) return { id, synced: Promise.resolve() };
  return createEvent(orgId, {
    date, type: 'class', name: `${program.name} · ${cohort ? cohort.name : 'Make-up class'}`, activity: program.name,
  }, {
    id, programId: program.id, cohortId: cohort?.id ?? null, topicIds, mentor: mentor.name.trim() || null, mentorId: mentor.id,
  });
}

export function updateSessionDetails(orgId: string, eventId: string, changes: { topicIds?: string[]; mentor?: string | null; mentorId?: string | null }) {
  return updateRecord(ref(orgId, 'events', eventId), changes);
}

// ---- Dream Team -------------------------------------------------------------

export function addTeam(orgId: string, name: string, leader: { id: string | null; name: string }) {
  const id = newId(orgId, 'teams');
  const synced = trackWrite(setDoc(ref(orgId, 'teams', id), { orgId, name: name.trim(), leaderId: leader.id, leaderName: leader.name.trim(), active: true, ...createStamps() }));
  return { id, synced };
}

export function updateTeam(orgId: string, teamId: string, changes: { name?: string; leaderId?: string | null; leaderName?: string; active?: boolean }) {
  return updateRecord(ref(orgId, 'teams', teamId), changes);
}

export function addTeamMember(orgId: string, teamId: string, personId: string, role: string, startDate: string, existing: boolean) {
  const r = ref(orgId, 'teamMembers', teamMemberIdFor(teamId, personId));
  if (existing) return updateRecord(r, { role: role.trim(), startDate, endDate: null, status: 'active', deletedAt: null, deletedBy: null });
  return trackWrite(setDoc(r, { orgId, teamId, personId, role: role.trim(), startDate, endDate: null, status: 'active', ...createStamps() }));
}

export function updateTeamMember(orgId: string, memberId: string, changes: { role?: string; startDate?: string; status?: 'active' | 'inactive'; endDate?: string | null }) {
  return updateRecord(ref(orgId, 'teamMembers', memberId), changes);
}

export function removeTeamMember(orgId: string, memberId: string) {
  return softDelete(ref(orgId, 'teamMembers', memberId));
}

// ---- Freedom Groups ---------------------------------------------------------

export interface GroupInput {
  name: string;
  leaderId: string | null;
  leaderName: string;
  meetingDay: Weekday;
  meetingTime: string;
  place: string;
  startDate: string;
}

/** Creates a group; its leader is added as a member too. */
export function addGroup(orgId: string, input: GroupInput) {
  const id = newId(orgId, 'groups');
  const batch = writeBatch(db);
  batch.set(ref(orgId, 'groups', id), { orgId, ...input, active: true, ...createStamps() });
  if (input.leaderId) {
    batch.set(ref(orgId, 'groupMembers', groupMemberIdFor(id, input.leaderId)), {
      orgId, groupId: id, personId: input.leaderId, joinedDate: input.startDate, leftDate: null, status: 'active', ...createStamps(),
    });
  }
  return { id, synced: trackWrite(batch.commit()) };
}

export function updateGroup(orgId: string, groupId: string, changes: Partial<GroupInput & { active: boolean }>) {
  return updateRecord(ref(orgId, 'groups', groupId), changes);
}

export function addGroupMember(orgId: string, groupId: string, personId: string, date: string, existing: boolean) {
  const r = ref(orgId, 'groupMembers', groupMemberIdFor(groupId, personId));
  if (existing) return updateRecord(r, { status: 'active', leftDate: null, joinedDate: date, deletedAt: null, deletedBy: null });
  return trackWrite(setDoc(r, { orgId, groupId, personId, joinedDate: date, leftDate: null, status: 'active', ...createStamps() }));
}

export function leaveGroup(orgId: string, memberId: string, date: string) {
  return updateRecord(ref(orgId, 'groupMembers', memberId), { status: 'left', leftDate: date });
}

/** Opens this week's meeting for a group (or the one already open that day). */
export function startGroupMeeting(orgId: string, group: Pick<Group, 'id' | 'name'>, date: string, alreadyOpen: boolean) {
  const id = groupMeetingIdFor(date, group.id);
  if (alreadyOpen) return { id, synced: Promise.resolve() };
  return createEvent(orgId, { date, type: 'group', name: group.name, activity: null }, { id, groupId: group.id });
}
