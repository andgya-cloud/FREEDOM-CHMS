import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { usePeople } from '../../state/PeopleContext';
import { useSchool } from '../../state/useSchool';
import { useLibrary, useLibraryAccess, type LibraryData } from '../../state/useLibrary';
import { useQrCamera } from '../hope/DoorScan';
import { PoweredBy } from '../../components/PoweredBy';
import { friendlyError } from '../../lib/errors';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import {
  addBooks, addMember, backOnShelf, closeShelfCheck, lendBook, markLost, removeBook, removeMember, renewBook, returnBook,
  saveLibrarySettings, shelfSeen, startShelfCheck, updateBook, type Borrower,
} from '../../lib/libraryWrites';
import { bookListWorkbook, bookTemplate, readBookList, reportPdf, reportWorkbook, stickersPdf } from '../../lib/libraryFiles';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { formatPhone, normalizePhone } from '../../../functions/src/shared/phone';
import {
  BORROWER_LABELS, REFERENCE, addDays, STATUS_LABELS, canRenew, cannotLend, daysLate, isOverdue, libraryReport, monthName, prettyDay, readBookNo,
  reminderMessage, shelfMissing, termName, type BorrowerKind, type ImportedBook, type LibraryBook, type LibrarySettings,
} from '../../../functions/src/shared/library';

type Tab = 'lend' | 'books' | 'reports';
const TABS: [Tab, string][] = [['lend', 'Lend & return'], ['books', 'Books'], ['reports', 'Reports']];
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The ADIA library (Andy, 2026-11-18, 1A-12A): who has which book, and what is on the shelves. */
export function LibraryPage() {
  const { current } = useOrg();
  const { manager } = useLibraryAccess();
  if (!current || current.type !== 'college') return <div className="page narrow"><h1>Library</h1><p className="muted">The library is kept at ADIA Training Centre. Switch to ADIA first.</p></div>;
  if (!manager) return <div className="page narrow"><h1>Library</h1><p className="muted">Your account does not run the library. Ask Mr Andrew.</p></div>;
  return <Library org={current} />;
}

interface Person extends Borrower { detail: string }

function Library({ org }: { org: Organization }) {
  const lib = useLibrary(org.id);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'lend') as Tab;
  const today = localDateKey(new Date(), org.timeZone);
  const out = lib.books.filter((b) => b.status === 'out');
  const late = out.filter((b) => b.loan && isOverdue(b.loan, today));

  return (
    <div className="page lib-page">
      <div className="page-head"><h1>Library</h1></div>
      <div className="lib-stats">
        <div className="lib-stat"><b>{lib.books.length}</b><span>Books</span></div>
        <div className="lib-stat"><b>{lib.books.filter((b) => b.status === 'in').length}</b><span>On the shelf</span></div>
        <div className="lib-stat"><b>{out.length}</b><span>Out on loan</span></div>
        <div className={`lib-stat${late.length ? ' lib-late' : ''}`}><b>{late.length}</b><span>Overdue</span></div>
      </div>
      <div className="segmented lib-tabs" role="tablist" aria-label="Library">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setParams(t === 'lend' ? {} : { tab: t }, { replace: true })}>{label}</button>
        ))}
      </div>
      {lib.loading && !lib.books.length ? <p className="muted">Loading…</p>
        : tab === 'lend' ? <LendTab org={org} lib={lib} today={today} />
        : tab === 'books' ? <BooksTab org={org} lib={lib} today={today} />
        : <ReportsTab org={org} lib={lib} today={today} />}
      <PoweredBy />
    </div>
  );
}

/** Students (from the student records), staff and church members (library members). */
function useBorrowers(orgId: string, lib: LibraryData): Person[] {
  const school = useSchool(orgId);
  const { byId } = usePeople();
  return useMemo(() => {
    const course = (id: string) => school.courses.find((c) => c.id === id)?.name ?? '';
    const intake = (id: string) => school.intakes.find((i) => i.id === id)?.name ?? '';
    const students: Person[] = school.students.filter((s) => s.status === 'enrolled').map((s) => {
      const p = byId(s.id);
      return { who: `student:${s.id}`, name: p?.fullName ?? 'Student', kind: 'student' as const, phone: p?.phone ?? null, detail: [intake(s.intakeId), course(s.courseId)].filter(Boolean).join(' · ') };
    }).filter((p) => p.name !== 'Student');
    const members: Person[] = lib.members.map((m) => ({ who: `member:${m.id}`, name: m.name, kind: m.kind, phone: m.phone, detail: BORROWER_LABELS[m.kind] }));
    return [...students, ...members].sort((a, b) => a.name.localeCompare(b.name));
  }, [school.students, school.courses, school.intakes, byId, lib.members]);
}

