/**
 * The ADIA library (Andy, 2026-11-18, 1A-12A): every copy of a book has its own number (LIB-0001) on a QR sticker,
 * students, staff and church members borrow for 14 days (one renewal), students and church members 2 books at a
 * time and staff 5. Late books get a WhatsApp reminder that the librarian sends. Lost or damaged copies keep their
 * record. Plain functions, shared by the app and the tests.
 */

export const LIBRARY_CATEGORIES = [
  'Bible & Theology', 'Leadership & Ministry', 'Christian Living', 'ICT & Computers', 'Food Production & Hospitality',
  'Fashion & Design', 'Cosmetology & Beauty', 'Business & Entrepreneurship', 'Life Skills & Counselling',
  'English & Communication', 'Maths & Science', 'Stories & Novels', 'Reference',
  // The main classes the big libraries of the world shelve by (Dewey Decimal), in plain words (Andy, 2026-11-18).
  'Philosophy & Psychology', 'Religions of the World', 'Social Sciences & Education', 'Law & Government', 'Health & Medicine',
  'Agriculture & Environment', 'Engineering & Technology', 'Arts, Music & Sport', 'History & Geography', 'Biographies',
  "Children's Books", 'Other',
] as const;

/** A new category the librarian types (Andy, 2026-11-18): tidy, at most 60 letters, not already in the list. */
export function newCategory(name: string, list: readonly string[]): { name: string } | { error: string } {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (n.length < 2) return { error: 'Type the name of the new category.' };
  const same = list.find((c) => c.toLowerCase() === n.toLowerCase());
  if (same) return { error: `${same} is already a category.` };
  if (list.length >= 60) return { error: 'The list is full (60 categories). Remove one in Library settings first.' };
  return { name: n };
}

// ---- Finding a book in the world's library catalogues (Andy, 2026-11-18) -------------------------------------

/** A book found in Open Library (the Internet Archive's catalogue of the world's libraries) or Google Books. */
export interface FoundBook { title: string; author: string; isbn: string; year: string; subjects: string[]; source: 'Open Library' | 'Google Books' }

const firstIsbn = (list: readonly string[] | undefined) => (list ?? []).find((x) => /^97[89]\d{10}$/.test(x)) ?? (list ?? []).find((x) => /^\d{9}[\dX]$/.test(x)) ?? '';

export function parseOpenLibrary(json: unknown): FoundBook[] {
  const docs = (json as { docs?: unknown[] })?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.map((d) => d as { title?: string; subtitle?: string; author_name?: string[]; isbn?: string[]; first_publish_year?: number; subject?: string[] })
    .filter((d) => typeof d.title === 'string' && d.title.trim())
    .map((d) => ({
      title: [d.title!.trim(), d.subtitle?.trim()].filter(Boolean).join(': ').slice(0, 200),
      author: (d.author_name ?? []).slice(0, 3).join(', ').slice(0, 120), isbn: firstIsbn(d.isbn),
      year: d.first_publish_year ? String(d.first_publish_year) : '', subjects: (d.subject ?? []).slice(0, 12), source: 'Open Library' as const,
    }));
}

export function parseGoogleBooks(json: unknown): FoundBook[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items.map((i) => (i as { volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; categories?: string[]; publishedDate?: string; industryIdentifiers?: { identifier?: string }[] } }).volumeInfo ?? {})
    .filter((v) => typeof v.title === 'string' && v.title.trim())
    .map((v) => ({
      title: [v.title!.trim(), v.subtitle?.trim()].filter(Boolean).join(': ').slice(0, 200),
      author: (v.authors ?? []).slice(0, 3).join(', ').slice(0, 120),
      isbn: firstIsbn((v.industryIdentifiers ?? []).map((x) => String(x.identifier ?? ''))),
      year: (v.publishedDate ?? '').slice(0, 4), subjects: (v.categories ?? []).slice(0, 12), source: 'Google Books' as const,
    }));
}

