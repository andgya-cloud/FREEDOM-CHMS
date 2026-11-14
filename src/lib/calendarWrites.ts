import { arrayUnion, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createRecord, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import { addDays, cleanReminders, daysBetween, endsOnFor, type CalendarEvent, type EventType, type Repeat, type Rsvp } from '../../functions/src/shared/calendar';

/** What the event form fills in. */
export interface EventInput {
  title: string;
  type: EventType;
  allDay: boolean;
  date: string;
  endDate: string;
  start: string | null;
  end: string | null;
  place: string;
  inCharge: string;
  notes: string;
  repeat: Repeat;
  repeatUntil: string | null;
  reminders: number[];
  remindAll: boolean;
  invited: string[];
  invitedNames: Record<string, string>;
}

/** For a repeating event: change or remove only this day, this day and the ones after it, or every day. */
export type Scope = 'one' | 'following' | 'all';

let myName = '';
/** The name shown as "Added by" on new events (the signed-in person's account name). */
export function setCalendarName(name: string) { myName = name; }

const col = (orgId: string) => collection(db, 'organizations', orgId, 'calendar');
const ref = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'calendar', id);

function fields(input: EventInput) {
  const endDate = input.endDate && input.endDate >= input.date ? input.endDate : input.date;
  const repeatUntil = input.repeat === 'none' ? null : input.repeatUntil && input.repeatUntil >= input.date ? input.repeatUntil : null;
  const base = {
    title: input.title.trim().slice(0, 120),
    type: input.type,
    allDay: input.allDay,
    date: input.date,
    endDate,
    start: input.allDay ? null : input.start,
    end: input.allDay ? null : input.end,
    place: input.place.trim().slice(0, 160),
    inCharge: input.inCharge.trim().slice(0, 120),
    notes: input.notes.trim().slice(0, 3000),
    repeat: input.repeat,
    repeatUntil,
    reminders: cleanReminders(input.reminders),
    remindAll: input.remindAll,
    invited: [...new Set(input.invited)].slice(0, 150),
    invitedNames: Object.fromEntries(input.invited.map((uid) => [uid, (input.invitedNames[uid] ?? '').slice(0, 120)])),
  };
  return { ...base, endsOn: endsOnFor(base) };
}

export function createEvent(orgId: string, input: EventInput, extra: { seriesId?: string; seriesDate?: string; responses?: Record<string, Rsvp> } = {}) {
  return createRecord(col(orgId), {
    orgId,
    ...fields(input),
    skipDates: [],
    seriesId: extra.seriesId ?? null,
    seriesDate: extra.seriesDate ?? null,
    responses: extra.responses ?? {},
    createdByName: (myName || auth.currentUser?.displayName || '').slice(0, 120),
  });
}

/** Saves a change. On a repeating event, `day` is the occurrence opened and `scope` says which days change. */
export async function saveEvent(e: CalendarEvent, input: EventInput, day: string, scope: Scope): Promise<void> {
  const r = ref(e.orgId, e.id);
  const keep = Object.fromEntries(Object.entries(e.responses ?? {}).filter(([uid]) => input.invited.includes(uid)));
  if (e.repeat === 'none' || scope === 'all' || (scope === 'following' && day === e.date)) {
    // Opened on a later day of a repeating event: a change of date moves the whole series by as many days.
    const shift = e.repeat === 'none' ? 0 : daysBetween(day, input.date);
    const moved = e.repeat === 'none' ? input : { ...input, date: addDays(e.date, shift), endDate: addDays(e.date, shift + daysBetween(input.date, input.endDate || input.date)) };
    await updateRecord(r, { ...fields(moved), responses: keep });
    return;
  }
  if (scope === 'one') {
    createEvent(e.orgId, { ...input, repeat: 'none', repeatUntil: null }, { seriesId: e.id, seriesDate: day, responses: keep });
    await updateRecord(r, { skipDates: arrayUnion(day) });
    return;
  }
  // This day and the ones after it: the old series stops the day before, and a new one starts here.
  const until = addDays(day, -1);
  await updateRecord(r, { repeatUntil: until, endsOn: endsOnFor({ ...e, repeatUntil: until }) });
  createEvent(e.orgId, input, { responses: keep });
}

/** Removes an event; on a repeating one, only this day, this day and after, or the whole series. */
export async function deleteEvent(e: CalendarEvent, day: string, scope: Scope, all: CalendarEvent[]): Promise<void> {
  const r = ref(e.orgId, e.id);
  if (e.repeat !== 'none' && scope === 'one') { await updateRecord(r, { skipDates: arrayUnion(day) }); return; }
  if (e.repeat !== 'none' && scope === 'following' && day > e.date) {
    const until = addDays(day, -1);
    await updateRecord(r, { repeatUntil: until, endsOn: endsOnFor({ ...e, repeatUntil: until }) });
    return;
  }
  await softDelete(r);
  // Days of this series that were changed on their own go with it.
  await Promise.all(all.filter((x) => x.seriesId === e.id && x.orgId === e.orgId).map((x) => softDelete(ref(x.orgId, x.id))));
}

/** "Yes, I'll be there" or "No": someone invited answers for themselves only. */
export function answerInvite(e: CalendarEvent, answer: Rsvp): Promise<unknown> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  return trackWrite(updateDoc(ref(e.orgId, e.id), { [`responses.${uid}`]: answer, updatedAt: serverTimestamp(), updatedBy: uid }));
}

export function setEmailReminders(uid: string, on: boolean): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'calendarPrefs', uid), { email: on, updatedAt: serverTimestamp() }));
}
