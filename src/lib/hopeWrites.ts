import { collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import { firstName } from '../../functions/src/shared/people';
import type { Child, ChildProgramme, Consent, SchoolStatus } from '../../functions/src/shared/hope';
import type { WhatsAppConsent } from '../state/PeopleContext';

const ref = (orgId: string, name: string, id: string) => doc(db, 'organizations', orgId, name, id);
const me = () => {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
};

export interface ChildDetails {
  dateOfBirth: string | null;
  school: string;
  schoolStatus: SchoolStatus;
  enrolledOn: string | null;
  programmes: ChildProgramme[];
  photoConsent: Consent;
  guardianConsent: Consent;
}
export interface PersonInput { fullName: string; phone: string | null; whatsapp: string | null; whatsappConsent: WhatsAppConsent; gender?: string | null }

/**
 * Registers a child: the child's person record, the guardian's (new, or an existing person), and the child
 * register entry, in one batch. Saves on the device first; the code (HC-0042) is added by the server.
 * Consent can be left blank: saving never waits for it.
 */
export function registerChild(
  orgId: string,
  child: { personId: string } | { person: PersonInput },
  guardian: { personId: string } | { person: PersonInput } | null,
  details: ChildDetails,
) {
  const batch = writeBatch(db);
  let guardianId: string | null = null;
  if (guardian) {
    if ('personId' in guardian) guardianId = guardian.personId;
    else {
      const g = doc(collection(db, 'organizations', orgId, 'people'));
      guardianId = g.id;
      batch.set(g, {
        ...guardian.person, orgId, firstName: firstName(guardian.person.fullName), email: null, status: 'regular',
        firstVisitDate: null, gender: guardian.person.gender ?? null, possibleDuplicateIds: [], customFields: {}, ...createStamps(),
      });
    }
  }
  let childId: string;
  if ('personId' in child) {
    childId = child.personId;
    batch.update(ref(orgId, 'people', childId), { ...(guardianId ? { guardianId } : {}), status: 'child', updatedAt: serverTimestamp(), updatedBy: me() });
  } else {
    const c = doc(collection(db, 'organizations', orgId, 'people'));
    childId = c.id;
    batch.set(c, {
      ...child.person, orgId, firstName: firstName(child.person.fullName), email: null, status: 'child', guardianId,
      firstVisitDate: null, gender: child.person.gender ?? null, possibleDuplicateIds: [], customFields: {}, ...createStamps(),
    });
  }
  batch.set(ref(orgId, 'children', childId), { orgId, code: null, status: 'active', exitedOn: null, ...details, ...createStamps() });
  return { id: childId, synced: trackWrite(batch.commit()) };
}

export function updateChild(orgId: string, childId: string, changes: Partial<ChildDetails> & Partial<Pick<Child, 'status' | 'exitedOn'>>) {
  return updateRecord(ref(orgId, 'children', childId), changes);
}

export function saveChildPrivate(orgId: string, childId: string, data: { welfare: string; health: string; home: string }, exists: boolean) {
  return exists
    ? updateRecord(ref(orgId, 'childPrivate', childId), data)
    : trackWrite(setDoc(ref(orgId, 'childPrivate', childId), { orgId, ...data, ...createStamps() }));
}

export function addHomeVisit(orgId: string, childId: string, date: string, note: string) {
  const r = doc(collection(db, 'organizations', orgId, 'homeVisits'));
  return trackWrite(setDoc(r, { orgId, childId, date, note: note.trim().slice(0, 3000), ...createStamps() }));
}

export function addReferral(orgId: string, childId: string, input: { date: string; to: string; reason: string }) {
  const r = doc(collection(db, 'organizations', orgId, 'referrals'));
  return trackWrite(setDoc(r, { orgId, childId, date: input.date, to: input.to.trim().slice(0, 120), reason: input.reason.trim().slice(0, 1000), status: 'open', outcome: '', ...createStamps() }));
}

export function closeReferral(orgId: string, referralId: string, outcome: string) {
  return updateRecord(ref(orgId, 'referrals', referralId), { status: 'closed', outcome: outcome.trim().slice(0, 1000) });
}

/** Raises a safeguarding concern. Whoever raises it cannot open it again: only the pastor reads it. */
export function raiseConcern(orgId: string, childId: string, summary: string) {
  const r = doc(collection(db, 'organizations', orgId, 'safeguardingConcerns'));
  return trackWrite(setDoc(r, { orgId, childId, summary: summary.trim().slice(0, 4000), status: 'open', createdAt: serverTimestamp(), createdBy: me() }));
}

export function closeConcern(orgId: string, concernId: string, note: string) {
  return trackWrite(updateDoc(ref(orgId, 'safeguardingConcerns', concernId), { status: 'closed', closingNote: note.trim().slice(0, 2000), closedAt: serverTimestamp(), closedBy: me() }));
}

/** Asks to export child data. The pastor's own request is approved on the spot; anyone else's waits for the pastor. */
export function requestChildExport(orgId: string, scope: 'register' | 'attendance', reason: string, isPastor: boolean) {
  const r = doc(collection(db, 'organizations', orgId, 'childExports'));
  const uid = me();
  const base = { orgId, scope, reason: reason.trim().slice(0, 300), createdAt: serverTimestamp(), createdBy: uid };
  void trackWrite(setDoc(r, isPastor ? { ...base, status: 'approved', decidedBy: uid, decidedAt: serverTimestamp() } : { ...base, status: 'pending' }));
  return r.id;
}
export function decideChildExport(orgId: string, id: string, approve: boolean) {
  return trackWrite(updateDoc(ref(orgId, 'childExports', id), { status: approve ? 'approved' : 'denied', decidedBy: me(), decidedAt: serverTimestamp() }));
}
export function markExportDownloaded(orgId: string, id: string) {
  return trackWrite(updateDoc(ref(orgId, 'childExports', id), { downloadedAt: serverTimestamp() }));
}

export function requestHopeReport(orgId: string, type: 'weekly' | 'monthly', from: string) {
  const r = doc(collection(db, 'organizations', orgId, 'hopeReportRequests'));
  void trackWrite(setDoc(r, { orgId, type, from, status: 'pending', createdAt: serverTimestamp(), createdBy: me() }));
  return r.id;
}

export function requestAbsenceCheck(orgId: string) {
  const r = doc(collection(db, 'organizations', orgId, 'absenceCheckRequests'));
  void trackWrite(setDoc(r, { orgId, status: 'pending', createdAt: serverTimestamp(), createdBy: me() }));
  return r.id;
}
