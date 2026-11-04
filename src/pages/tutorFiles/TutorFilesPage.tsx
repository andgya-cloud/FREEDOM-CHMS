import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useLiveDoc, useLiveQuery } from '../../lib/useQuery';
import { useClassEvents } from '../../state/useAttendance';
import { friendlyError } from '../../lib/errors';
import { softDelete } from '../../lib/records';
import {
  approveFile, askForFile, askToChange, changeRequest, downloadTutorFile, loadTutors, reopenFile, sendBackFile, sendTutorFile, type Tutor,
} from '../../lib/tutorFiles';
import { isInventoryManager, TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { addDays, mondayOf } from '../../../functions/src/shared/metrics';
import {
  canSend, dueText, FILE_KIND_LABELS, FILE_KINDS, isForTutor, lessonFileId, requestFileId, urgency,
  type FileKind, type FileRequest, type TutorFile,
} from '../../../functions/src/shared/tutorFiles';

type RequestRow = FileRequest & { id: string; deletedAt?: unknown };
type FileRow = TutorFile & { id: string };
type ClassEventRow = { id: string; name: string; date: string; type: string; deletedAt?: unknown };

const today = () => localDateKey(new Date());
const byDeadline = (a: RequestRow, b: RequestRow) => a.deadline.localeCompare(b.deadline) || a.title.localeCompare(b.title);

function useRequests(orgId: string) {
  const { rows } = useLiveQuery<RequestRow>(() => (orgId ? collection(db, 'organizations', orgId, 'fileRequests') : null), [orgId]);
  return useMemo(() => rows.filter((r) => !r.deletedAt).sort(byDeadline), [rows]);
}

/** A tutor reads only their own files; the principal reads every file. */
function useFiles(orgId: string, uid: string, all: boolean) {
  const { rows } = useLiveQuery<FileRow>(
    () => (!orgId || !uid ? null : all ? collection(db, 'organizations', orgId, 'tutorFiles') : query(collection(db, 'organizations', orgId, 'tutorFiles'), where('tutorUid', '==', uid))),
    [orgId, uid, all],
  );
  return rows;
}

/** ADIA Tutor Files (Andy, 2026-11-04, 1A-8A): the principal asks, tutors send. */
export function TutorFilesPage() {
  const { profile, can } = useAuth();
  const { current } = useOrg();
  const orgId = current?.type === 'college' ? current.id : '';
  const manager = (!!profile && isInventoryManager(profile)) || can('exams.manage');
  if (!orgId) return <div className="page narrow"><p>Tutor Files is part of ADIA Training Centre.</p></div>;
  return manager ? <PrincipalView orgId={orgId} /> : <TutorView orgId={orgId} />;
}

/* ------------------------------------------------------------------ the tutor */

function TutorView({ orgId }: { orgId: string }) {
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const requests = useRequests(orgId).filter((r) => isForTutor(r, profile?.trainerCourseIds ?? []));
  const files = useFiles(orgId, uid, false);
  const fileFor = (id: string) => files.find((f) => f.id === id);
  const now = today();
  const open = requests.filter((r) => { const f = fileFor(requestFileId(r.id, uid)); return !f || f.status === 'returned'; });
  // The page turns redder as the nearest deadline closes in (Andy, 2026-11-04).
  const heat = open.reduce((m, r) => Math.max(m, urgency(r.deadline, now)), 0);
  const { events: classEvents } = useClassEvents(orgId, profile?.registerClasses ?? []);
  const since = addDays(now, -13);
  const lessons = classEvents.filter((e) => !e.deletedAt && e.date >= since && e.date <= now).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

  return (
    <div className="page narrow tf-page" style={{ '--heat': heat } as CSSProperties}>
      <h1>My files</h1>
      <p className="muted small">Files the principal has asked for. Send a PDF or Word file, or take photos of the pages.</p>
      {requests.length === 0 && <section className="card"><p className="muted">Nothing has been asked for yet.</p></section>}
      {requests.map((r) => <TutorRequestCard key={r.id} orgId={orgId} request={r} file={fileFor(requestFileId(r.id, uid))} />)}

      <h2>Lesson plans</h2>
      <p className="muted small">Add the plan for each lesson after you mark its register.</p>
      <section className="card tf-lessons">
        {lessons.length === 0 && <p className="muted">No class registers in the last two weeks.</p>}
        {lessons.map((e) => {
          const f = fileFor(lessonFileId(e.id, uid));
          return (
            <div key={e.id} className="tf-lesson">
              <div><strong>{e.name}</strong><span className="muted small"> · {formatDateKey(e.date)}</span></div>
              <LessonPlanControls orgId={orgId} eventId={e.id} file={f} compact />
            </div>
          );
        })}
      </section>
    </div>
  );
}

function statusLine(f: FileRow | undefined, now: string): { text: string; tone: string } {
  if (!f) return { text: 'Not sent yet', tone: 'muted' };
  if (f.status === 'approved') return { text: `Approved by ${f.approvedByName}`, tone: 'done' };
  if (f.status === 'returned') return { text: 'Sent back to you', tone: 'late' };
  if (canSend(f, now)) return { text: `Opened for changes until ${formatDateKey(f.reopenUntil)}`, tone: 'ask' };
  if (f.reopenRequest) return { text: 'Sent ✓ · asked to change', tone: 'ask' };
  return { text: `Sent ✓ ${formatDateKey(f.sentOn)}${f.late ? ' · Late' : ''}`, tone: f.late ? 'late' : 'done' };
}

function TutorRequestCard({ orgId, request: r, file: f }: { orgId: string; request: RequestRow; file?: FileRow }) {
  const now = today();
  const s = statusLine(f, now);
  const sendable = canSend(f, now);
  const heat = sendable ? urgency(r.deadline, now) : 0;
  return (
    <section className={`card tf-card${sendable && heat >= 1 ? ' tf-hot' : ''}`} style={{ '--heat': heat } as CSSProperties}>
      <div className="tf-head">
        <div>
          <h3>{r.title}</h3>
          <p className="muted small">{FILE_KIND_LABELS[r.kind]} · Deadline {formatDateKey(r.deadline)}</p>
        </div>
        {sendable && <span className="tf-due">{dueText(r.deadline, now)}</span>}
      </div>
      {r.note && <p className="small">{r.note}</p>}
      <p className={`tf-status tf-${s.tone}`}>{s.text}</p>
      {f?.status === 'returned' && f.returnNote && <p className="tf-note">“{f.returnNote}”</p>}
      <FileActions orgId={orgId} target={{ requestId: r.id }} file={f} late={now > r.deadline} />
    </section>
  );
}

/** Send (PDF, Word or photos), Download, and "Ask to change" once sent. */
function FileActions({ orgId, target, file: f, late, compact }: { orgId: string; target: { requestId: string } | { eventId: string }; file?: FileRow; late?: boolean; compact?: boolean }) {
  const toast = useToast();
  const now = today();
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const docInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const sendable = canSend(f, now);

  async function send(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy('Sending…');
    try {
      const r = await sendTutorFile(orgId, target, files);
      toast.show(r.late ? 'Sent, marked Late. The principal can see it now.' : 'Sent ✓ The principal can see it now.');
    } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
    if (docInput.current) docInput.current.value = '';
    if (photoInput.current) photoInput.current.value = '';
  }
  async function download() {
    setBusy('Opening…');
    try { await downloadTutorFile(orgId, f!.id); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  }
  async function ask() {
    if (!reason.trim()) return toast.show('Say what you want to change.');
    setBusy('Asking…');
    try { await askToChange(orgId, f!.id, reason); toast.show('Asked. The principal will open it for you.'); setAsking(false); setReason(''); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  }

  return (
    <div className="tf-actions">
      <input ref={docInput} type="file" hidden accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => send(e.target.files)} />
      <input ref={photoInput} type="file" hidden accept="image/*" multiple onChange={(e) => send(e.target.files)} />
      {sendable && (<>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => docInput.current?.click()}>{busy === 'Sending…' ? busy : f ? `Send again${compact ? '' : ' (PDF or Word)'}` : compact ? 'Add lesson plan' : `Send PDF or Word${late ? ' (late)' : ''}`}</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => photoInput.current?.click()}>Take photos</button>
      </>)}
      {f && <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={download}>{busy === 'Opening…' ? busy : 'Download'}</button>}
      {f && !sendable && f.status !== 'approved' && !f.reopenRequest && !asking && <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>Ask to change</button>}
      {asking && (
        <div className="tf-ask">
          <input value={reason} maxLength={300} placeholder="What do you want to change?" onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn btn-small btn-primary" disabled={!!busy} onClick={ask}>Ask the principal</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function LessonPlanControls({ orgId, eventId, file, compact }: { orgId: string; eventId: string; file?: FileRow; compact?: boolean }) {
  const now = today();
  const s = file ? statusLine(file, now) : null;
  return (
    <div className="tf-lesson-ctl">
      {s && <span className={`tf-status tf-${s.tone} small`}>{s.text}</span>}
      <FileActions orgId={orgId} target={{ eventId }} file={file} compact={compact} />
    </div>
  );
}

/** "Add lesson plan" on a class register, for the tutor whose class it is (7A). */
export function LessonPlanCard({ orgId, eventId }: { orgId: string; eventId: string }) {
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const id = lessonFileId(eventId, uid);
  const { data } = useLiveDoc<TutorFile>(() => (uid ? doc(db, 'organizations', orgId, 'tutorFiles', id) : null), [orgId, id, uid]);
  if (profile?.roleId !== TRAINER_ROLE_ID) return null;
  return (
    <section className="card tf-plan-card">
      <h3>Lesson plan</h3>
      <p className="muted small">After the lesson, add its plan as a PDF or Word file, or take photos of the pages.</p>
      <LessonPlanControls orgId={orgId} eventId={eventId} file={data ? { ...data, id } : undefined} compact />
    </section>
  );
}

/* ------------------------------------------------------------------ the principal */

function PrincipalView({ orgId }: { orgId: string }) {
  const toast = useToast();
  const requests = useRequests(orgId);
  const files = useFiles(orgId, 'all', true);
  const [tutors, setTutors] = useState<Tutor[] | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => { loadTutors(orgId).then(setTutors).catch((err) => { setTutors([]); toast.show(friendlyError(err)); }); }, [orgId, toast]);
  const asks = files.filter((f) => f.reopenRequest);
  const now = today();
  const current = requests.filter((r) => r.deadline >= addDays(now, -60));
  const older = requests.filter((r) => r.deadline < addDays(now, -60));

  return (
    <div className="page tf-page">
      <div className="person-head">
        <div>
          <h1>Tutor Files</h1>
          <p className="muted small">Reports, course outlines and lesson plans from the tutors.</p>
        </div>
        {!asking && <button type="button" className="btn btn-primary" onClick={() => setAsking(true)}>Ask for a file</button>}
      </div>
      {asking && <AskForFileForm orgId={orgId} onDone={() => setAsking(false)} />}
      {asks.map((f) => <ReopenAsk key={f.id} orgId={orgId} file={f} />)}

      {current.length === 0 && !asking && <section className="card"><p className="muted">Nothing asked for yet. Tap "Ask for a file" to start.</p></section>}
      {current.map((r) => <RequestCard key={r.id} orgId={orgId} request={r} files={files} tutors={tutors} />)}
      {older.length > 0 && (
        <details className="card fold">
          <summary>Older requests ({older.length})</summary>
          {older.map((r) => <RequestCard key={r.id} orgId={orgId} request={r} files={files} tutors={tutors} />)}
        </details>
      )}

      <LessonPlanGrid orgId={orgId} files={files} tutors={tutors} />
    </div>
  );
}

function AskForFileForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const { rows: courses } = useLiveQuery<{ id: string; name: string; deletedAt?: unknown; active?: boolean }>(() => collection(db, 'organizations', orgId, 'courses'), [orgId]);
  const live = courses.filter((c) => !c.deletedAt && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<FileKind>('report');
  const [deadline, setDeadline] = useState(addDays(today(), 14));
  const [who, setWho] = useState<'all' | 'some'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');

  function save() {
    if (!title.trim()) return toast.show('Type what you are asking for.');
    if (who === 'some' && !picked.length) return toast.show('Tick at least one department.');
    askForFile(orgId, { title, kind, deadline, courseIds: who === 'all' ? [] : picked, note, createdByName: profile?.displayName ?? '' })
      .catch((err) => toast.show(friendlyError(err)));
    toast.show(`Asked for ${title.trim()}. Tutors see it now.`);
    onDone();
  }

  return (
    <section className="card tf-form">
      <h3>Ask for a file</h3>
      <label className="field"><span>What do you need?</span>
        <input value={title} maxLength={120} placeholder="For example Term 1 report" onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <div className="tf-row">
        <label className="field"><span>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>{FILE_KINDS.map((k) => <option key={k} value={k}>{FILE_KIND_LABELS[k]}</option>)}</select>
        </label>
        <label className="field"><span>Deadline</span>
          <input type="date" value={deadline} min={today()} onChange={(e) => setDeadline(e.target.value || deadline)} />
        </label>
        <label className="field"><span>For</span>
          <select value={who} onChange={(e) => setWho(e.target.value as 'all' | 'some')}><option value="all">All tutors</option><option value="some">Chosen departments</option></select>
        </label>
      </div>
      {who === 'some' && (
        <div className="chip-row">
          {live.map((c) => (
            <button key={c.id} type="button" className={`chip${picked.includes(c.id) ? ' chip-on' : ''}`} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>{c.name}</button>
          ))}
        </div>
      )}
      <label className="field"><span>Note (optional)</span>
        <input value={note} maxLength={500} placeholder="Anything the tutors should know" onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="muted small">Tutors get a reminder email each morning for the last 5 days until they send it.</p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={save}>Ask the tutors</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </section>
  );
}

function ReopenAsk({ orgId, file: f }: { orgId: string; file: FileRow }) {
  const toast = useToast();
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try { const r = await reopenFile(orgId, f.id, days); toast.show(`Opened for ${f.tutorName} until ${formatDateKey(r.until)}.`); } catch (err) { toast.show(friendlyError(err)); }
    setBusy(false);
  }
  return (
    <div className="inv-banner inv-banner-late tf-askbar" role="status">
      <span><strong>{f.reopenRequest!.byName}</strong> asks to change <strong>{f.kind === 'lesson' ? `the lesson plan for ${f.title}` : f.title}</strong>: “{f.reopenRequest!.reason}”</span>
      <span className="tf-askbar-ctl">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Open for">
          {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d === 1 ? 'Today only' : `${d} days`}</option>)}
        </select>
        <button type="button" className="btn btn-small" disabled={busy} onClick={open}>Open it</button>
      </span>
    </div>
  );
}

