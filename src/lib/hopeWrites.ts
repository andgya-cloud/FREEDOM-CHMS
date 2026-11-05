import type { ChildSponsorship, SponsorRowPlan } from '../../functions/src/shared/hopeSponsorship';
import { updatePerson } from './peopleWrites';
import { collection, deleteField, doc, serverTimestamp, setDoc, updateDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import { firstName } from '../../functions/src/shared/people';
import type { Child, ChildPayment, ChildProgramme, Consent, SchoolStatus } from '../../functions/src/shared/hope';
import type { ChampionEntry, ChildImportRow, ChampionImportRow, KidEntry } from '../../functions/src/shared/hopeRegister';
import { normalizePhone } from '../../functions/src/shared/phone';
import { clubDayId, STARTER_CLUBS, type Club, type ClubWin } from '../../functions/src/shared/hopeClubs';
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
  sponsorName?: string;
  sponsorPhone?: string;
  sponsorEmail?: string;
  parentName?: string;
  parentPhone?: string;
  schoolClass?: string;
  payment?: ChildPayment | null;
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
  code: string | null = null,
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
  batch.set(ref(orgId, 'children', childId), { orgId, code, status: 'active', exitedOn: null, ...details, ...createStamps() });
  // A code kept from an uploaded sheet is claimed in the same save, so no two children share it.
  if (code) batch.set(ref(orgId, 'childCodes', code), { orgId, childId });
  return { id: childId, synced: trackWrite(batch.commit()) };
}

export function updateChild(orgId: string, childId: string, changes: Partial<ChildDetails> & Partial<Pick<Child, 'status' | 'exitedOn' | 'departingNote' | 'hasPhoto'>>) {
  // Photo consent taken away: the photo goes too, in the same save.
  if (changes.photoConsent && changes.photoConsent.given !== true) {
    const batch = writeBatch(db);
    batch.update(ref(orgId, 'children', childId), { ...changes, hasPhoto: false, updatedAt: serverTimestamp(), updatedBy: me() });
    batch.delete(ref(orgId, 'childPhotos', childId));
    return trackWrite(batch.commit());
  }
  return updateRecord(ref(orgId, 'children', childId), changes);
}

/**
 * Saves a sponsorship list upload (Andy, 2026-11-05): each child's sponsorship, the empty fields it fills, and the
 * gender on the person when it was blank. One child at a time, so a large list keeps within the rules' limits.
 */
export async function saveSponsorList(orgId: string, rows: SponsorRowPlan[], onProgress?: (done: number) => void,
  notOnList: { id: string; sponsorship: ChildSponsorship }[] = []) {
  let done = 0;
  // Children not on the list are marked "Not on KE-014" (Andy, 2026-11-05, 5A).
  for (let i = 0; i < notOnList.length; i += 10) {
    await Promise.all(notOnList.slice(i, i + 10).map(async (c) => {
      await updateRecord(ref(orgId, 'children', c.id), { sponsorship: c.sponsorship });
      onProgress?.(++done);
    }));
  }
  for (let i = 0; i < rows.length; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(async (r) => {
      const { gender, ...fill } = r.fill;
      await updateRecord(ref(orgId, 'children', r.childId), { ...fill, sponsorship: r.sponsorship });
      if (gender) await updatePerson(orgId, r.childId, { gender });
      onProgress?.(++done);
    }));
  }
}

// A child's photo is saved and removed on the server, with an approver's password: see lib/childPhoto.ts.

/**
 * Marks one child (or champion) on a day's register. A merge, so two tablets marking the same Saturday never
 * overwrite each other's marks, even offline.
 */
function markDay(orgId: string, name: 'hopeDays' | 'championDays', date: string, id: string, entry: DocumentData | null) {
  return markMany(orgId, name, date, { [id]: entry ?? deleteField() });
}
export const markKid = (orgId: string, date: string, childId: string, entry: KidEntry | null) => markDay(orgId, 'hopeDays', date, childId, entry as DocumentData | null);
export const markChampion = (orgId: string, date: string, championId: string, entry: ChampionEntry | null) => markDay(orgId, 'championDays', date, championId, entry as DocumentData | null);

/** Marks several at once ("Mark the rest absent"). */
export function markMany(orgId: string, name: 'hopeDays' | 'championDays', date: string, entries: Record<string, unknown>) {
  return trackWrite(setDoc(ref(orgId, name, date), { orgId, date, marks: entries, updatedAt: serverTimestamp(), updatedBy: me() }, { merge: true }));
}

