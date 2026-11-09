import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateStamps } from './records';
import { trackWrite } from './sync';
import type { BankLine, BankStatement, DailyBankEntry, OwnedItem } from '../../functions/src/shared/finance';

/** A year's statement can hold thousands of lines; each saved part keeps well under Firestore's 1 MB a document. */
export const LINES_PER_PART = 2000;

function me(): string {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
}

/**
 * Saves an uploaded statement, one saved part for each month (and at most 2,000 lines a part). A year's
 * statement is uploaded once; keeping each month apart means closing one month locks only that month.
 */
export async function saveStatement(orgId: string, s: Omit<BankStatement, 'id'>): Promise<void> {
  const col = collection(db, 'organizations', orgId, 'bankStatements');
  const byMonth = new Map<string, BankLine[]>();
  for (const l of s.lines) { const m = l.d.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) ?? []), l]); }
  const writes: Promise<unknown>[] = [];
  for (const monthLines of byMonth.values()) {
    for (let n = 0; n < monthLines.length; n += LINES_PER_PART) {
      const part = monthLines.slice(n, n + LINES_PER_PART).map((l) => ({ ...l, t: l.t.slice(0, 200), r: l.r.slice(0, 60) }));
      const first = part[0]!; const last = part[part.length - 1]!;
      writes.push(trackWrite(setDoc(doc(col), {
        orgId, account: s.account.slice(0, 80), accountKind: s.accountKind, fileName: s.fileName.slice(0, 120),
        from: first.d, to: last.d, openingCents: first.b - first.i + first.o, closingCents: last.b,
        lines: part, ...createStamps(),
      })));
    }
  }
  await Promise.all(writes);
}

/** Changes the categories of a statement's lines. */
export function saveLines(orgId: string, statementId: string, lines: BankLine[]): Promise<unknown> {
  return trackWrite(updateDoc(doc(db, 'organizations', orgId, 'bankStatements', statementId), { lines, ...updateStamps() }));
}

/** Takes an uploaded statement out (it can be uploaded again). */
export function removeStatement(orgId: string, statementId: string): Promise<unknown> {
  return trackWrite(updateDoc(doc(db, 'organizations', orgId, 'bankStatements', statementId), { deletedAt: serverTimestamp(), deletedBy: me(), ...updateStamps() }));
}

/** The remembered choices ("learned"), the monthly budget ("budget") and what we own and owe ("owned"). */
export function saveFinBook(orgId: string, id: 'learned', data: Record<string, string>): Promise<unknown>;
export function saveFinBook(orgId: string, id: 'budget', data: Record<string, number>): Promise<unknown>;
export function saveFinBook(orgId: string, id: 'owned', data: OwnedItem[]): Promise<unknown>;
export function saveFinBook(orgId: string, id: 'learned' | 'budget' | 'owned', data: unknown): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'finBooks', id), { orgId, [id]: data, updatedAt: serverTimestamp(), updatedBy: me() }));
}

/** Bank money typed on the day (Andy, 2026-11-09, 1C). */
export function addBankDaily(orgId: string, e: Omit<DailyBankEntry, 'id'>): Promise<unknown> {
  return trackWrite(setDoc(doc(collection(db, 'organizations', orgId, 'bankDaily')), {
    orgId, date: e.date, dir: e.dir, cents: e.cents, account: e.account.slice(0, 80), text: e.text.slice(0, 120), category: e.category, ...createStamps(),
  }));
}
export function removeBankDaily(orgId: string, id: string): Promise<unknown> {
  return trackWrite(updateDoc(doc(db, 'organizations', orgId, 'bankDaily', id), { deletedAt: serverTimestamp(), deletedBy: me(), ...updateStamps() }));
}
/** The cash in the petty cash box, counted on a day. */
export function saveCashCount(orgId: string, date: string, countedCents: number, name: string): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'cashCounts', date), { orgId, date, countedCents, name: name.slice(0, 120), updatedAt: serverTimestamp(), updatedBy: me() }));
}

/**
 * Closing a month (Andy, 2026-11-09, 5A): Daniel prepares it, Andrew, Doreen or Elias approves in the app and
 * the month locks. Only the pastor opens it again.
 */
export function prepareFinMonth(orgId: string, month: string, name: string): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'finMonths', month), {
    orgId, month, status: 'prepared', preparedUid: me(), preparedName: name.slice(0, 120), preparedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me(),
  }));
}
export function approveFinMonth(orgId: string, month: string, prepared: { preparedUid: string; preparedName: string; preparedAt: unknown }, name: string): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'finMonths', month), {
    orgId, month, status: 'closed', preparedUid: prepared.preparedUid, preparedName: prepared.preparedName, preparedAt: prepared.preparedAt,
    approvedUid: me(), approvedName: name.slice(0, 120), approvedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me(),
  }));
}
export function reopenFinMonth(orgId: string, month: string): Promise<unknown> {
  return trackWrite(setDoc(doc(db, 'organizations', orgId, 'finMonths', month), { orgId, month, status: 'open', updatedAt: serverTimestamp(), updatedBy: me() }));
}