/** The best of the categories for a book found in a catalogue, from its subjects and title. */
export function categoryForFound(b: Pick<FoundBook, 'subjects' | 'title'>, categories: readonly string[]): string {
  for (const s of b.subjects) { const c = matchCategory(s, categories); if (c) return c; }
  return matchCategory(b.title, categories);
}

/** Reference books stay in the library (5A). */
export const REFERENCE = 'Reference';

export type BorrowerKind = 'student' | 'staff' | 'church';
export const BORROWER_LABELS: Record<BorrowerKind, string> = { student: 'Student', staff: 'Staff', church: 'Church member' };

export type BookStatus = 'in' | 'out' | 'lost' | 'damaged';
export const STATUS_LABELS: Record<BookStatus, string> = { in: 'On the shelf', out: 'On loan', lost: 'Lost', damaged: 'Damaged' };

export interface LibrarySettings {
  categories: string[];
  loanDays: number;
  renewals: number;
  limits: Record<BorrowerKind, number>;
}
export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  categories: [...LIBRARY_CATEGORIES], loanDays: 14, renewals: 1, limits: { student: 2, staff: 5, church: 2 },
};
export function librarySettings(raw: Partial<LibrarySettings> | null | undefined): LibrarySettings {
  const d = DEFAULT_LIBRARY_SETTINGS;
  const cats = (raw?.categories ?? []).map((c) => String(c).trim()).filter(Boolean);
  const num = (v: unknown, def: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : def);
  return {
    categories: cats.length ? [...new Set(cats)] : [...d.categories],
    loanDays: num(raw?.loanDays, d.loanDays, 120) || d.loanDays,
    renewals: num(raw?.renewals, d.renewals, 5),
    limits: {
      student: num(raw?.limits?.student, d.limits.student, 20) || d.limits.student,
      staff: num(raw?.limits?.staff, d.limits.staff, 20) || d.limits.staff,
      church: num(raw?.limits?.church, d.limits.church, 20) || d.limits.church,
    },
  };
}

/** Who has a copy now: kept on the book itself, so the shelf shows at once who has it. */
export interface BookLoan {
  loanId: string;
  who: string;
  whoName: string;
  kind: BorrowerKind;
  phone: string | null;
  outOn: string;
  dueOn: string;
  renewals: number;
}

export interface LibraryBook {
  id: string;
  no: string;
  n: number;
  title: string;
  author: string;
  category: string;
  isbn: string;
  shelf: string;
  /** Replacement cost in KES, whole shillings, for lost or damaged copies. */
  price: number | null;
  status: BookStatus;
  loan: BookLoan | null;
  timesOut: number;
  /** Lost or damaged: who and what it costs to replace (9A). */
  lostNote: string | null;
  addedOn: string;
  deletedAt?: unknown;
}

export interface LibraryLoanRecord {
  id: string;
  bookId: string;
  bookNo: string;
  title: string;
  category: string;
  who: string;
  whoName: string;
  kind: BorrowerKind;
  phone: string | null;
  outOn: string;
  dueOn: string;
  returnedOn: string | null;
  state: 'out' | 'returned' | 'lost' | 'damaged';
  cost: number | null;
  byName: string;
  deletedAt?: unknown;
}

export interface LibraryMember { id: string; name: string; phone: string | null; kind: Exclude<BorrowerKind, 'student'>; deletedAt?: unknown }

export interface ShelfCheck { id: string; name: string; startedOn: string; seen: string[]; closedOn: string | null; byName: string; deletedAt?: unknown }

export const bookNo = (n: number) => `LIB-${String(n).padStart(4, '0')}`;