export interface ChampionInput { name: string; phone: string; email: string; duty: string; status: 'active' | 'left'; joinedOn: string | null }
export function addChampion(orgId: string, input: ChampionInput) {
  const r = doc(collection(db, 'organizations', orgId, 'champions'));
  void trackWrite(setDoc(r, { orgId, ...input, ...createStamps() }));
  return r.id;
}
export function updateChampion(orgId: string, id: string, changes: Partial<ChampionInput>) {
  return updateRecord(ref(orgId, 'champions', id), changes);
}
/** Weekly pay and card codes (Andy, 2026-11-05, 8A 11A), several champions at once. */
export function setChampionFields(orgId: string, changes: Record<string, { weeklyPay?: number | null; monthlyPay?: number | null; code?: string }>) {
  const batch = writeBatch(db);
  for (const [id, c] of Object.entries(changes)) batch.update(ref(orgId, 'champions', id), { ...c, updatedAt: serverTimestamp(), updatedBy: me() });
  return trackWrite(batch.commit());
}
/** An extra allowance for a month (9A). */
export function addChampionExtra(orgId: string, championId: string, month: string, amount: number, reason: string) {
  return trackWrite(setDoc(doc(collection(db, 'organizations', orgId, 'championExtras')), { orgId, championId, month, amount: Math.round(amount), reason: reason.trim().slice(0, 200), ...createStamps() }));
}
export const removeChampionExtra = (orgId: string, id: string) => softDelete(ref(orgId, 'championExtras', id));
/** The Director approves a month's pay (10A). */
export function approveChampionPay(orgId: string, month: string, total: number, count: number, approvedName: string) {
  return trackWrite(setDoc(ref(orgId, 'championPay', month), { orgId, month, total: Math.round(total), count, approvedBy: me(), approvedName: approvedName.slice(0, 120), approvedAt: serverTimestamp() }));
}

/** Adds new champions and updates the ones already here (Andy, 2026-11-05): phone, email, duty and pay. */
export function importChampions(orgId: string, rows: ChampionImportRow[]) {
  const batch = writeBatch(db);
  const pay = (r: ChampionImportRow) => (r.monthlyPay != null ? { monthlyPay: r.monthlyPay, weeklyPay: null } : r.weeklyPay != null ? { weeklyPay: r.weeklyPay, monthlyPay: null } : {});
  for (const r of rows) {
    if (r.updateId) {
      batch.update(ref(orgId, 'champions', r.updateId), {
        ...(r.phone ? { phone: r.phone } : {}), ...(r.email ? { email: r.email } : {}), ...(r.duty ? { duty: r.duty } : {}), ...pay(r),
        updatedAt: serverTimestamp(), updatedBy: me(),
      });
      continue;
    }
    batch.set(doc(collection(db, 'organizations', orgId, 'champions')), { orgId, name: r.name, phone: r.phone, email: r.email, duty: r.duty, status: 'active', joinedOn: r.joinedOn, ...pay(r), ...createStamps() });
  }
  return trackWrite(batch.commit());
}

/** Adds the children from a spreadsheet, each with their parent as guardian when a parent is named. */
/**
 * Adds the children from a sheet, keeping the sheet's codes (Andy, 2026-11-04, 4A). onProgress reports how many
 * have reached the server, so the page can say "Saving 120 of 196".
 */
export function importChildren(orgId: string, rows: ChildImportRow[], today: string, onProgress?: (saved: number) => void) {
  const consent = (v: boolean | null): Consent => (v == null ? { given: null, date: null } : { given: v, date: today });
  let saved = 0;
  return Promise.all(rows.map((r) => {
    const phone = r.parentPhone ? normalizePhone(r.parentPhone) : null;
    const { synced } = registerChild(
      orgId,
      { person: { fullName: r.name, phone: null, whatsapp: null, whatsappConsent: { given: false, date: null, recordedBy: null, stoppedAt: null }, gender: r.gender } },
      r.parentName ? { person: { fullName: r.parentName, phone, whatsapp: null, whatsappConsent: { given: false, date: null, recordedBy: null, stoppedAt: null } } } : null,
      {
        dateOfBirth: r.dateOfBirth, school: r.school, schoolStatus: r.school ? 'in_school' : 'unknown', enrolledOn: r.enrolledOn, programmes: [],
        photoConsent: consent(r.photoConsent), guardianConsent: consent(r.guardianConsent),
        sponsorName: r.sponsorName, sponsorPhone: r.sponsorPhone, sponsorEmail: r.sponsorEmail, parentName: r.parentName, parentPhone: r.parentPhone,
        schoolClass: r.schoolClass, payment: r.payment,
      },
      r.code,
    );
    return synced.then(() => { saved += 1; onProgress?.(saved); });
  }));
}

