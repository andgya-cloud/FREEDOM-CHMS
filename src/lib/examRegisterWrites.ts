import { collection, doc, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { registerId, transcriptSerial, type ExamRegister, type RegisterEntry, type TranscriptRecord } from '../../functions/src/shared/examRegister';

const regRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'examRegisters', id);

/** Starts the register for a cohort's exam sitting (Andy, 2026-11-19). Works offline; returns its id. */
export function startExamRegister(orgId: string, cohort: string, sitting: string, rules: ExamRegister['rules']): string {
  const id = registerId(cohort, sitting);
  const data: ExamRegister = { orgId, cohort, sitting: sitting.trim().slice(0, 80), entries: {}, locked: false, lockedOn: null, lockedByName: null, rules };
  void trackWrite(setDoc(regRef(orgId, id), { ...data, ...createStamps() }));
  return id;
}

/** One student's line (or a few fields of it). */
export function saveRegisterEntry(orgId: string, id: string, studentId: string, changes: Partial<RegisterEntry>) {
  return updateRecord(regRef(orgId, id), Object.fromEntries(Object.entries(changes).map(([k, v]) => [`entries.${studentId}.${k}`, v === undefined ? null : v])));
}

/** "Fill in from results": every student not picked yet gets the suggestion. */
export function fillRegister(orgId: string, id: string, picks: Record<string, RegisterEntry>) {
  return updateRecord(regRef(orgId, id), Object.fromEntries(Object.entries(picks).map(([sid, e]) => [`entries.${sid}`, e])));
}

export function lockRegister(orgId: string, id: string, locked: boolean, today: string, byName: string) {
  return updateRecord(regRef(orgId, id), locked ? { locked: true, lockedOn: today, lockedByName: byName.slice(0, 120) } : { locked: false, lockedOn: null, lockedByName: null });
}

export type NewTranscript = Omit<TranscriptRecord, 'orgId' | 'serial' | 'year' | 'n'>;

/**
 * Gives each new transcript the next serial number for the year (Andy, 2026-11-19, 7A). Needs the internet,
 * so two people never give out the same number. Returns the tokens and serials, in order.
 */
export async function issueTranscripts(orgId: string, list: NewTranscript[], year: number): Promise<{ token: string; serial: string }[]> {
  if (!list.length) return [];
  if (!navigator.onLine) throw new Error('Connect to the internet to print transcripts, so each one gets its own serial number.');
  const out: { token: string; serial: string }[] = [];
  const counter = doc(db, 'organizations', orgId, 'examCounters', `transcripts-${year}`);
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const made = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counter);
      const last = snap.exists() ? Number(snap.data().last) || 0 : 0;
      const res: { token: string; serial: string }[] = [];
      chunk.forEach((t, k) => {
        const n = last + k + 1;
        const ref = doc(collection(db, 'organizations', orgId, 'examTranscripts'));
        const serial = transcriptSerial(year, n);
        tx.set(ref, { ...t, orgId, serial, year, n, ...createStamps() });
        res.push({ token: ref.id, serial });
      });
      const next = last + chunk.length;
      tx.set(counter, snap.exists() ? { ...snap.data(), last: next, ...updateStamps() } : { orgId, year, last: next, ...createStamps() });
      return res;
    });
    out.push(...made);
  }
  return out;
}
