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

/** Saves an uploaded statement (in parts of up to 2,000 lines). */
export async function saveStatement(orgId: string, s: Omit<BankStatement, 'id'>): Promise<void> {
  const col = collection(db, 'organizations', orgId, 'bankStatements');
  const writes: Promise<unknown>[] = [];
  for (let n = 0; n < s.lines.length; n += LINES_PER_PART) {
    const part = s.lines.slice(n, n + LINES_PER_PART).map((l) => ({ ...l, t: l.t.slice(0, 200), r: l.r.slice(0, 60) }));
    const first = part[0]!; const last = part[part.length - 1]!;
    writes.push(trackWrite(setDoc(doc(col), {
      orgId, account: s.account.slice(0, 80), accountKind: s.accountKind, fileName: s.fileName.slice(0, 120),
      from: n === 0 ? s.from || first.d : first.d, to: n + LINES_PER_PART >= s.lines.length ? s.to || last.d : last.d,
      openingCents: n === 0 ? s.openingCents : first.b - first.i + first.o, closingCents: last.b,
      lines: part, ...createStamps(),
    })));
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