/**
 * Records consent for many children at once (Andy, 2026-11-04, 5A). One write per child: the database checks
 * each child, and a single save of 196 children would be refused for too many checks.
 */
export function saveConsents(orgId: string, changes: { childId: string; guardian?: Consent; photo?: Consent }[]) {
  return Promise.all(changes.map((c) => updateRecord(ref(orgId, 'children', c.childId), {
    ...(c.guardian ? { guardianConsent: c.guardian } : {}), ...(c.photo ? { photoConsent: c.photo } : {}),
  })));
}

/** "I'm here": the time a helper arrived today (Andy, 2026-11-04, 2A). */
export function markHelperArrived(orgId: string, date: string, uid: string, name: string, time: string) {
  return trackWrite(setDoc(ref(orgId, 'helperDays', date), { orgId, date, marks: { [uid]: { name: name.slice(0, 120), t: time } }, updatedAt: serverTimestamp(), updatedBy: me() }, { merge: true }));
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

// ---- Clubs (Part 2) --------------------------------------------------------------------------------

export type ClubInput = Omit<Club, 'id' | 'deletedAt'>;

export function addClub(orgId: string, input: ClubInput) {
  const r = doc(collection(db, 'organizations', orgId, 'clubs'));
  void trackWrite(setDoc(r, { orgId, ...input, ...createStamps() }));
  return r.id;
}
export function updateClub(orgId: string, id: string, changes: Partial<ClubInput>) {
  return updateRecord(ref(orgId, 'clubs', id), changes);
}

/**
 * Makes Andy's eight clubs in one go. Football, Chess and Music start with the children already in those
 * programmes, and their team or level carried over.
 */
export function addStarterClubs(orgId: string, children: readonly Pick<Child, 'id' | 'status' | 'programmes'>[], existing: readonly string[]) {
  const batch = writeBatch(db);
  const have = new Set(existing.map((n) => n.toLowerCase()));
  let n = 0;
  for (const s of STARTER_CLUBS) {
    if (have.has(s.name.toLowerCase())) continue;
    const members = s.legacy ? children.filter((c) => c.status !== 'exited' && c.programmes.some((p) => p.name.toLowerCase() === s.legacy!.toLowerCase())) : [];
    const levels: Record<string, string> = {};
    for (const c of members) {
      const p = c.programmes.find((x) => x.name.toLowerCase() === s.legacy!.toLowerCase())!;
      const level = [p.group, p.level].filter(Boolean).join(' · ');
      if (level) levels[c.id] = level.slice(0, 60);
    }
    batch.set(doc(collection(db, 'organizations', orgId, 'clubs')), {
      orgId, name: s.name, emoji: s.emoji, description: '', day: 'Saturday', time: '', endTime: '', place: '', capacity: 0,
      memberIds: members.map((c) => c.id), leaderIds: [], levels, legacyProgramme: s.legacy, status: 'active', ...createStamps(),
    });
    n += 1;
  }
  return { added: n, synced: trackWrite(batch.commit()) };
}

/** Marks children on a club's register for a day (a merge, so two tablets never overwrite each other). */
export function markClub(orgId: string, clubId: string, date: string, entries: Record<string, KidEntry | null>) {
  const marks: Record<string, unknown> = {};
  for (const [id, e] of Object.entries(entries)) marks[id] = e ?? deleteField();
  return trackWrite(setDoc(ref(orgId, 'clubDays', clubDayId(clubId, date)), { orgId, clubId, date, marks, updatedAt: serverTimestamp(), updatedBy: me() }, { merge: true }));
}

export function addClubWin(orgId: string, input: Omit<ClubWin, 'id' | 'deletedAt'>) {
  const r = doc(collection(db, 'organizations', orgId, 'clubWins'));
  return trackWrite(setDoc(r, { orgId, ...input, title: input.title.trim().slice(0, 120), note: input.note.trim().slice(0, 1000), ...createStamps() }));
}
export function removeClubWin(orgId: string, id: string) {
  return softDelete(ref(orgId, 'clubWins', id));
}
