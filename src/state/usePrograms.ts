import { collection, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/useQuery';
import type { AttendanceMark, ChurchEvent } from './useAttendance';
import type { EnrollmentStatus, ProgramConfig, Weekday } from '../../functions/src/shared/programs';

interface Stamped {
  id: string;
  orgId: string;
  deletedAt: Timestamp | null;
  createdAt?: Timestamp;
}

export interface Program extends Stamped, ProgramConfig {}

export interface Cohort extends Stamped {
  programId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  schedule: string;
  active: boolean;
}

export interface Enrollment extends Stamped {
  programId: string;
  personId: string;
  cohortId: string | null;
  status: EnrollmentStatus;
  enrolledDate: string;
  completedDate: string | null;
  completedAuto: boolean;
  topicsCovered: string[];
  notes: string;
}

export interface Team extends Stamped {
  name: string;
  leaderId: string | null;
  leaderName: string;
  active: boolean;
}

export interface TeamMember extends Stamped {
  teamId: string;
  personId: string;
  role: string;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'inactive';
}

export interface Group extends Stamped {
  name: string;
  leaderId: string | null;
  leaderName: string;
  meetingDay: Weekday;
  meetingTime: string;
  place: string;
  startDate: string;
  active: boolean;
}

export interface GroupMember extends Stamped {
  groupId: string;
  personId: string;
  joinedDate: string;
  leftDate: string | null;
  status: 'active' | 'left';
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
const notDeleted = <T extends { deletedAt: unknown }>(r: T) => !r.deletedAt;

function useOrgCollection<T extends Stamped>(orgId: string, name: string, field?: string, value?: string) {
  return useLiveQuery<T>(() => {
    if (!orgId || (field && !value)) return null;
    const base = collection(db, 'organizations', orgId, name);
    return field ? query(base, where(field, '==', value)) : base;
  }, [orgId, name, field, value]);
}

/** Programmes in this organization, standard ones first. Served from the device when offline. */
export function usePrograms(orgId: string) {
  const { rows, loading } = useOrgCollection<Program>(orgId, 'programs');
  return { programs: rows.filter(notDeleted).sort(byName), loading };
}

export function useCohorts(orgId: string, programId?: string) {
  const { rows, loading } = useOrgCollection<Cohort>(orgId, 'cohorts', programId ? 'programId' : undefined, programId);
  return { cohorts: rows.filter(notDeleted).sort((a, b) => b.startDate.localeCompare(a.startDate)), loading };
}

/**
 * Enrolments for one programme or one person, including dropped ones.
 * `all` also has deleted ones, so re-adding someone restores their record.
 */
export function useEnrollments(orgId: string, by: { programId: string } | { personId: string } | null) {
  const field = by ? ('programId' in by ? 'programId' : 'personId') : undefined;
  const value = by ? ('programId' in by ? by.programId : by.personId) : undefined;
  const { rows, loading } = useOrgCollection<Enrollment>(orgId, 'enrollments', field, value ?? '');
  return { enrollments: rows.filter(notDeleted), all: rows, loading };
}

/** Every class of a programme, newest first. */
export function useProgramSessions(orgId: string, programId: string) {
  const { rows, loading } = useOrgCollection<ChurchEvent & Stamped>(orgId, 'events', 'programId', programId);
  return { sessions: rows.filter(notDeleted).sort((a, b) => b.date.localeCompare(a.date)), loading };
}

/** Every check-in at a programme's classes, for live progress on screen. */
export function useProgramMarks(orgId: string, programId: string) {
  const { rows } = useOrgCollection<AttendanceMark & Stamped>(orgId, 'attendance', 'programId', programId);
  return rows;
}

export function useTeams(orgId: string) {
  const { rows, loading } = useOrgCollection<Team>(orgId, 'teams');
  return { teams: rows.filter(notDeleted).sort(byName), loading };
}

export function useTeamMembers(orgId: string, by: { teamId: string } | { personId: string } | null) {
  const field = by ? ('teamId' in by ? 'teamId' : 'personId') : undefined;
  const value = by ? ('teamId' in by ? by.teamId : by.personId) : undefined;
  const { rows, loading } = useOrgCollection<TeamMember>(orgId, 'teamMembers', field, value ?? '');
  return { members: rows.filter(notDeleted), all: rows, loading };
}

/** All team memberships in the organization, for counts on the overview. */
export function useAllTeamMembers(orgId: string) {
  return useOrgCollection<TeamMember>(orgId, 'teamMembers').rows.filter(notDeleted);
}

export function useGroups(orgId: string) {
  const { rows, loading } = useOrgCollection<Group>(orgId, 'groups');
  return { groups: rows.filter(notDeleted).sort(byName), loading };
}

export function useGroupMembers(orgId: string, by: { groupId: string } | { personId: string } | null) {
  const field = by ? ('groupId' in by ? 'groupId' : 'personId') : undefined;
  const value = by ? ('groupId' in by ? by.groupId : by.personId) : undefined;
  const { rows, loading } = useOrgCollection<GroupMember>(orgId, 'groupMembers', field, value ?? '');
  return { members: rows.filter(notDeleted), all: rows, loading };
}

export function useAllGroupMembers(orgId: string) {
  return useOrgCollection<GroupMember>(orgId, 'groupMembers').rows.filter(notDeleted);
}

/** Group meetings since a date (YYYY-MM-DD), for the missed-meeting flags. */
export function useGroupMeetings(orgId: string, since: string) {
  const { rows } = useLiveQuery<ChurchEvent & Stamped & { groupId: string }>(
    () => (orgId ? query(collection(db, 'organizations', orgId, 'events'), where('type', '==', 'group'), where('date', '>=', since)) : null),
    [orgId, since],
  );
  return rows.filter(notDeleted);
}

/** Every check-in at one group's meetings. */
export function useGroupMarks(orgId: string, groupId: string) {
  return useOrgCollection<AttendanceMark & Stamped>(orgId, 'attendance', 'groupId', groupId).rows.filter(notDeleted);
}
