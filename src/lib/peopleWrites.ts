import { collection, doc, setDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { firstName, pipelineEntryId, type PersonStatus, type StageStatus } from '../../functions/src/shared/people';
import type { WhatsAppConsent } from '../state/PeopleContext';

export interface NewPersonInput {
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  whatsappConsent: WhatsAppConsent;
  email?: string | null;
  status: PersonStatus;
  firstVisitDate?: string | null;
  gender?: string | null;
  birthday?: string | null;
  householdId?: string | null;
  guardianId?: string | null;
  howHeard?: string | null;
  invitedBy?: string | null;
  invitedById?: string | null;
  serviceAttended?: string | null;
  customFields?: Record<string, unknown>;
}

/**
 * Adds a person in one batch: the person, the completed "Visitor" stage on
 * their timeline (church campuses), and a prayer need if one was given.
 * Saved on the device straight away; synced when online.
 */
export function addPerson(orgId: string, input: NewPersonInput, options: { prayerNeed?: string; recordVisitorStage?: boolean } = {}) {
  const batch = writeBatch(db);
  const personRef = doc(collection(db, 'organizations', orgId, 'people'));
  batch.set(personRef, {
    ...input,
    orgId,
    firstName: firstName(input.fullName),
    possibleDuplicateIds: [],
    customFields: input.customFields ?? {},
    ...createStamps(),
  });
  if (options.recordVisitorStage) {
    batch.set(doc(db, 'organizations', orgId, 'pipeline', pipelineEntryId(personRef.id, 'visitor')), {
      orgId,
      personId: personRef.id,
      stageId: 'visitor',
      sensitive: false,
      status: 'completed',
      date: input.firstVisitDate ?? null,
      notes: '',
      details: {},
      ...createStamps(),
    });
  }
  const prayer = options.prayerNeed?.trim();
  if (prayer) {
    batch.set(doc(collection(db, 'organizations', orgId, 'prayerRequests')), {
      orgId,
      personId: personRef.id,
      text: prayer,
      status: 'open',
      ...createStamps(),
    });
  }
  return { ref: personRef, synced: trackWrite(batch.commit()) };
}

export function updatePerson(orgId: string, personId: string, changes: DocumentData) {
  const next = { ...changes };
  if (typeof next.fullName === 'string') next.firstName = firstName(next.fullName);
  return updateRecord(doc(db, 'organizations', orgId, 'people', personId), next);
}

export interface StageChange {
  status: StageStatus;
  date: string | null;
  notes: string;
  details?: Record<string, unknown>;
}

/** Records a person's progress on one pipeline stage. */
export function saveStage(orgId: string, personId: string, stageId: string, sensitive: boolean, change: StageChange, exists: boolean) {
  const ref = doc(db, 'organizations', orgId, 'pipeline', pipelineEntryId(personId, stageId));
  const data = { ...change, details: change.details ?? {} };
  if (exists) return updateRecord(ref, data);
  return trackWrite(setDoc(ref, { orgId, personId, stageId, sensitive, ...data, ...createStamps() }));
}

export function addPastoralNote(orgId: string, personId: string, text: string) {
  const ref = doc(collection(db, 'organizations', orgId, 'pastoralNotes'));
  return trackWrite(setDoc(ref, { orgId, personId, text: text.trim(), ...createStamps() }));
}

export function addPrayerRequest(orgId: string, personId: string, text: string) {
  const ref = doc(collection(db, 'organizations', orgId, 'prayerRequests'));
  return trackWrite(setDoc(ref, { orgId, personId, text: text.trim(), status: 'open', ...createStamps() }));
}

export { updateStamps };