/** What a sticker or a typed number says, as a book number: "lib-12", "12", "LIB 0012" are all LIB-0012. */
export function readBookNo(raw: string): string | null {
  const m = /^\s*(?:lib[\s-]*)?0*(\d{1,6})\s*$/i.exec(raw);
  return m ? bookNo(Number(m[1])) : null;
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

export const isOverdue = (loan: Pick<BookLoan, 'dueOn'>, today: string) => loan.dueOn < today;
export const daysLate = (loan: Pick<BookLoan, 'dueOn'>, today: string) => Math.max(0, daysBetween(loan.dueOn, today));

/** Why this person cannot take this book now, or null when they can (6A 7A, and Reference stays in). */
export function cannotLend(book: Pick<LibraryBook, 'status' | 'category'>, kind: BorrowerKind, holding: number, overdue: number, s: LibrarySettings): string | null {
  if (book.category === REFERENCE) return 'Reference books stay in the library.';
  if (book.status === 'out') return 'This copy is already out on loan. Return it first.';
  if (book.status !== 'in') return `This copy is marked ${STATUS_LABELS[book.status].toLowerCase()}.`;
  if (overdue > 0) return `They have ${overdue === 1 ? 'a late book' : `${overdue} late books`}. Ask them to return it first.`;
  const max = s.limits[kind];
  if (holding >= max) return `${BORROWER_LABELS[kind]}s may have ${max} ${max === 1 ? 'book' : 'books'} at a time. They already have ${holding}.`;
  return null;
}

export function canRenew(loan: Pick<BookLoan, 'renewals' | 'dueOn'>, today: string, s: LibrarySettings): boolean {
  return loan.renewals < s.renewals && !isOverdue(loan, today);
}

/** The polite reminder for a late book (8A), sent by the librarian on WhatsApp. */
export function reminderMessage(name: string, title: string, dueOn: string, today: string): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const late = daysLate({ dueOn }, today);
  return `Hello ${first}, this is the ADIA library. The book "${title}" was due back on ${prettyDay(dueOn)}${late ? ` (${late} ${late === 1 ? 'day' : 'days'} ago)` : ''}. Please bring it back to the library soon. Thank you!`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function prettyDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : key;
}
export const monthName = (month: string) => { const [y, m] = month.split('-').map(Number); return `${MONTHS_LONG[(m ?? 1) - 1]} ${y}`; };

// ---- Reading a book list (Excel or PDF, 4A + Andy 2026-11-18) ----------------------------------------------

export interface ImportedBook { title: string; author: string; category: string; isbn: string; shelf: string; price: number | null; copies: number }

const HEAD: [keyof ImportedBook, RegExp][] = [
  ['title', /^(book ?)?(title|name)( of (the )?book)?$|^book$|^books?$/],
  ['author', /^(author|writer|by|authors?\/editors?|author\(s\))$/],
  ['category', /^(category|subject|section|class|genre|type|department)$/],
  ['isbn', /^isbn( ?no\.?| number)?$/],
  ['shelf', /^(shelf|location|rack|place)$/],
  ['price', /^(price|cost|value|replacement( cost)?)( ?\(?(kes|ksh)\)?)?$/],
  ['copies', /^(copies|qty|quantity|no\.? of copies|number of copies|count)$/],
];

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const headWord = (v: unknown) => clean(v).toLowerCase().replace(/[:.]$/, '').replace(/\s*\*$/, '');

