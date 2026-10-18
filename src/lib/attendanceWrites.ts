import { doc, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, softDelete, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import {
  attendanceIdFor,
  eventIdFor,
  type AttendanceStatus,
  type CheckInMethod,
  type EventType,
  type Headcounts,
} from '../../functions/src/shared/attendance';

export interface NewEvent {
  date: string;
  type: EventType;
  name: string;
  activity: string | null;
}

/** A programme class or group meeting carries these too; its id comes from them. */
export interface EventLinks {
  id: string;
  programId?: string;
  cohortId?: string | null;
  topicIds?: string[];
  mentor?: string | null;
  mentorId?: string | null;
  groupId?: string;
}

export const eventRef = (orgId: string, eventId: string) => doc(db, 'organizations', orgId, 'events', eventId);
export const attendanceRef = (orgId: string, eventId: string, personId: string) =>
  doc(db, 'organizations', orgId, 'attendance', attendanceIdFor(eventId, personId));

/**
 * Opens a gathering. The id comes from the date and name, so opening the same
 * service twice just returns the one already there.
 * Saved on the device straight away; synced when online.
 */
export function createEvent(orgId: string, input: NewEvent, links?: EventLinks): { id: string; synced: Promise<unknown> } {
  const { id: linkedId, ...linkFields } = links ?? { id: '' };
  const id = linkedId || eventIdFor(input.date, input.name);
  const synced = trackWrite(setDoc(eventRef(orgId, id), {
    orgId,
    ...input,
    ...linkFields,
    headcounts: {},
    notes: '',
    ...createStamps(),
  })).catch((err: { code?: string }) => {
    // Another device opened the same service first (both offline): the server
    // keeps theirs, and check-ins from here still attach to it.
    if (err.code !== 'permission-denied') throw err;
  });
  return { id, synced };
}

export function saveHeadcounts(orgId: string, eventId: string, headcounts: Headcounts) {
  return updateRecord(eventRef(orgId, eventId), { headcounts });
}

export function saveEventNotes(orgId: string, eventId: string, notes: string) {
  return updateRecord(eventRef(orgId, eventId), { notes: notes.slice(0, 2000) });
}

export function deleteEvent(orgId: string, eventId: string) {
  return softDelete(eventRef(orgId, eventId));
}

/** A check-in carries its gathering's programme or group, so progress can be counted. */
type Gathering = { id: string; date: string; programId?: string | null; groupId?: string | null };
const linksOf = (event: Gathering) => ({
  ...(event.programId ? { programId: event.programId } : {}),
  ...(event.groupId ? { groupId: event.groupId } : {}),
});

export interface ExistingMark {
  status: AttendanceStatus;
  deletedAt: unknown;
}

/**
 * Records one person at one gathering. `existing` is what this device already
 * holds for them: a new record is created, a removed one is brought back, and
 * a current one has its mark changed.
 */
export function markAttendance(
  orgId: string,
  event: Gathering,
  personId: string,
  status: AttendanceStatus,
  method: CheckInMethod,
  existing: ExistingMark | undefined,
): Promise<unknown> {
  const ref = attendanceRef(orgId, event.id, personId);
  if (existing) {
    if (!existing.deletedAt && existing.status === status) return Promise.resolve();
    return updateRecord(ref, { status, method, deletedAt: null, deletedBy: null });
  }
  return trackWrite(setDoc(ref, {
    orgId,
    eventId: event.id,
    personId,
    date: event.date,
    ...linksOf(event),
    status,
    method,
    // The device's clock, so a check-in made offline keeps the time it happened.
    checkedInAt: Timestamp.now(),
    ...createStamps(),
  }));
}

/** Takes a check-in back (kept in the bin, like everything else). */
export function undoAttendance(orgId: string, eventId: string, personId: string) {
  return softDelete(attendanceRef(orgId, eventId, personId));
}

/** Marks several people in one save, for "everyone else present" on a class register. */
export function markMany(
  orgId: string,
  event: Gathering,
  people: { personId: string; existing: ExistingMark | undefined }[],
  status: AttendanceStatus,
): Promise<unknown> {
  // Firestore batches hold up to 500 writes; a class is far smaller, but stay safe.
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < people.length; i += 400) {
    const batch = writeBatch(db);
    for (const { personId, existing } of people.slice(i, i + 400)) {
      const ref = attendanceRef(orgId, event.id, personId);
      if (existing) {
        batch.update(ref, { status, method: 'register', deletedAt: null, deletedBy: null, ...updateStamps() });
      } else {
        batch.set(ref, {
          orgId, eventId: event.id, personId, date: event.date, ...linksOf(event), status, method: 'register',
          checkedInAt: Timestamp.now(), ...createStamps(),
        });
      }
    }
    writes.push(trackWrite(batch.commit()));
  }
  return Promise.all(writes);
}
