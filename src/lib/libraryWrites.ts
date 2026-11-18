import { arrayUnion, collection, doc, increment, runTransaction, setDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps, softDelete, updateRecord, updateStamps } from './records';
import { trackWrite } from './sync';
import { addDays, bookNo, type BookLoan, type BorrowerKind, type ImportedBook, type LibraryBook, type LibrarySettings } from '../../functions/src/shared/library';

const col = (orgId: string, name: string) => collection(db, 'organizations', orgId, name);
const bookRef = (orgId: string, id: string) => doc(db, 'organizations', orgId, 'libraryBooks', id);

/**
 * Adds books, one document per copy, each with the next LIB number (Andy, 2026-11-18, 3A 4A). Needs the internet,
 * so two phones never give out the same number. Returns the numbers given.
 */
export async function addBooks(orgId: string, list: ImportedBook[], today: string, highestSoFar: number): Promise<string[]> {
  const copies = list.flatMap((b) => Array.from({ length: Math.max(1, b.copies) }, () => b));
  const given: string[] = [];
  const counter = doc(db, 'organizations', orgId, 'libraryMeta', 'counter');
  if (!navigator.onLine) throw new Error('Connect to the internet to add books, so each copy gets its own number.');
  for (let i = 0; i < copies.length; i += 400) {
    const chunk = copies.slice(i, i + 400);
    const nos = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counter);
      const start = Math.max(snap.exists() ? Number(snap.data().next) || 1 : 1, highestSoFar + 1);
      const out: string[] = [];
      chunk.forEach((b, k) => {
        const n = start + k;
        const no = bookNo(n);
        out.push(no);
        tx.set(bookRef(orgId, no), {
          orgId, no, n, title: b.title.trim().slice(0, 200), author: b.author.trim().slice(0, 120), category: b.category, isbn: b.isbn, shelf: b.shelf,
          price: b.price, status: 'in', loan: null, timesOut: 0, lostNote: null, addedOn: today, ...createStamps(),
        });
      });
      const next = start + chunk.length;
      tx.set(counter, snap.exists() ? { ...snap.data(), next, ...updateStamps() } : { orgId, next, ...createStamps() });
      return out;
    });
    given.push(...nos);
  }
  return given;
}

export const updateBook = (orgId: string, id: string, changes: Partial<Pick<LibraryBook, 'title' | 'author' | 'category' | 'isbn' | 'shelf' | 'price'>>) =>
  updateRecord(bookRef(orgId, id), changes);

export const removeBook = (orgId: string, id: string) => softDelete(bookRef(orgId, id));

export interface Borrower { who: string; name: string; kind: BorrowerKind; phone: string | null }

/** Lends a copy: written on the book and in the loans, in one go, so it works offline too. */
export function lendBook(orgId: string, book: LibraryBook, b: Borrower, today: string, s: LibrarySettings, byName: string) {
  const loanRef = doc(col(orgId, 'libraryLoans'));
  const loan: BookLoan = { loanId: loanRef.id, who: b.who, whoName: b.name, kind: b.kind, phone: b.phone, outOn: today, dueOn: addDays(today, s.loanDays), renewals: 0 };
  const batch = writeBatch(db);
  batch.update(bookRef(orgId, book.id), { status: 'out', loan, timesOut: increment(1), ...updateStamps() });
  batch.set(loanRef, {
    orgId, bookId: book.id, bookNo: book.no, title: book.title, category: book.category, who: b.who, whoName: b.name, kind: b.kind, phone: b.phone,
    outOn: today, dueOn: loan.dueOn, returnedOn: null, state: 'out', cost: null, byName: byName.slice(0, 120), ...createStamps(),
  });
  return { dueOn: loan.dueOn, synced: trackWrite(batch.commit()) };
}

function closeLoan(orgId: string, book: LibraryBook, bookChanges: DocumentData, loanChanges: DocumentData) {
  const batch = writeBatch(db);
  batch.update(bookRef(orgId, book.id), { ...bookChanges, ...updateStamps() });
  if (book.loan?.loanId) batch.update(doc(db, 'organizations', orgId, 'libraryLoans', book.loan.loanId), { ...loanChanges, ...updateStamps() });
  return trackWrite(batch.commit());
}

export const returnBook = (orgId: string, book: LibraryBook, today: string) =>
  closeLoan(orgId, book, { status: 'in', loan: null }, { state: 'returned', returnedOn: today });

export function renewBook(orgId: string, book: LibraryBook, today: string, s: LibrarySettings) {
  if (!book.loan) return Promise.resolve();
  const dueOn = addDays(today, s.loanDays);
  const batch = writeBatch(db);
  batch.update(bookRef(orgId, book.id), { loan: { ...book.loan, dueOn, renewals: book.loan.renewals + 1 }, ...updateStamps() });
  batch.update(doc(db, 'organizations', orgId, 'libraryLoans', book.loan.loanId), { dueOn, ...updateStamps() });
  return trackWrite(batch.commit());
}

/** Marks a copy lost or damaged (9A): who had it and the cost to replace it are kept on the record. */
export function markLost(orgId: string, book: LibraryBook, status: 'lost' | 'damaged', note: string, cost: number | null, today: string) {
  const who = book.loan?.whoName;
  const lostNote = [who, note.trim()].filter(Boolean).join(' · ').slice(0, 300) || null;
  return closeLoan(orgId, book, { status, loan: null, lostNote, ...(cost != null ? { price: cost } : {}) }, { state: status, returnedOn: today, cost });
}

/** Found again, or mended: back on the shelf. */
export const backOnShelf = (orgId: string, id: string) => updateRecord(bookRef(orgId, id), { status: 'in', loan: null, lostNote: null });

export function addMember(orgId: string, name: string, phone: string | null, kind: 'staff' | 'church') {
  const ref = doc(col(orgId, 'libraryMembers'));
  void trackWrite(setDoc(ref, { orgId, name: name.trim().slice(0, 120), phone, kind, ...createStamps() }));
  return ref.id;
}
export const removeMember = (orgId: string, id: string) => softDelete(doc(db, 'organizations', orgId, 'libraryMembers', id));

export function saveLibrarySettings(orgId: string, s: LibrarySettings, exists: boolean) {
  const ref = doc(db, 'organizations', orgId, 'libraryMeta', 'settings');
  const data = { orgId, categories: s.categories, loanDays: s.loanDays, renewals: s.renewals, limits: s.limits };
  return exists ? updateRecord(ref, data) : trackWrite(setDoc(ref, { ...data, ...createStamps() }));
}

export function startShelfCheck(orgId: string, name: string, today: string, byName: string) {
  const ref = doc(col(orgId, 'libraryChecks'));
  void trackWrite(setDoc(ref, { orgId, name, startedOn: today, seen: [], closedOn: null, byName: byName.slice(0, 120), ...createStamps() }));
  return ref.id;
}
export const shelfSeen = (orgId: string, checkId: string, bookId: string) =>
  updateRecord(doc(db, 'organizations', orgId, 'libraryChecks', checkId), { seen: arrayUnion(bookId) });
export const closeShelfCheck = (orgId: string, checkId: string, today: string) =>
  updateRecord(doc(db, 'organizations', orgId, 'libraryChecks', checkId), { closedOn: today });