function RequestCard({ orgId, request: r, files, tutors }: { orgId: string; request: RequestRow; files: FileRow[]; tutors: Tutor[] | null }) {
  const toast = useToast();
  const now = today();
  const forThem = (tutors ?? []).filter((t) => isForTutor(r, t.courseIds));
  const fileOf = (uid: string) => files.find((f) => f.id === requestFileId(r.id, uid));
  const sent = forThem.filter((t) => fileOf(t.uid)).length;
  const [editing, setEditing] = useState(false);
  const [deadline, setDeadline] = useState(r.deadline);
  const late = now > r.deadline;
  return (
    <details className="card tf-req" open={!late || sent < forThem.length}>
      <summary>
        <span className="tf-req-title"><strong>{r.title}</strong><span className="muted small"> · {FILE_KIND_LABELS[r.kind]} · Deadline {formatDateKey(r.deadline)}</span></span>
        <span className={`tf-count${sent === forThem.length && forThem.length ? ' tf-done' : late ? ' tf-late' : ''}`}>{tutors ? `${sent} of ${forThem.length} sent` : '…'}</span>
      </summary>
      {r.note && <p className="small muted">{r.note}</p>}
      <div className="tf-tutors">
        {forThem.length === 0 && tutors && <p className="muted small">No tutor accounts match this request yet.</p>}
        {forThem.map((t) => <TutorRow key={t.uid} orgId={orgId} request={r} tutor={t} file={fileOf(t.uid)} />)}
      </div>
      <div className="button-row tf-req-foot">
        {editing ? (<>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value || deadline)} aria-label="New deadline" />
          <button type="button" className="btn btn-small btn-primary" onClick={() => { changeRequest(orgId, r.id, { deadline }).catch((err) => toast.show(friendlyError(err))); setEditing(false); }}>Save deadline</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
        </>) : (<>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(true)}>Change deadline</button>
          <button type="button" className="btn btn-small btn-quiet danger-text" onClick={() => { softDelete(doc(db, 'organizations', orgId, 'fileRequests', r.id)).catch((err) => toast.show(friendlyError(err))); toast.show(`${r.title} removed.`); }}>Remove</button>
        </>)}
      </div>
    </details>
  );
}

