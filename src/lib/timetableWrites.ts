import { deleteField, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { DEFAULT_PERIODS, type ClassSlot, type ClassTimetable, type ExamTimetable } from '../../functions/src/shared/timetable';

const classRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'classTimetables', id);
const examRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'examTimetables', id);

/** Starts a class timetable (Andy, 2026-11-20). Works offline. */
export function startClassTimetable(orgId: string, id: string, base: Pick<ClassTimetable, 'cohort' | 'semester' | 'courseId'> & Partial<ClassTimetable>) {
  const data: ClassTimetable = { orgId, periods: DEFAULT_PERIODS, saturday: false, slots: {}, from: null, to: null, published: false, publishedOn: null, changedOn: null, ...base };
  return trackWrite(setDoc(classRef(orgId, id), { ...data, ...createStamps() }));
}

/** 11A: once published, every change shows "Updated <date>". */
const changed = (t: { published: boolean }, today: string) => (t.published ? { changedOn: today } : {});

export function saveClassTimetable(orgId: string, t: ClassTimetable & { id: string }, changes: Partial<ClassTimetable>, today: string) {
  return updateRecord(classRef(orgId, t.id), { ...changes, ...changed(t, today) });
}

/** One box of the grid; null empties it. */
export function saveClassSlot(orgId: string, t: ClassTimetable & { id: string }, key: string, slot: ClassSlot | null, today: string) {
  return updateRecord(classRef(orgId, t.id), { [`slots.${key}`]: slot ?? deleteField(), ...changed(t, today) });
}

export function publishTimetable(kind: 'class' | 'exam', orgId: string, id: string, published: boolean, today: string) {
  const ref = kind === 'class' ? classRef(orgId, id) : examRef(orgId, id);
  return updateRecord(ref, published ? { published: true, publishedOn: today, changedOn: null } : { published: false });
}

export function startExamTimetable(orgId: string, id: string, data: Omit<ExamTimetable, 'orgId' | 'published' | 'publishedOn' | 'changedOn'>) {
  return trackWrite(setDoc(examRef(orgId, id), { orgId, published: false, publishedOn: null, changedOn: null, ...data, ...createStamps() }));
}

export function saveExamRows(orgId: string, t: ExamTimetable & { id: string }, rows: ExamTimetable['rows'], today: string) {
  return updateRecord(examRef(orgId, t.id), { rows, ...changed(t, today) });
}

/** 14A: the rooms list. */
export function saveRooms(orgId: string, rooms: string[], exists: boolean) {
  const ref = doc(db, 'organizations', orgId, 'timetableSetup', 'main');
  return trackWrite(exists ? setDoc(ref, { rooms, ...updateStamps() }, { merge: true }) : setDoc(ref, { orgId, rooms, ...createStamps() }));
}