/** The closest of the categories for what a list calls a book's subject, or '' when nothing fits. */
export function matchCategory(text: string, categories: readonly string[]): string {
  const t = text.toLowerCase().trim();
  if (!t) return '';
  const exact = categories.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  const words: [RegExp, string][] = [
    [/reference|dictionar|encyclop|atlas|concordance|handbook/, 'Reference'],
    [/bible|theolog|scripture|doctrine|apolog|church history|hermeneut/, 'Bible & Theology'],
    [/leader|ministry|pastor|mission|evangel|preach/, 'Leadership & Ministry'],
    [/christian|devotion|prayer|faith|spiritual|marriage|family/, 'Christian Living'],
    [/\bict\b|computer|software|program|internet|digital|technology|typing/, 'ICT & Computers'],
    [/food|cook|catering|hospitality|bak|pastry|nutrition|hotel/, 'Food Production & Hospitality'],
    [/fashion|design|tailor|sewing|garment|textile|dressmak/, 'Fashion & Design'],
    [/cosmet|beauty|hair|salon|make-?up|nail|barber/, 'Cosmetology & Beauty'],
    [/business|entrepren|account|finance|market|management|econom|money/, 'Business & Entrepreneurship'],
    [/life skill|counsel|psycholog|self|health|guidance/, 'Life Skills & Counselling'],
    [/english|grammar|communication|language|writing|kiswahili|literature/, 'English & Communication'],
    [/math|science|biology|chemistry|physics|geography/, 'Maths & Science'],
    [/children|juvenile|picture book|nursery/, "Children's Books"],
    [/biograph|memoir|autobiograph/, 'Biographies'],
    [/novel|stor|fiction|poem|poetry|play|comic/, 'Stories & Novels'],
    [/philosoph|ethic|logic/, 'Philosophy & Psychology'],
    [/islam|hindu|buddh|religion|judaism/, 'Religions of the World'],
    [/law|legal|government|politic|constitution/, 'Law & Government'],
    [/medic|nurs|disease|anatomy|first aid/, 'Health & Medicine'],
    [/agricult|farm|crop|livestock|environment|ecolog/, 'Agriculture & Environment'],
    [/engineer|electric|mechanic|plumb|construct|carpent|weld/, 'Engineering & Technology'],
    [/\bart\b|arts|music|sport|paint|drawing|photograph|dance|film/, 'Arts, Music & Sport'],
    [/history|histor|geograph|travel|africa/, 'History & Geography'],
    [/sociolog|education|teach|social science|anthropolog/, 'Social Sciences & Education'],
  ];
  for (const [re, cat] of words) if (re.test(t) && categories.includes(cat)) return cat;
  const part = categories.find((c) => c.toLowerCase().split(/[\s&]+/).some((w) => w.length > 3 && t.includes(w)));
  return part ?? '';
}

const numberOf = (v: unknown) => { const n = Number(clean(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : NaN; };

/**
 * A list of books from the rows of an Excel sheet or a PDF: finds the heading row (Title, Author, Category,
 * Copies…) and reads the books under it. A list without headings is read as "title, author" on each line,
 * with numbering like "1." left out. Returns null when no book could be found.
 */
export function booksFromRows(rows: readonly (readonly unknown[])[], categories: readonly string[], fallbackCategory: string): { books: ImportedBook[]; skipped: number; headed: boolean } | null {
  const make = (get: (f: keyof ImportedBook) => string): ImportedBook | null => {
    const title = get('title').replace(/^\d+[.)]\s+/, '').slice(0, 200);
    if (!title || /^(total|page \d+)/i.test(title)) return null;
    const price = numberOf(get('price'));
    const copies = numberOf(get('copies'));
    return {
      title, author: get('author').slice(0, 120), category: matchCategory(get('category'), categories) || fallbackCategory,
      isbn: get('isbn').replace(/[^0-9Xx-]/g, '').slice(0, 20), shelf: get('shelf').slice(0, 40),
      price: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
      copies: Number.isFinite(copies) && copies >= 1 ? Math.min(50, Math.round(copies)) : 1,
    };
  };
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cols: Partial<Record<keyof ImportedBook, number>> = {};
    rows[r]!.forEach((cell, i) => {
      const t = headWord(cell);
      for (const [f, re] of HEAD) if (cols[f] == null && re.test(t)) { cols[f] = i; break; }
    });
    if (cols.title == null) continue;
    const books: ImportedBook[] = [];
    let skipped = 0;
    for (const row of rows.slice(r + 1)) {
      if (row.map(headWord).some((t, i) => i === cols.title && HEAD[0]![1].test(t))) continue; // the heading again on the next page
      const b = make((f) => (cols[f] == null ? '' : clean(row[cols[f]!])));
      if (b) books.push(b); else if (row.some((c) => clean(c))) skipped++;
    }
    return books.length ? { books, skipped, headed: true } : null;
  }
  // No heading row: each line is a book, its first words the title and the next cell the author.
  const books: ImportedBook[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cells = row.map(clean).filter((c) => c && !/^\d+[.)]?$/.test(c));
    if (!cells.length) continue;
    let [title = '', author = ''] = cells;
    // "Title by Author" or "Title - Author" in one cell.
    const split = /^(.{3,}?)\s+(?:by|–|-)\s+(.{3,})$/i.exec(title);
    if (!author && split) { title = split[1]!; author = split[2]!; }
    const b = make((f) => (f === 'title' ? title : f === 'author' ? author : ''));
    if (b && title.length >= 2) books.push(b); else skipped++;
  }
  return books.length ? { books, skipped, headed: false } : null;
}