function waLink(phone: string | null, text: string) {
  const p = normalizePhone(phone ?? '');
  return p ? `https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null;
}

// ---- Lend & return ---------------------------------------------------------------------------------------

function LendTab({ org, lib, today }: { org: Organization; lib: LibraryData; today: string }) {
  const toast = useToast();
  const { profile } = useAuth();
  const people = useBorrowers(org.id, lib);
  const [bookQ, setBookQ] = useState('');
  const [bookId, setBookId] = useState('');
  const [whoQ, setWhoQ] = useState('');
  const [who, setWho] = useState('');
  const [scan, setScan] = useState(false);
  const [lostId, setLostId] = useState('');
  const shelf = lib.books.filter((b) => b.status === 'in' && b.category !== REFERENCE);
  const bookMatches = useMemo(() => {
    const q = plain(bookQ.trim());
    const no = readBookNo(bookQ);
    return shelf.filter((b) => !q || b.no === no || plain(`${b.title} ${b.author} ${b.no}`).includes(q)).slice(0, 60);
  }, [shelf, bookQ]);
  const whoMatches = useMemo(() => {
    const q = plain(whoQ.trim());
    return people.filter((p) => !q || plain(`${p.name} ${p.detail}`).includes(q)).slice(0, 60);
  }, [people, whoQ]);
  const book = lib.books.find((b) => b.id === bookId) ?? null;
  const person = people.find((p) => p.who === who) ?? null;
  const holding = (w: string) => lib.books.filter((b) => b.status === 'out' && b.loan?.who === w);
  const problem = book && person ? cannotLend(book, person.kind, holding(person.who).length, holding(person.who).filter((b) => isOverdue(b.loan!, today)).length, lib.settings) : null;
  const out = lib.books.filter((b) => b.status === 'out' && b.loan).sort((a, b) => a.loan!.dueOn.localeCompare(b.loan!.dueOn));
  const fail = (err: unknown) => toast.show(friendlyError(err));

  function lend() {
    if (!book || !person || problem) return;
    const { dueOn, synced } = lendBook(org.id, book, person, today, lib.settings, profile?.displayName ?? '');
    synced.catch(fail);
    toast.show(`${book.title} lent to ${person.name.split(' ')[0]}. Due back ${prettyDay(dueOn)}.`);
    setBookId(''); setBookQ(''); setWho(''); setWhoQ('');
  }
  function back(b: LibraryBook) {
    returnBook(org.id, b, today).catch(fail);
    toast.show(`${b.title} is back on the shelf.${b.loan && isOverdue(b.loan, today) ? ` It was ${daysLate(b.loan, today)} days late.` : ''}`);
  }
  /** A scanned sticker: a book on loan is returned at once; a book on the shelf is picked for lending. */
  function scanned(no: string): string {
    const b = lib.books.find((x) => x.no === no);
    if (!b) return `✗ ${no} is not in the library list.`;
    if (b.status === 'out') { back(b); return `✓ ${b.no} ${b.title}: returned.`; }
    if (b.status !== 'in') return `✗ ${b.no} is marked ${STATUS_LABELS[b.status].toLowerCase()}.`;
    if (b.category === REFERENCE) return `✗ ${b.no} is a reference book. It stays in the library.`;
    setBookId(b.id); setBookQ(''); setScan(false);
    return `✓ ${b.no} ${b.title}: now choose who is borrowing it.`;
  }

  return (
    <>
      <section className="card stack">
        <div className="card-head"><h2>Lend a book</h2>
          <button type="button" className="btn btn-gold" onClick={() => setScan((s) => !s)}>{scan ? 'Close camera' : '📷 Scan a sticker'}</button>
        </div>
        {scan && <Scanner onCode={scanned} hint="Scan a book on the shelf to lend it, or a returned book to put it back." />}
        <div className="field-row lib-pick">
          <label className="field"><span>Book</span>
            <input value={bookQ} onChange={(e) => { setBookQ(e.target.value); setBookId(''); }} placeholder="Type the title or LIB number" />
            <select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Choose the book">
              <option value="">{bookMatches.length ? `Choose the book (${shelf.length} on the shelf)` : 'No book on the shelf matches'}</option>
              {book && !bookMatches.includes(book) && <option value={book.id}>{book.no} · {book.title}</option>}
              {bookMatches.map((b) => <option key={b.id} value={b.id}>{b.no} · {b.title}{b.author ? ` · ${b.author}` : ''}</option>)}
            </select>
          </label>
          <label className="field"><span>Borrower</span>
            <input value={whoQ} onChange={(e) => { setWhoQ(e.target.value); setWho(''); }} placeholder="Type a name" />
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Choose the borrower">
              <option value="">{whoMatches.length ? 'Choose who is borrowing' : 'Nobody matches. Add them below.'}</option>
              {(['student', 'staff', 'church'] as BorrowerKind[]).map((k) => {
                const list = whoMatches.filter((p) => p.kind === k);
                return list.length ? <optgroup key={k} label={`${BORROWER_LABELS[k]}s`}>{list.map((p) => <option key={p.who} value={p.who}>{p.name}{p.kind === 'student' && p.detail ? ` · ${p.detail}` : ''}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
        </div>
        {person && holding(person.who).length > 0 && <p className="hint">{person.name.split(' ')[0]} has: {holding(person.who).map((b) => `${b.title} (due ${prettyDay(b.loan!.dueOn)})`).join(', ')}.</p>}
        {problem && <p className="hint lib-problem">{problem}</p>}
        <div><button type="button" className="btn btn-primary" disabled={!book || !person || !!problem} onClick={lend}>Lend · due {prettyDay(addDays(today, lib.settings.loanDays))}</button></div>
        <AddMember orgId={org.id} onAdded={(id, name) => { setWho(`member:${id}`); setWhoQ(name); }} />
      </section>

      <section className="card">
        <div className="card-head"><h2>Out on loan ({out.length})</h2></div>
        {!out.length ? <p className="muted">No book is out. Lent books show here with the day they are due back.</p> : (
          <div className="table-scroll"><table className="table lib-table">
            <thead><tr><th>Book</th><th>Borrower</th><th>Due</th><th /></tr></thead>
            <tbody>{out.map((b) => {
              const l = b.loan!;
              const lateBy = isOverdue(l, today) ? daysLate(l, today) : 0;
              const wa = lateBy ? waLink(l.phone, reminderMessage(l.whoName, b.title, l.dueOn, today)) : null;
              return (
                <tr key={b.id}>
                  <td><b>{b.title}</b><div className="muted small">{b.no}</div></td>
                  <td>{l.whoName}<div className="muted small">{BORROWER_LABELS[l.kind]}</div></td>
                  <td><span className={`inv-chip ${lateBy ? 'inv-late' : 'inv-due'}`}>{lateBy ? `${lateBy} ${lateBy === 1 ? 'day' : 'days'} late` : prettyDay(l.dueOn)}</span></td>
                  <td className="lib-actions">
                    <button type="button" className="btn btn-primary btn-small" onClick={() => back(b)}>Returned</button>
                    {wa && <a className="btn btn-whatsapp btn-small" href={wa} target="_blank" rel="noopener noreferrer">Send WhatsApp</a>}
                    {lateBy > 0 && !wa && <span className="muted small">No phone number</span>}
                    {canRenew(l, today, lib.settings) && <button type="button" className="btn btn-small" onClick={() => { renewBook(org.id, b, today, lib.settings).catch(fail); toast.show(`Renewed. Now due ${prettyDay(addDays(today, lib.settings.loanDays))}.`); }}>Renew</button>}
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setLostId(lostId === b.id ? '' : b.id)}>Lost?</button>
                    {lostId === b.id && <LostForm book={b} onDone={(status, note, cost) => { markLost(org.id, b, status, note, cost, today).catch(fail); setLostId(''); toast.show(`${b.no} marked ${status}.`); }} />}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

function AddMember({ orgId, onAdded }: { orgId: string; onAdded: (id: string, name: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<'church' | 'staff'>('church');
  function add() {
    if (name.trim().length < 2) return toast.show('Type their name.');
    const p = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !p) return toast.show('Check the phone number, e.g. 0712 345 678.');
    const id = addMember(orgId, name, p, kind);
    onAdded(id, name.trim());
    toast.show(`${name.trim()} added. They can borrow now.`);
    setName(''); setPhone('');
  }
  return (
    <details className="lib-fold">
      <summary>Staff or church member not in the list? Add them</summary>
      <div className="field-row lib-three">
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Phone (for reminders)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" inputMode="tel" /></label>
        <label className="field"><span>Who</span><select value={kind} onChange={(e) => setKind(e.target.value as 'church' | 'staff')}><option value="church">Church member</option><option value="staff">Staff</option></select></label>
      </div>
      <button type="button" className="btn" onClick={add}>Add</button>
    </details>
  );
}

function LostForm({ book, onDone }: { book: LibraryBook; onDone: (status: 'lost' | 'damaged', note: string, cost: number | null) => void }) {
  const [status, setStatus] = useState<'lost' | 'damaged'>('lost');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState(book.price != null ? String(book.price) : '');
  return (
    <div className="lib-lost stack">
      <select value={status} onChange={(e) => setStatus(e.target.value as 'lost' | 'damaged')} aria-label="Lost or damaged"><option value="lost">Lost</option><option value="damaged">Damaged</option></select>
      <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" placeholder="Cost to replace (KES)" aria-label="Cost to replace" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. will pay by Friday" aria-label="Note" />
      <button type="button" className="btn btn-danger btn-small" onClick={() => { const c = Number(cost.replace(/[^0-9]/g, '')); onDone(status, note, cost.trim() && c > 0 ? c : null); }}>Mark {status}</button>
    </div>
  );
}

/** The camera reading the QR stickers, or the number typed in. */
function Scanner({ onCode, hint }: { onCode: (no: string) => string; hint: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const seen = useRef(new Map<string, number>());
  const handle = useRef(onCode);
  handle.current = onCode;
  function take(raw: string) {
    const no = readBookNo(raw);
    if (!no) { setLast({ text: `✗ "${raw.slice(0, 30)}" is not a library sticker.`, ok: false }); return; }
    const now = Date.now();
    if ((seen.current.get(no) ?? 0) > now - 4000) return;
    seen.current.set(no, now);
    const text = handle.current(no);
    setLast({ text, ok: text.startsWith('✓') });
    if (navigator.vibrate) navigator.vibrate(text.startsWith('✓') ? 80 : [40, 60, 40]);
  }
  const camera = useQrCamera(video, take);
  return (
    <div className="stack door-scan">
      <p className="hint">{hint}</p>
      {camera !== 'none' ? <div className="door-video"><video ref={video} muted playsInline aria-label="Camera" /><span className="door-frame" aria-hidden="true" /></div>
        : <p className="small muted">The camera could not start. Allow the camera, or type the number on the sticker.</p>}
      {camera === 'starting' && <p className="small muted">Starting the camera… Allow the camera if the phone asks.</p>}
      {last && <p className={`door-last ${last.ok ? 'ok' : 'bad'}`} aria-live="assertive">{last.text}</p>}
      <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { seen.current.clear(); take(typed); setTyped(''); } }}>
        <label className="field"><span>Or type the number</span><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="LIB-0042 or 42" autoCapitalize="characters" /></label>
        <button type="submit" className="btn align-end" disabled={!typed.trim()}>Go</button>
      </form>
    </div>
  );
}

// ---- Books ---------------------------------------------------------------------------------------------

function BooksTab({ org, lib, today }: { org: Organization; lib: LibraryData; today: string }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState('');
  const [show, setShow] = useState(100);
  const [panel, setPanel] = useState<'' | 'add' | 'upload' | 'stickers'>('');
  // The stickers to print default to the books just added.
  const [fresh, setFresh] = useState<string[]>([]);
  const added = (nos: string[]) => { setFresh(nos); setPanel('stickers'); };
  const cats = [...lib.settings.categories, ...new Set(lib.books.map((b) => b.category).filter((c) => !lib.settings.categories.includes(c)))];
  const list = useMemo(() => {
    const t = plain(q.trim());
    const no = readBookNo(q);
    return lib.books.filter((b) => (!cat || b.category === cat) && (!status || b.status === status) && (!t || b.no === no || plain(`${b.title} ${b.author} ${b.no} ${b.isbn}`).includes(t)));
  }, [lib.books, q, cat, status]);
  const fail = (err: unknown) => toast.show(friendlyError(err));

  return (
    <>
      <section className="card stack">
        <div className="lib-buttons">
          <button type="button" className={`btn${panel === 'add' ? ' btn-primary' : ''}`} onClick={() => setPanel(panel === 'add' ? '' : 'add')}>Add a book</button>
          <button type="button" className={`btn${panel === 'upload' ? ' btn-primary' : ''}`} onClick={() => setPanel(panel === 'upload' ? '' : 'upload')}>Upload a list (Excel or PDF)</button>
          <button type="button" className={`btn${panel === 'stickers' ? ' btn-primary' : ''}`} onClick={() => setPanel(panel === 'stickers' ? '' : 'stickers')} disabled={!lib.books.length}>Print QR stickers</button>
          <button type="button" className="btn btn-quiet" disabled={!lib.books.length} onClick={() => bookListWorkbook(lib.books).then(downloadFile, fail)}>Download Excel</button>
        </div>
        {panel === 'add' && <AddBook org={org} lib={lib} today={today} onDone={added} />}
        {panel === 'upload' && <UploadList org={org} lib={lib} today={today} onDone={added} />}
        {panel === 'stickers' && <Stickers key={fresh.join()} lib={lib} fresh={fresh} />}
      </section>

      <section className="card stack">
        <div className="field-row lib-three">
          <label className="field"><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author or LIB number" /></label>
          <label className="field"><span>Category</span><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c} ({lib.books.filter((b) => b.category === c).length})</option>)}</select></label>
          <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{(['in', 'out', 'lost', 'damaged'] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
        </div>
        {!lib.books.length ? <p className="muted">No books yet. Press <b>Upload a list</b> to add many at once, or <b>Add a book</b>.</p> : !list.length ? <p className="muted">No book matches.</p> : (
          <div className="table-scroll"><table className="table lib-table">
            <thead><tr><th>No.</th><th>Title</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>{list.slice(0, show).map((b) => (
              <BookRow key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? '' : b.id)} cats={cats} today={today}
                onSave={(c) => { updateBook(org.id, b.id, c).catch(fail); setOpen(''); toast.show('Saved.'); }}
                onShelf={() => { backOnShelf(org.id, b.id).catch(fail); toast.show(`${b.no} is back on the shelf.`); }}
                onRemove={() => { removeBook(org.id, b.id).catch(fail); setOpen(''); toast.show(`${b.no} removed from the library list.`); }} />
            ))}</tbody>
          </table></div>
        )}
        {list.length > show && <button type="button" className="btn btn-quiet" onClick={() => setShow((s) => s + 200)}>Show more ({list.length - show} more)</button>}
      </section>
    </>
  );
}

function BookRow({ b, open, onToggle, cats, today, onSave, onShelf, onRemove }: {
  b: LibraryBook; open: boolean; onToggle: () => void; cats: string[]; today: string;
  onSave: (c: Partial<Pick<LibraryBook, 'title' | 'author' | 'category' | 'shelf' | 'price' | 'isbn'>>) => void; onShelf: () => void; onRemove: () => void;
}) {
  const [f, setF] = useState({ title: b.title, author: b.author, category: b.category, shelf: b.shelf, isbn: b.isbn, price: b.price != null ? String(b.price) : '' });
  const [sure, setSure] = useState(false);
  const tone = b.status === 'in' ? 'inv-ok' : b.status === 'out' ? (b.loan && isOverdue(b.loan, today) ? 'inv-late' : 'inv-due') : '';
  return (
    <>
      <tr className="lib-row" onClick={onToggle}>
        <td className="lib-no">{b.no}</td>
        <td><b>{b.title}</b>{b.author && <div className="muted small">{b.author}</div>}</td>
        <td className="small">{b.category}</td>
        <td><span className={`inv-chip ${tone}`}>{b.category === REFERENCE && b.status === 'in' ? 'Library use only' : STATUS_LABELS[b.status]}</span>
          {b.loan && <div className="muted small">{b.loan.whoName} · due {prettyDay(b.loan.dueOn)}</div>}
          {b.lostNote && <div className="muted small">{b.lostNote}</div>}</td>
      </tr>
      {open && (
        <tr className="lib-edit"><td colSpan={4}>
          <div className="field-row lib-three">
            <label className="field"><span>Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="field"><span>Author</span><input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
            <label className="field"><span>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="field"><span>Shelf</span><input value={f.shelf} onChange={(e) => setF({ ...f, shelf: e.target.value })} /></label>
            <label className="field"><span>ISBN</span><input value={f.isbn} onChange={(e) => setF({ ...f, isbn: e.target.value })} /></label>
            <label className="field"><span>Price to replace (KES)</span><input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="numeric" /></label>
          </div>
          <p className="hint">Borrowed {b.timesOut} {b.timesOut === 1 ? 'time' : 'times'} · added {prettyDay(b.addedOn)}</p>
          <div className="lib-buttons">
            <button type="button" className="btn btn-primary" disabled={!f.title.trim()} onClick={() => { const p = Number(f.price.replace(/[^0-9]/g, '')); onSave({ title: f.title.trim().slice(0, 200), author: f.author.trim().slice(0, 120), category: f.category, shelf: f.shelf.trim().slice(0, 40), isbn: f.isbn.trim().slice(0, 20), price: f.price.trim() && p > 0 ? p : null }); }}>Save</button>
            {(b.status === 'lost' || b.status === 'damaged') && <button type="button" className="btn" onClick={onShelf}>Found or mended: back on the shelf</button>}
            {b.status !== 'out' && (sure ? <button type="button" className="btn btn-danger" onClick={onRemove}>Yes, remove {b.no}</button>
              : <button type="button" className="btn btn-quiet" onClick={() => setSure(true)}>Remove this copy</button>)}
          </div>
        </td></tr>
      )}
    </>
  );
}

function AddBook({ org, lib, today, onDone }: { org: Organization; lib: LibraryData; today: string; onDone: (nos: string[]) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', author: '', category: lib.settings.categories[0] ?? 'Other', copies: '1', shelf: '', price: '' });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!f.title.trim()) return toast.show('Type the title.');
    const copies = Math.min(50, Math.max(1, Number(f.copies) || 1));
    const p = Number(f.price.replace(/[^0-9]/g, ''));
    setBusy(true);
    try {
      const nos = await addBooks(org.id, [{ title: f.title, author: f.author, category: f.category, isbn: '', shelf: f.shelf.trim(), price: f.price.trim() && p > 0 ? p : null, copies }], today, lib.highest);
      toast.show(`Added ${nos.length === 1 ? nos[0] : `${nos[0]} to ${nos[nos.length - 1]}`}. Print the stickers next.`);
      setF({ ...f, title: '', author: '', copies: '1', price: '' });
      onDone(nos);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  return (
    <div className="stack lib-panel">
      <div className="field-row lib-three">
        <label className="field"><span>Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Author</span><input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
        <label className="field"><span>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{lib.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>Copies</span><input value={f.copies} onChange={(e) => setF({ ...f, copies: e.target.value })} inputMode="numeric" /></label>
      </div>
      <details className="lib-fold"><summary>Shelf and price (optional)</summary>
        <div className="field-row">
          <label className="field"><span>Shelf</span><input value={f.shelf} onChange={(e) => setF({ ...f, shelf: e.target.value })} placeholder="e.g. A1" /></label>
          <label className="field"><span>Price to replace (KES)</span><input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="numeric" /></label>
        </div>
      </details>
      <p className="hint">Each copy gets its own number, starting at LIB-{String(lib.highest + 1).padStart(4, '0')}.</p>
      <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : 'Add'}</button></div>
    </div>
  );
}

function UploadList({ org, lib, today, onDone }: { org: Organization; lib: LibraryData; today: string; onDone: (nos: string[]) => void }) {
  const toast = useToast();
  const [fallback, setFallback] = useState('Other');
  const [found, setFound] = useState<{ books: ImportedBook[]; skipped: number; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (err: unknown) => toast.show(friendlyError(err));
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { const r = await readBookList(file, lib.settings.categories, fallback); setFound({ books: r.books, skipped: r.skipped, file: file.name }); }
    catch (err) { fail(err); } finally { setBusy(false); }
  }
  const copies = found?.books.reduce((s, b) => s + b.copies, 0) ?? 0;
  async function add() {
    if (!found) return;
    setBusy(true);
    try {
      const nos = await addBooks(org.id, found.books, today, lib.highest);
      toast.show(`${nos.length} books added, ${nos[0]} to ${nos[nos.length - 1]}. Print their stickers now.`);
      setFound(null);
      onDone(nos);
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  const setCat = (i: number, category: string) => setFound((f) => f && { ...f, books: f.books.map((b, k) => (k === i ? { ...b, category } : b)) });
  const drop = (i: number) => setFound((f) => f && { ...f, books: f.books.filter((_, k) => k !== i) });
  return (
    <div className="stack lib-panel">
      {!found ? (
        <>
          <p className="hint">Choose an Excel file or a PDF with the list of books. A column called <b>Title</b> is enough; Author, Category and Copies are read too. A PDF without headings is read as one book on each line.</p>
          <div className="lib-buttons">
            <label className="btn btn-primary">{busy ? 'Reading…' : 'Choose the file'}<input type="file" accept=".xlsx,.csv,.pdf,application/pdf" hidden onChange={(e) => void pick(e)} disabled={busy} /></label>
            <button type="button" className="btn btn-quiet" onClick={() => bookTemplate(lib.settings.categories).then(downloadFile, fail)}>Download the Excel template</button>
          </div>
          <label className="field lib-narrow"><span>Category for books the list doesn't give one</span>
            <select value={fallback} onChange={(e) => setFallback(e.target.value)}>{lib.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        </>
      ) : (
        <>
          <p><b>{found.books.length} {found.books.length === 1 ? 'title' : 'titles'}</b> ({copies} {copies === 1 ? 'copy' : 'copies'}) found in {found.file}.{found.skipped ? ` ${found.skipped} lines were left out.` : ''} Check the categories, then press Add.</p>
          <div className="table-scroll lib-preview"><table className="table lib-table">
            <thead><tr><th>Title</th><th>Author</th><th>Copies</th><th>Category</th><th /></tr></thead>
            <tbody>{found.books.map((b, i) => (
              <tr key={i}><td>{b.title}</td><td className="small">{b.author}</td><td>{b.copies}</td>
                <td><select value={b.category} onChange={(e) => setCat(i, e.target.value)} aria-label="Category">{lib.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></td>
                <td><button type="button" className="btn btn-quiet btn-small" onClick={() => drop(i)} aria-label={`Leave out ${b.title}`}>✕</button></td></tr>
            ))}</tbody>
          </table></div>
          <div className="lib-buttons">
            <button type="button" className="btn btn-primary" disabled={busy || !found.books.length} onClick={() => void add()}>{busy ? 'Adding…' : `Add ${copies} ${copies === 1 ? 'book' : 'books'}`}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setFound(null)}>Choose another file</button>
          </div>
        </>
      )}
    </div>
  );
}

function Stickers({ lib, fresh }: { lib: LibraryData; fresh: string[] }) {
  const toast = useToast();
  const num = (no: string | undefined) => (no ? Number(no.replace(/\D/g, '')) : 0);
  const lastDay = lib.books.reduce((m, b) => (b.addedOn > m ? b.addedOn : m), '');
  const newest = lib.books.filter((b) => b.addedOn === lastDay);
  const [from, setFrom] = useState(String(num(fresh[0]) || newest[0]?.n || 1));
  const [to, setTo] = useState(String(num(fresh[fresh.length - 1]) || newest[newest.length - 1]?.n || lib.highest));
  const [busy, setBusy] = useState(false);
  const pick = lib.books.filter((b) => b.n >= Number(from) && b.n <= Number(to));
  return (
    <div className="stack lib-panel">
      <p className="hint">Print on A4 (24 stickers a page), cut them out and stick one inside each cover. The phone camera reads the QR code to lend and return.</p>
      <div className="field-row">
        <label className="field"><span>From LIB number</span><input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
        <label className="field"><span>To LIB number</span><input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
      </div>
      <div><button type="button" className="btn btn-primary" disabled={busy || !pick.length} onClick={() => { setBusy(true); stickersPdf(pick).then((f) => shareOrDownload(f, 'ADIA library stickers'), (e) => toast.show(friendlyError(e))).finally(() => setBusy(false)); }}>
        {busy ? 'Making…' : `Download ${pick.length} ${pick.length === 1 ? 'sticker' : 'stickers'} (PDF)`}</button></div>
    </div>
  );
}

// ---- Reports, shelf check and settings ------------------------------------------------------------------

function ReportsTab({ org, lib, today }: { org: Organization; lib: LibraryData; today: string }) {
  const toast = useToast();
  const { profile } = useAuth();
  const months = useMemo(() => {
    const first = [today.slice(0, 7), ...lib.loans.map((l) => l.outOn.slice(0, 7)), ...lib.books.map((b) => b.addedOn.slice(0, 7))].sort()[0]!;
    const out: string[] = [];
    for (let m = today.slice(0, 7); m >= first && out.length < 36;) {
      out.push(m);
      const [y, mm] = m.split('-').map(Number);
      m = mm === 1 ? `${y! - 1}-12` : `${y}-${String(mm! - 1).padStart(2, '0')}`;
    }
    return out;
  }, [lib.loans, lib.books, today]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const r = useMemo(() => libraryReport(lib.books, lib.loans, month, today, lib.settings.categories), [lib.books, lib.loans, month, today, lib.settings.categories]);
  const [busy, setBusy] = useState(false);
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const max = Math.max(1, ...r.byCategory.map((c) => c.copies));
  return (
    <>
      <section className="card stack">
        <div className="field-row lib-three">
          <label className="field"><span>Month</span><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
          <button type="button" className="btn btn-primary align-end" disabled={busy} onClick={() => { setBusy(true); reportPdf(r, profile?.displayName ?? '').then((f) => shareOrDownload(f, `ADIA library report, ${monthName(month)}`), fail).finally(() => setBusy(false)); }}>Download PDF</button>
          <button type="button" className="btn align-end" onClick={() => reportWorkbook(r).then(downloadFile, fail)}>Download Excel</button>
        </div>
        <p className="hint">In {monthName(month)}: {r.lentThisMonth} lent to {r.borrowersThisMonth} {r.borrowersThisMonth === 1 ? 'person' : 'people'}, {r.returnedThisMonth} returned. {r.titles} different titles in {r.books} copies.</p>
      </section>
      <section className="card">
        <h2>Books per category</h2>
        {!r.byCategory.length ? <p className="muted">No books yet.</p> : r.byCategory.map((c) => (
          <div key={c.category} className="lib-bar"><span>{c.category}</span><i style={{ width: `${(c.copies / max) * 100}%` }} /><span>{c.copies}</span></div>
        ))}
      </section>
      {r.mostBorrowed.length > 0 && (
        <section className="card"><h2>Most borrowed in {monthName(month)}</h2>
          <ol className="lib-most">{r.mostBorrowed.map((m) => <li key={m.title}>{m.title} <span className="muted">· {m.times}×</span></li>)}</ol>
        </section>
      )}
      {r.lost.length > 0 && (
        <details className="card lib-fold"><summary><b>Lost or damaged ({r.lost.length})</b></summary>
          <ul className="lib-most">{r.lost.map((l) => <li key={l.no}>{l.no} {l.title} · {STATUS_LABELS[l.status]}{l.note ? ` · ${l.note}` : ''}{l.price != null ? ` · KES ${l.price.toLocaleString('en-KE')}` : ''}</li>)}</ul>
        </details>
      )}
      <ShelfCheckCard org={org} lib={lib} today={today} />
      <SettingsCard orgId={org.id} lib={lib} />
    </>
  );
}

/** Once a term (11A): scan every book on the shelves; what was not seen and is not on loan is missing. */
function ShelfCheckCard({ org, lib, today }: { org: Organization; lib: LibraryData; today: string }) {
  const toast = useToast();
  const { profile } = useAuth();
  const open = lib.checks.find((c) => !c.closedOn) ?? null;
  const last = lib.checks.find((c) => c.closedOn) ?? null;
  const [scan, setScan] = useState(false);
  const check = open ?? last;
  const missing = check ? shelfMissing(lib.books, check.seen) : [];
  const seenRef = useRef(new Set<string>());
  function scanned(no: string): string {
    if (!open) return '✗ Start the shelf check first.';
    const b = lib.books.find((x) => x.no === no);
    if (!b) return `✗ ${no} is not in the library list.`;
    if (open.seen.includes(b.id) || seenRef.current.has(b.id)) return `✓ ${b.no} already counted.`;
    seenRef.current.add(b.id);
    shelfSeen(org.id, open.id, b.id).catch((e) => toast.show(friendlyError(e)));
    return `✓ ${b.no} ${b.title}${b.status === 'out' ? ' (it was marked on loan: return it on Lend & return)' : ''}`;
  }
  return (
    <section className="card stack">
      <div className="card-head"><h2>Shelf check{check ? ` · ${check.name}` : ''}</h2>
        {!open && <button type="button" className="btn btn-gold" onClick={() => { startShelfCheck(org.id, termName(today), today, profile?.displayName ?? ''); seenRef.current.clear(); setScan(true); }}>Start shelf check</button>}
      </div>
      {!check && <p className="hint">Once a term, scan every book on the shelves. The app then lists the books that were not found and are not out on loan.</p>}
      {open && (
        <>
          <p>{open.seen.length} scanned so far · {missing.length} not found yet. Started {prettyDay(open.startedOn)}.</p>
          <div className="lib-buttons">
            <button type="button" className="btn btn-primary" onClick={() => setScan((s) => !s)}>{scan ? 'Close camera' : '📷 Scan books'}</button>
            <button type="button" className="btn" onClick={() => { closeShelfCheck(org.id, open.id, today).catch((e) => toast.show(friendlyError(e))); setScan(false); toast.show(`Shelf check finished. ${missing.length} not found.`); }}>Finish the check</button>
          </div>
          {scan && <Scanner onCode={scanned} hint="Scan each book on the shelf. A beep and a tick for each one." />}
        </>
      )}
      {check && missing.length > 0 && (
        <details className="lib-fold" open={!open}><summary>{open ? 'Not found yet' : `Not found at the last check (${prettyDay(check.closedOn!)})`}: {missing.length}</summary>
          <ul className="lib-most">{missing.slice(0, 300).map((b) => <li key={b.id}>{b.no} {b.title}{b.shelf ? ` · shelf ${b.shelf}` : ''}</li>)}</ul>
          <p className="hint">If a book is really gone, open it under Books and mark it lost.</p>
        </details>
      )}
      {check && !open && !missing.length && <p className="hint">Every book was found at the last check ({prettyDay(check.closedOn!)}).</p>}
    </section>
  );
}

function SettingsCard({ orgId, lib }: { orgId: string; lib: LibraryData }) {
  const toast = useToast();
  const s = lib.settings;
  const [cats, setCats] = useState(s.categories.join('\n'));
  const [days, setDays] = useState(String(s.loanDays));
  const [limits, setLimits] = useState({ student: String(s.limits.student), staff: String(s.limits.staff), church: String(s.limits.church) });
  function save() {
    const list = [...new Set(cats.split('\n').map((c) => c.trim()).filter(Boolean))];
    const inUse = [...new Set(lib.books.map((b) => b.category))].filter((c) => !list.includes(c));
    if (inUse.length) return toast.show(`Books still use ${inUse.join(', ')}. Move them first, or keep the category.`);
    const num = (v: string, d: number) => Math.min(20, Math.max(1, Number(v) || d));
    const next: LibrarySettings = { ...s, categories: list, loanDays: Math.min(120, Math.max(1, Number(days) || 14)), limits: { student: num(limits.student, 2), staff: num(limits.staff, 5), church: num(limits.church, 2) } };
    saveLibrarySettings(orgId, next, lib.settingsSaved).catch((e) => toast.show(friendlyError(e)));
    toast.show('Library settings saved.');
  }
  return (
    <details className="card lib-fold">
      <summary><b>Library settings</b> <span className="muted small">categories, days and limits</span></summary>
      <div className="stack">
        <label className="field"><span>Categories (one on each line)</span><textarea rows={8} value={cats} onChange={(e) => setCats(e.target.value)} /></label>
        <div className="field-row lib-three">
          <label className="field"><span>Days to keep a book</span><input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label>
          <label className="field"><span>Books at a time: students</span><input value={limits.student} onChange={(e) => setLimits({ ...limits, student: e.target.value })} inputMode="numeric" /></label>
          <label className="field"><span>Staff</span><input value={limits.staff} onChange={(e) => setLimits({ ...limits, staff: e.target.value })} inputMode="numeric" /></label>
          <label className="field"><span>Church members</span><input value={limits.church} onChange={(e) => setLimits({ ...limits, church: e.target.value })} inputMode="numeric" /></label>
        </div>
        <Members orgId={orgId} lib={lib} />
        <div><button type="button" className="btn btn-primary" onClick={save}>Save settings</button></div>
      </div>
    </details>
  );
}

function Members({ orgId, lib }: { orgId: string; lib: LibraryData }) {
  const toast = useToast();
  if (!lib.members.length) return null;
  const holding = (id: string) => lib.books.some((b) => b.status === 'out' && b.loan?.who === `member:${id}`);
  return (
    <details className="lib-fold"><summary>Staff and church members who borrow ({lib.members.length})</summary>
      <ul className="lib-most">{lib.members.map((m) => (
        <li key={m.id}>{m.name} · {BORROWER_LABELS[m.kind]}{m.phone ? ` · ${formatPhone(m.phone)}` : ''}{' '}
          {!holding(m.id) && <button type="button" className="btn btn-quiet btn-small" onClick={() => { removeMember(orgId, m.id).catch((e) => toast.show(friendlyError(e))); toast.show(`${m.name} removed.`); }}>Remove</button>}</li>
      ))}</ul>
    </details>
  );
}
