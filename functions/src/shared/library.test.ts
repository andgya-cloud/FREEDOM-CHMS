import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_SETTINGS as S, LIBRARY_CATEGORIES, bookNo, booksFromRows, canRenew, cannotLend, libraryReport, matchCategory, readBookNo,
  reminderMessage, shelfMissing, termName, type LibraryBook, type LibraryLoanRecord,
} from './library';

const cats = [...LIBRARY_CATEGORIES];
const book = (n: number, over: Partial<LibraryBook> = {}): LibraryBook => ({
  id: bookNo(n), no: bookNo(n), n, title: `Book ${n}`, author: 'A', category: 'Christian Living', isbn: '', shelf: '', price: null,
  status: 'in', loan: null, timesOut: 0, lostNote: null, addedOn: '2026-11-01', ...over,
});

describe('book numbers', () => {
  it('reads stickers and typed numbers', () => {
    expect(bookNo(7)).toBe('LIB-0007');
    expect(readBookNo('LIB-0012')).toBe('LIB-0012');
    expect(readBookNo('lib 12')).toBe('LIB-0012');
    expect(readBookNo('12')).toBe('LIB-0012');
    expect(readBookNo('HC-0012')).toBeNull();
  });
});

describe('lending rules', () => {
  it('keeps reference books in and limits each borrower', () => {
    expect(cannotLend(book(1, { category: 'Reference' }), 'staff', 0, 0, S)).toMatch(/stay in/);
    expect(cannotLend(book(1), 'student', 2, 0, S)).toMatch(/2 books/);
    expect(cannotLend(book(1), 'staff', 4, 0, S)).toBeNull();
    expect(cannotLend(book(1), 'staff', 5, 0, S)).toMatch(/5 books/);
    expect(cannotLend(book(1), 'church', 0, 1, S)).toMatch(/late book/);
    expect(cannotLend(book(1, { status: 'lost' }), 'church', 0, 0, S)).toMatch(/lost/);
  });
  it('renews once, and not when late', () => {
    expect(canRenew({ renewals: 0, dueOn: '2026-11-20' }, '2026-11-18', S)).toBe(true);
    expect(canRenew({ renewals: 1, dueOn: '2026-11-20' }, '2026-11-18', S)).toBe(false);
    expect(canRenew({ renewals: 0, dueOn: '2026-11-10' }, '2026-11-18', S)).toBe(false);
  });
  it('writes a polite reminder', () => {
    expect(reminderMessage('Grace Wanjiru', 'Spiritual Leadership', '2026-11-10', '2026-11-18')).toBe(
      'Hello Grace, this is the ADIA library. The book "Spiritual Leadership" was due back on 10 Nov 2026 (8 days ago). Please bring it back to the library soon. Thank you!');
  });
});

describe('reading a book list', () => {
  it('reads an Excel sheet with headings', () => {
    const r = booksFromRows([
      ['ADIA library books'],
      ['No.', 'Title', 'Author', 'Subject', 'Copies', 'Price (KES)'],
      [1, 'Spiritual Leadership', 'J. Oswald Sanders', 'Leadership', 3, '1,200'],
      [2, 'Professional Cookery', 'Ceserani', 'Catering', '', ''],
      ['', '', '', '', '', ''],
      ['Total', '', '', '', '', ''],
    ], cats, 'Other')!;
    expect(r.headed).toBe(true);
    expect(r.books).toEqual([
      { title: 'Spiritual Leadership', author: 'J. Oswald Sanders', category: 'Leadership & Ministry', isbn: '', shelf: '', price: 1200, copies: 3 },
      { title: 'Professional Cookery', author: 'Ceserani', category: 'Food Production & Hospitality', isbn: '', shelf: '', price: null, copies: 1 },
    ]);
  });
  it('reads a PDF list without headings', () => {
    const r = booksFromRows([['1.', 'The Purpose Driven Life', 'Rick Warren'], ['2. Things Fall Apart by Chinua Achebe'], []], cats, 'Other')!;
    expect(r.headed).toBe(false);
    expect(r.books.map((b) => [b.title, b.author])).toEqual([['The Purpose Driven Life', 'Rick Warren'], ['Things Fall Apart', 'Chinua Achebe']]);
  });
  it('matches categories by meaning', () => {
    expect(matchCategory('Dictionary', cats)).toBe('Reference');
    expect(matchCategory('hair and beauty', cats)).toBe('Cosmetology & Beauty');
    expect(matchCategory('', cats)).toBe('');
  });
});

describe('report and shelf check', () => {
  const books = [
    book(1, { status: 'out', loan: { loanId: 'x', who: 'student:1', whoName: 'Grace', kind: 'student', phone: null, outOn: '2026-10-20', dueOn: '2026-11-03', renewals: 0 } }),
    book(2), book(3, { status: 'lost', lostNote: 'Brian', price: 1800, category: 'Reference' }),
  ];
  const loans: LibraryLoanRecord[] = [
    { id: 'x', bookId: 'LIB-0001', bookNo: 'LIB-0001', title: 'Book 1', category: 'Christian Living', who: 'student:1', whoName: 'Grace', kind: 'student', phone: null, outOn: '2026-11-02', dueOn: '2026-11-16', returnedOn: null, state: 'out', cost: null, byName: 'E' },
  ];
  it('counts the month', () => {
    const r = libraryReport(books, loans, '2026-11', '2026-11-18', cats);
    expect(r.books).toBe(3);
    expect(r.out).toBe(1);
    expect(r.overdue[0]).toMatchObject({ no: 'LIB-0001', days: 15 });
    expect(r.lost).toHaveLength(1);
    expect(r.lentThisMonth).toBe(1);
    expect(r.byCategory.find((c) => c.category === 'Christian Living')).toEqual({ category: 'Christian Living', copies: 2, out: 1 });
  });
  it('lists what was not found on the shelf', () => {
    expect(shelfMissing(books, []).map((b) => b.no)).toEqual(['LIB-0002']);
    expect(shelfMissing(books, ['LIB-0002'])).toEqual([]);
    expect(termName('2026-11-18')).toBe('Term 3 2026');
  });
});