function TutorRow({ orgId, request: r, tutor: t, file: f }: { orgId: string; request: RequestRow; tutor: Tutor; file?: FileRow }) {
  const toast = useToast();
  const now = today();
  const [busy, setBusy] = useState('');
  const [backing, setBacking] = useState(false);
  const [note, setNote] = useState('');
  const run = async (label: string, job: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  };
  const chip = !f ? (now > r.deadline ? { t: 'Missing', c: 'late' } : { t: 'Not sent', c: 'muted' })
    : f.status === 'approved' ? { t: 'Approved', c: 'done' } : f.status === 'returned' ? { t: 'Sent back', c: 'ask' } : f.late ? { t: 'Late', c: 'late' } : { t: 'Sent', c: 'ok' };
  const nudge = `Hello ${t.name.split(' ')[0]}, a reminder that "${r.title}" is ${dueText(r.deadline, now).toLowerCase()} (deadline ${formatDateKey(r.deadline)}). Please send it in Insight-IQ under Tutor Files. Thank you.`;
  return (
    <div className="tf-tutor">
      <div className="tf-tutor-main">
        <strong>{t.name}</strong>
        <span className={`tf-chip tf-${chip.c}`}>{chip.t}</span>
        {f && <span className="muted small">{formatDateKey(f.sentOn)}</span>}
      </div>
      <div className="tf-tutor-ctl">
        {f && <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => run('d', () => downloadTutorFile(orgId, f.id))}>{busy === 'd' ? 'Opening…' : 'Download'}</button>}
        {f && f.status === 'sent' && <button type="button" className="btn btn-small btn-primary" disabled={!!busy} onClick={() => run('a', () => approveFile(orgId, f.id), `Approved ${t.name}'s file.`)}>Approve</button>}
        {f && f.status !== 'returned' && !backing && <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(true)}>Send back</button>}
        {(!f || f.status === 'returned') && t.phone && <a className="btn btn-small btn-quiet" href={`https://wa.me/${t.phone.replace(/\D/g, '')}?text=${encodeURIComponent(nudge)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
      </div>
      {backing && f && (
        <div className="tf-ask">
          <input value={note} maxLength={500} placeholder="What should they change?" onChange={(e) => setNote(e.target.value)} autoFocus />
          <button type="button" className="btn btn-small btn-primary" disabled={!!busy || !note.trim()} onClick={() => run('b', () => sendBackFile(orgId, f.id, note), `Sent back to ${t.name}.`).then(() => { setBacking(false); setNote(''); })}>Send back</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A simple week: ✓ where a lesson has its plan, a red dot where a register was marked but no plan came (7A). */
function LessonPlanGrid({ orgId, files, tutors }: { orgId: string; files: FileRow[]; tutors: Tutor[] | null }) {
  const toast = useToast();
  const [monday, setMonday] = useState(mondayOf(today()));
  const sunday = addDays(monday, 6);
  const { rows } = useLiveQuery<ClassEventRow>(
    () => query(collection(db, 'organizations', orgId, 'events'), where('date', '>=', monday), where('date', '<=', sunday)),
    [orgId, monday],
  );
  const classes = rows.filter((e) => e.type === 'class' && !e.deletedAt);
  const days = WEEKDAYS.map((label, i) => ({ label, key: addDays(monday, i) }));
  const teaching = (tutors ?? []).filter((t) => t.registerClasses.length);
  return (
    <section className="card tf-grid-card">
      <div className="tf-head">
        <h2>Lesson plans</h2>
        <div className="button-row">
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">‹</button>
          <span className="small">{formatDateKey(monday)} to {formatDateKey(sunday)}</span>
          <button type="button" className="btn btn-small btn-quiet" disabled={monday >= mondayOf(today())} onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">›</button>
        </div>
      </div>
      {teaching.length === 0 ? <p className="muted small">{tutors ? 'No tutor has class registers yet.' : 'Loading…'}</p> : (
        <div className="table-wrap">
          <table className="tf-grid">
            <thead><tr><th>Tutor</th>{days.map((d) => <th key={d.key}>{d.label}</th>)}</tr></thead>
            <tbody>
              {teaching.map((t) => (
                <tr key={t.uid}>
                  <th scope="row">{t.name}</th>
                  {days.map((d) => {
                    const lessons = classes.filter((e) => e.date === d.key && t.registerClasses.includes(e.name));
                    if (!lessons.length) return <td key={d.key} />;
                    const plans = lessons.map((e) => files.find((f) => f.id === lessonFileId(e.id, t.uid))).filter(Boolean) as FileRow[];
                    const done = plans.length === lessons.length;
                    return (
                      <td key={d.key}>
                        {done
                          ? <button type="button" className="tf-tick" title={`Download ${lessons.map((e) => e.name).join(', ')}`} onClick={() => plans.forEach((p) => downloadTutorFile(orgId, p.id).catch((err) => toast.show(friendlyError(err))))}>✓</button>
                          : <span className="tf-dot" title={`${lessons.length - plans.length} lesson plan missing`} aria-label="Lesson plan missing" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">✓ = plan added (tap to download) · red dot = register marked, plan missing.</p>
    </section>
  );
}
