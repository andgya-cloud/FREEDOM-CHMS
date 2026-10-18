import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/useQuery';
import type { AttendanceStatus, CheckInMethod, EventType, Headcounts } from '../../functions/src/shared/attendance';
import { ESTIMATE } from '../lib/firestoreOptions';

export interface ChurchEvent {
  id: string;
  orgId: string;
  date: string;
  type: EventType;
  name: string;
  activity: string | null;
  headcounts: Headcounts;
  notes: string;
  /** Set on a programme class (Stage 4). */
  programId?: string | null;
  cohortId?: string | null;
  topicIds?: string[];
  mentor?: string | null;
  mentorId?: string | null;
  /** Set on a Freedom Group meeting. */
  groupId?: string | null;
  deletedAt: Timestamp | null;
}

export interface AttendanceMark {
  id: string;
  orgId: string;
  eventId: string;
  personId: string;
  date: string;
  status: AttendanceStatus;
  method: CheckInMethod;
  checkedInAt: Timestamp | null;
  programId?: string;
  groupId?: string;
  deletedAt: Timestamp | null;
}

/**
 * Services, classes and sessions on or after `since` (YYYY-MM-DD), newest
 * first. Programme classes and group meetings live on their own pages.
 * Served from the device when offline.
 */
export function useEvents(orgId: string, since: string) {
  const { rows, loading } = useLiveQuery<ChurchEvent>(
    () => (orgId ? query(collection(db, 'organizations', orgId, 'events'), where('date', '>=', since)) : null),
    [orgId, since],
  );
  const live = rows.filter((e) => !e.deletedAt && !e.programId && !e.groupId).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return { events: live, loading };
}

/** One gathering, live. `missing` once the device knows it does not exist. */
export function useEvent(orgId: string, eventId: string) {
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setEvent(null);
    setMissing(false);
    if (!orgId || !eventId) return;
    return onSnapshot(doc(db, 'organizations', orgId, 'events', eventId), (snap) => {
      if (snap.exists()) {
        setEvent({ id: snap.id, ...snap.data(ESTIMATE) } as ChurchEvent);
        setMissing(false);
      } else if (!snap.metadata.fromCache) {
        setMissing(true);
      }
    }, () => setMissing(true));
  }, [orgId, eventId]);
  return { event, missing };
}

/** Everyone recorded at one gathering, keyed by person, including taken-back check-ins (so they can be restored). */
export function useEventAttendance(orgId: string, eventId: string) {
  const { rows, loading } = useLiveQuery<AttendanceMark>(
    () => (orgId && eventId ? query(collection(db, 'organizations', orgId, 'attendance'), where('eventId', '==', eventId)) : null),
    [orgId, eventId],
  );
  const byPerson = new Map(rows.map((r) => [r.personId, r]));
  return { marks: rows, byPerson, loading };
}

/** One person's attendance records, newest first. */
export function usePersonAttendance(orgId: string, personId: string) {
  const { rows, loading } = useLiveQuery<AttendanceMark>(
    () => (orgId && personId ? query(collection(db, 'organizations', orgId, 'attendance'), where('personId', '==', personId)) : null),
    [orgId, personId],
  );
  return { marks: rows.filter((r) => !r.deletedAt).sort((a, b) => b.date.localeCompare(a.date)), loading };
}
