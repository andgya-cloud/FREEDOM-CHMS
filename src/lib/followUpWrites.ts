import { collection, doc, serverTimestamp, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { updatePerson } from './peopleWrites';
import { endOfLocalDay, SENSITIVE_TEMPLATES, type FollowUpOutcome, type MessageTemplate } from '../../functions/src/shared/followups';
import type { FollowUp, StaffMember } from '../state/useFollowUps';
import type { Person } from '../state/PeopleContext';

/**
 * Follow-up and message writes. Like everything else they are saved on the
 * device first and synced when online, so staff can work the queue offline.
 */
function me(): string {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
}
const taskRef = (t: Pick<FollowUp, 'orgId' | 'id'>) => doc(db, 'organizations', t.orgId, 'followUps', t.id);

export function markDone(task: FollowUp, outcome: FollowUpOutcome, note?: string) {
  return updateRecord(taskRef(task), {
    status: 'done', outcome, doneAt: serverTimestamp(), doneBy: me(),
    ...(note !== undefined ? { note: note.trim() } : {}),
  });
}

export function reopen(task: FollowUp) {
  return updateRecord(taskRef(task), { status: 'open', outcome: null, doneAt: null, doneBy: null });
}

export function assign(task: FollowUp, staff: StaffMember | null) {
  return updateRecord(taskRef(task), { assignedTo: staff?.id ?? null, assignedName: staff?.displayName ?? null });
}

export function setNote(task: FollowUp, note: string) {
  return updateRecord(taskRef(task), { note: note.trim() });
}

/** A follow-up staff add themselves, for example "call about the hospital visit". */
export function addFollowUp(orgId: string, person: Person, input: { note: string; dueDate: string; timeZone: string; assignee: StaffMember | null }) {
  const [y, m, d] = input.dueDate.split('-').map(Number) as [number, number, number];
  const dueAt = endOfLocalDay(new Date(Date.UTC(y, m - 1, d, 12)), input.timeZone);
  const ref = doc(collection(db, 'organizations', orgId, 'followUps'));
  const synced = trackWrite(setDoc(ref, {
    orgId, personId: person.id, personName: person.fullName, reason: 'other', templateId: 'checkin_48h', status: 'open',
    assignedTo: input.assignee?.id ?? null, assignedName: input.assignee?.displayName ?? null,
    dueAt: Timestamp.fromDate(dueAt), outcome: null, note: input.note.trim(), doneAt: null, doneBy: null,
    lastMessageAt: null, absentSince: null, ...createStamps(),
  }));
  return { ref, synced };
}

/**
 * Records that a WhatsApp message was sent: who sent it, when, to whom and
 * with which template. The task, if any, shows when it was last messaged.
 */
export function logMessage(input: {
  orgId: string;
  about: Person;
  to: Person;
  viaGuardian: boolean;
  template: MessageTemplate;
  senderName: string;
  followUp?: FollowUp | null;
  giftId?: string | null;
}) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'organizations', input.orgId, 'messages')), {
    orgId: input.orgId,
    personId: input.about.id,
    toPersonId: input.to.id,
    toName: input.to.fullName,
    viaGuardian: input.viaGuardian,
    channel: 'whatsapp',
    templateId: input.template.id,
    templateName: input.template.name.slice(0, 80),
    followUpId: input.followUp?.id ?? null,
    giftId: input.giftId ?? null,
    sensitive: SENSITIVE_TEMPLATES.includes(input.template.id),
    senderName: input.senderName.slice(0, 80),
    createdAt: serverTimestamp(),
    createdBy: me(),
  });
  if (input.followUp) batch.update(taskRef(input.followUp), { lastMessageAt: serverTimestamp(), ...updateStamps() });
  return trackWrite(batch.commit());
}

/** "Asked us to stop": no more WhatsApp messages from the app to this person. */
export function stopWhatsApp(person: Person, today: string) {
  return updatePerson(person.orgId, person.id, {
    whatsappConsent: { ...person.whatsappConsent, given: false, stoppedAt: today, recordedBy: me() },
  });
}

/** Saves the WhatsApp templates (Settings). */
export function saveTemplates(templates: MessageTemplate[], exists: boolean) {
  const ref = doc(db, 'settings', 'whatsappTemplates');
  const clean = templates.map((t) => ({ id: t.id, name: t.name.trim(), body: t.body.trim() }));
  return exists
    ? updateRecord(ref, { templates: clean })
    : trackWrite(setDoc(ref, { templates: clean, ...createStamps() }));
}


/** Records a message to a student's sponsor or guardian (who has no record of their own). */
export function logSponsorMessage(input: { orgId: string; studentId: string; sponsorName: string; template: MessageTemplate; senderName: string }) {
  return trackWrite(setDoc(doc(collection(db, 'organizations', input.orgId, 'messages')), {
    orgId: input.orgId,
    personId: input.studentId,
    toPersonId: input.studentId,
    toName: input.sponsorName.slice(0, 80),
    viaGuardian: true,
    channel: 'whatsapp',
    templateId: input.template.id,
    templateName: input.template.name.slice(0, 80),
    followUpId: null,
    giftId: null,
    sensitive: false,
    senderName: input.senderName.slice(0, 80),
    createdAt: serverTimestamp(),
    createdBy: me(),
  }));
}