/** The columns of the Excel template the librarian fills in. */
export const BOOK_TEMPLATE_HEAD = ['Title', 'Author', 'Category', 'Copies', 'ISBN', 'Shelf', 'Price (KES)'] as const;

// ---- Reports (10A) and the shelf check (11A) -----------------------------------------------------------------

export interface LibraryReport {
  month: string;
  books: number;
  titles: number;
  onShelf: number;
  out: number;
  overdue: { no: string; title: string; whoName: string; kind: BorrowerKind; dueOn: string; days: number }[];
  lost: { no: string; title: string; status: BookStatus; note: string; price: number | null }[];
  byCategory: { category: string; copies: number; out: number }[];
  lentThisMonth: number;
  returnedThisMonth: number;
  borrowersThisMonth: number;
  mostBorrowed: { title: string; times: number }[];
  byKind: Record<BorrowerKind, number>;
}

export function libraryReport(books: readonly LibraryBook[], loans: readonly LibraryLoanRecord[], month: string, today: string, categories: readonly string[]): LibraryReport {
  const live = books.filter((b) => !b.deletedAt);
  const inMonth = (d: string | null) => !!d && d.slice(0, 7) === month;
  const lent = loans.filter((l) => !l.deletedAt && inMonth(l.outOn));
  const times = new Map<string, number>();
  for (const l of lent) times.set(l.title, (times.get(l.title) ?? 0) + 1);
  const cats = [...categories, ...new Set(live.map((b) => b.category).filter((c) => !categories.includes(c)))];
  const byKind: Record<BorrowerKind, number> = { student: 0, staff: 0, church: 0 };
  for (const l of lent) byKind[l.kind]++;
  return {
    month,
    books: live.length,
    titles: new Set(live.map((b) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`)).size,
    onShelf: live.filter((b) => b.status === 'in').length,
    out: live.filter((b) => b.status === 'out').length,
    overdue: live.filter((b) => b.status === 'out' && b.loan && isOverdue(b.loan, today))
      .map((b) => ({ no: b.no, title: b.title, whoName: b.loan!.whoName, kind: b.loan!.kind, dueOn: b.loan!.dueOn, days: daysLate(b.loan!, today) }))
      .sort((a, b) => b.days - a.days),
    lost: live.filter((b) => b.status === 'lost' || b.status === 'damaged').map((b) => ({ no: b.no, title: b.title, status: b.status, note: b.lostNote ?? '', price: b.price })),
    byCategory: cats.map((category) => ({ category, copies: live.filter((b) => b.category === category).length, out: live.filter((b) => b.category === category && b.status === 'out').length }))
      .filter((c) => c.copies > 0),
    lentThisMonth: lent.length,
    returnedThisMonth: loans.filter((l) => !l.deletedAt && inMonth(l.returnedOn)).length,
    borrowersThisMonth: new Set(lent.map((l) => l.who)).size,
    mostBorrowed: [...times.entries()].map(([title, n]) => ({ title, times: n })).sort((a, b) => b.times - a.times || a.title.localeCompare(b.title)).slice(0, 10),
    byKind,
  };
}

/** The shelf check: copies that should be on the shelf but were not scanned. Copies out on loan are not missing. */
export function shelfMissing(books: readonly LibraryBook[], seen: readonly string[]): LibraryBook[] {
  const s = new Set(seen);
  return books.filter((b) => !b.deletedAt && b.status === 'in' && !s.has(b.id)).sort((a, b) => a.n - b.n);
}

/** "Term 3 2026" for a date: Jan-Apr term 1, May-Aug term 2, Sep-Dec term 3. */
export function termName(today: string): string {
  const m = Number(today.slice(5, 7));
  return `Term ${m <= 4 ? 1 : m <= 8 ? 2 : 3} ${today.slice(0, 4)}`;
}
