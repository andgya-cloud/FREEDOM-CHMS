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

/**
 * A trainer's own class registers, every date (Andy, 2026-10-28): they may read
 * only classes named on their account, so each class is asked for by name.
 */
export function useClassEvents(orgId: string, names: string[]) {
  const key = names.join('\u0001');
  const [byName, setByName] = useState<Record<string, ChurchEvent[]>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setByName({});
    const list = key ? key.split('\u0001') : [];
    setLoading(list.length > 0);
    if (!orgId || !list.length) return;
    const offs = list.map((name) => onSnapshot(
      query(collection(db, 'organizations', orgId, 'events'), where('name', '==', name), where('type', '==', 'class')),
      (snap) => {
        setByName((m) => ({ ...m, [name]: snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as ChurchEvent) }));
        setLoading(false);
      },
      () => setLoading(false),
    ));
    return () => offs.forEach((off) => off());
  }, [orgId, key]);
  const events = Object.values(byName).flat().filter((e) => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return { events, loading };
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
  // A trainer may read a register only once its class has reached the server, so a
  // refused listen (a class just opened on this device) is tried again shortly.
  const [attempt, setAttempt] = useState(0);
  const { rows, loading, error } = useLiveQuery<AttendanceMark>(
    () => (orgId && eventId ? query(collection(db, 'organizations', orgId, 'attendance'), where('eventId', '==', eventId)) : null),
    [orgId, eventId, attempt],
  );
  useEffect(() => {
    if (!error || attempt >= 20) return;
    const t = setTimeout(() => setAttempt((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, [error, attempt]);
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

/** Everyone checked in anywhere on one day (YYYY-MM-DD): the live Sunday count on Today. */
export function useDayAttendance(orgId: string, date: string, enabled = true) {
  const { rows, loading } = useLiveQuery<AttendanceMark>(
    () => (orgId && date && enabled ? query(collection(db, 'organizations', orgId, 'attendance'), where('date', '==', date)) : null),
    [orgId, date, enabled],
  );
  return { marks: rows.filter((r) => !r.deletedAt), loading };
}
