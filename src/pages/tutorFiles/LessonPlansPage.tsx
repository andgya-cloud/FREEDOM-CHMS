import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { approveFile, askToChange, sendBackFile } from '../../lib/tutorFiles';
import {
  checkFile, downloadLessonFile, downloadWeekZip, lessonRoster, myCourses, removeCourse, removeLessonFile, saveCourse, uploadLessonFile,
  type LessonRoster, type LessonTeacher,
} from '../../lib/lessonPlans';
import { isInventoryManager, TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { addDays, mondayOf } from '../../../functions/src/shared/metrics';
import {
  canChange, dayColours, dayLabel, DAYS_AHEAD, DAYS_BACK, DOC_TYPE_LABELS, DOC_TYPES, hasPlan, LESSON_ACCEPT, LESSON_TYPES_TEXT, lessonCovered,
  maxFilesFor, missingLessons, uploadFileId, weekBox, weekRange, type DocType, type LessonDay, type TeachingCourse,
} from '../../../functions/src/shared/lessonPlans';
import type { TutorFile } from '../../../functions/src/shared/tutorFiles';
import { ReopenAsk } from './TutorFilesPage';
import { PoweredBy } from '../../components/PoweredBy';

type Plan = TutorFile & { id: string };
const today = () => localDateKey(new Date());
const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isLessonPlan = (p: Plan) => p.kind === 'upload' && (p.docType ?? 'lesson') === 'lesson';

/**
 * Lesson plans and course files at ADIA (Andy, 2026-11-17). Round 2 (1A-9A, 7B): a tutor picks the course, what it
 * is, and for a lesson plan the date on a calendar (green = sent, red = register marked, no plan); choosing the
 * file sends it. The principal checks plans week by week and keeps the list of courses and their tutor.
 */
export function LessonPlansPage() {
  const { profile, can } = useAuth();
  const { current } = useOrg();
  const toast = useToast();
  const orgId = current?.type === 'college' ? current.id : '';
  const manager = (!!profile && isInventoryManager(profile)) || can('exams.manage');
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const [mine, setMine] = useState<{ courses: TeachingCourse[]; lessons: LessonDay[] } | null>(null);
  const loadMine = useCallback(() => {
    if (!orgId) return;
    myCourses(orgId).then(setMine).catch((err) => { setMine({ courses: [], lessons: [] }); toast.show(friendlyError(err)); });
  }, [orgId, toast]);
  useEffect(loadMine, [loadMine]);
  if (!orgId) return <div className="page narrow"><p>Lesson plans are part of ADIA Training Centre.</p></div>;
  const teaches = (mine?.courses.length ?? 0) > 0;
  return (
    <div className={`page lp-page${manager ? '' : ' narrow'}`}>
      <h1>Lesson plans</h1>
      {mine === null && <p className="muted">Loading your courses…</p>}
      {mine && teaches && <UploadCard orgId={orgId} courses={mine.courses} lessons={mine.lessons} />}
      {mine && !teaches && (trainer || !manager) && (
        <section className="card"><p>You have no courses yet. Ask the principal to give you your courses, then come back here.</p></section>
      )}
      {manager && <PrincipalView orgId={orgId} onCoursesChanged={loadMine} />}
      <PoweredBy />
    </div>
  );
}

/* ------------------------------------------------------------------ the tutor */

function UploadCard({ orgId, courses, lessons }: { orgId: string; courses: TeachingCourse[]; lessons: LessonDay[] }) {
  const { profile } = useAuth();
  const toast = useToast();
  const uid = profile?.uid ?? '';
  const now = today();
  const { rows } = useLiveQuery<Plan>(() => (uid ? query(collection(db, 'organizations', orgId, 'tutorFiles'), where('tutorUid', '==', uid)) : null), [orgId, uid]);
  const plans = rows.filter((p) => p.kind === 'upload');
  const missing = missingLessons(lessons, courses, plans);

  // Start on the course and date of the newest lesson still without a plan (1A, 3A).
  const first = missing[0];
  const [courseKey, setCourseKey] = useState(() => (first && courses.find((c) => c.registerName === first.registerName)?.key) || courses[0]!.key);
  const [docType, setDocType] = useState<DocType>('lesson');
  const [day, setDay] = useState(first?.date ?? now);
  const course = courses.find((c) => c.key === courseKey) ?? courses[0]!;
  const fileId = uploadFileId(course.key, docType, docType === 'lesson' ? day : '', uid);
  const plan = plans.find((p) => p.id === fileId) ?? null;
  const colours = useMemo(() => dayColours(course, courses, lessons, plans), [course, courses, lessons, plans]);
  const missingHere = missing.filter((l) => l.registerName === course.registerName);
  const coveredByOther = docType === 'lesson' && !hasPlan(plan) && colours[day] === 'done';

  const [uploads, setUploads] = useState<{ name: string; p: number }[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const open = canChange(plan, now);
  const count = plan?.files?.length ?? 0;
  const what = DOC_TYPE_LABELS[docType].toLowerCase();

  async function send(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (pick.current) pick.current.value = '';
    if (camera.current) camera.current.value = '';
    if (!files.length) return;
    if (!open) return toast.show('This is approved and locked. Tap "Ask to change" first.');
    const room = maxFilesFor(docType) - count;
    if (files.length > room) return toast.show(`This holds up to ${maxFilesFor(docType)} files. You can add ${room} more.`);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) return toast.show(bad);
    setUploads(files.map((f) => ({ name: f.name, p: 0 })));
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadLessonFile(orgId, course.key, docType, docType === 'lesson' ? day : '', files[i]!, (p) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, p } : x))));
        ok++;
      } catch (err) { toast.show(`${files[i]!.name}: ${friendlyError(err)}`); }
    }
    setUploads([]);
    if (ok) toast.show(`Well done! Sent to the principal${docType === 'lesson' ? ` for ${dayLabel(day)}` : ''}.`);
  }
  function drop(e: DragEvent) { e.preventDefault(); setOver(false); void send(Array.from(e.dataTransfer.files)); }
  async function run(label: string, job: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  }

  const status = !count ? (coveredByOther ? { t: 'This lesson already has a plan under another of your courses.', c: 'done' } : { t: 'Not sent yet', c: docType === 'lesson' && colours[day] === 'missing' ? 'late' : 'muted' })
    : plan!.status === 'approved' ? { t: open ? `Opened for changes until ${formatDateKey(plan!.reopenUntil)}` : `Approved by ${plan!.approvedByName} 🔒`, c: open ? 'ask' : 'done' }
    : plan!.status === 'returned' ? { t: 'Sent back to you. Please change it and send again.', c: 'late' }
    : { t: 'Sent ✓ Waiting for the principal', c: 'ok' };

  return (
    <section className="card lp-upload">
      <div className="lp-pickers">
        <label className="field"><span>Course</span>
          <select value={course.key} onChange={(e) => setCourseKey(e.target.value)}>
            {courses.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="field"><span>What is it?</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
      </div>

      {docType === 'lesson' && (<>
        {missingHere.length > 0
          ? <p className="lp-missing">{missingHere.length === 1 ? '1 lesson has' : `${missingHere.length} lessons have`} no plan yet. Tap a red day.</p>
          : <p className="tf-status tf-done small">Every lesson you marked for this course has a plan. Well done!</p>}
        <MonthCalendar selected={day} onPick={setDay} colours={colours} min={addDays(now, -DAYS_BACK)} max={addDays(now, DAYS_AHEAD)} />
        <h3 className="lp-day">Lesson plan for {dayLabel(day)}{day === now ? ' (today)' : ''}</h3>
      </>)}

      <p className={`tf-status tf-${status.c}`}>{status.t}</p>
      {plan?.status === 'returned' && plan.returnNote && <p className="tf-note">“{plan.returnNote}”</p>}

      {count > 0 && (
        <ul className="lp-files">
          {plan!.files!.map((f) => (
            <li key={f.id}>
              <span className="lp-file-name">{f.name}<span className="muted small"> · {sizeText(f.size)} · {formatDateKey(f.uploadedOn)}</span></span>
              <span className="lp-file-ctl">
                <button type="button" className="btn btn-small btn-quiet" disabled={!!busy} onClick={() => run(`d${f.id}`, () => downloadLessonFile(orgId, fileId, f))}>{busy === `d${f.id}` ? 'Opening…' : 'Open'}</button>
                {open && <button type="button" className="btn btn-small btn-quiet danger-text" disabled={!!busy} onClick={() => run(`r${f.id}`, () => removeLessonFile(orgId, fileId, f.id), `${f.name} removed.`)}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className={`lp-drop${over ? ' lp-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <input ref={pick} type="file" hidden multiple accept={LESSON_ACCEPT} onChange={(e) => void send(e.target.files)} />
          <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void send(e.target.files)} />
          {uploads.length > 0 ? (
            <div className="lp-progress">
              {uploads.map((u, i) => <div key={i}><span className="small">Sending {u.name}…</span><progress value={u.p} max={1} /></div>)}
            </div>
          ) : (<>
            <button type="button" className="btn lp-gold" onClick={() => pick.current?.click()}>{count ? 'Add more files' : `Choose ${what}`}</button>
            <button type="button" className="btn" onClick={() => camera.current?.click()}>Take a photo</button>
            <p className="muted small">Choosing a file sends it straight to the principal. {LESSON_TYPES_TEXT}, up to 20 MB each, several at once. On a computer you can drag files here.</p>
          </>)}
        </div>
      )}

      {!open && !plan?.reopenRequest && !asking && <button type="button" className="btn btn-quiet align-start" onClick={() => setAsking(true)}>Ask to change</button>}
      {!open && plan?.reopenRequest && <p className="muted small">You asked to change it. The principal will open it for you.</p>}
      {asking && plan && (
        <div className="tf-ask">
          <input value={reason} maxLength={300} placeholder="What do you want to change?" onChange={(e) => setReason(e.target.value)} autoFocus />
          <button type="button" className="btn btn-small btn-primary" disabled={!!busy || !reason.trim()} onClick={() => run('ask', () => askToChange(orgId, plan.id, reason), 'Asked. The principal will open it for you.').then(() => { setAsking(false); setReason(''); })}>Ask the principal</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A month to tap a lesson date on (2A): green = plan sent, red = register marked but no plan. */
function MonthCalendar({ selected, onPick, colours, min, max }: { selected: string; onPick: (d: string) => void; colours: Record<string, 'done' | 'missing'>; min: string; max: string }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  useEffect(() => setMonth(selected.slice(0, 7)), [selected]);
  const firstDay = `${month}-01`;
  const start = mondayOf(firstDay);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((d, i) => i < 35 || d.slice(0, 7) === month);
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y!, m! - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const now = today();
  return (
    <div className="lp-cal">
      <div className="lp-cal-head">
        <button type="button" className="btn btn-small btn-quiet" disabled={firstDay <= min} onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <b>{MONTH_NAMES[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</b>
        <button type="button" className="btn btn-small btn-quiet" disabled={addDays(firstDay, 31) > max} onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="lp-cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="lp-cal-wd">{d}</span>)}
        {days.map((d) => {
          const out = d.slice(0, 7) !== month;
          const off = d < min || d > max;
          const c = colours[d];
          return (
            <button key={d} type="button" disabled={off} onClick={() => onPick(d)}
              className={`lp-cal-day${out ? ' lp-out' : ''}${c ? ` lp-${c}` : ''}${d === selected ? ' lp-sel' : ''}${d === now ? ' lp-today' : ''}`}
              aria-label={`${dayLabel(d)}${c === 'missing' ? ', plan missing' : c === 'done' ? ', plan sent' : ''}`}>
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <p className="muted small lp-cal-key"><span className="lp-key lp-done" /> plan sent <span className="lp-key lp-missing" /> register marked, no plan</p>
    </div>
  );
}

/* ------------------------------------------------------------------ the principal */

const WEEKS_SHOWN = 6; // four weeks back, this week and next week

function PrincipalView({ orgId, onCoursesChanged }: { orgId: string; onCoursesChanged: () => void }) {
  const toast = useToast();
  const last = addDays(mondayOf(today()), 7);
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(last, -7 * (WEEKS_SHOWN - 1 - i)));
  const [roster, setRoster] = useState<LessonRoster | null>(null);
  const load = useCallback(() => { lessonRoster(orgId, weeks[0]!).then(setRoster).catch((err) => { setRoster({ teachers: [], manual: [], programmes: [] }); toast.show(friendlyError(err)); }); }, [orgId, weeks[0], toast]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const { rows } = useLiveQuery<Plan>(() => query(collection(db, 'organizations', orgId, 'tutorFiles'), where('day', '>=', weeks[0]!)), [orgId, weeks[0]]);
  const plans = rows.filter(isLessonPlan);
  const { rows: uploads } = useLiveQuery<Plan>(() => query(collection(db, 'organizations', orgId, 'tutorFiles'), where('kind', '==', 'upload')), [orgId]);
  const asks = uploads.filter((p) => p.reopenRequest);
  const courseFiles = uploads.filter((p) => !isLessonPlan(p) && hasPlan(p));
  const [cell, setCell] = useState<{ uid: string; week: string } | null>(null);
  const [zipping, setZipping] = useState('');
  const waiting = [...plans, ...courseFiles].filter((p) => p.status === 'sent' && hasPlan(p)).length;
  const teachers = roster?.teachers ?? null;

  async function zip(week: string) {
    const list = plans.filter((p) => p.day >= week && p.day <= addDays(week, 6) && hasPlan(p));
    if (!list.length) return toast.show('No lesson plans for that week yet.');
    setZipping(week);
    try {
      await downloadWeekZip(orgId, `Lesson plans ${weekRange(week)}.zip`, list.map((p) => ({ fileId: p.id, tutorName: p.tutorName, title: `${p.day} ${p.title}`, files: p.files ?? [] })),
        (d, of) => setZipping(`${week}:${d}/${of}`));
    } catch (err) { toast.show(friendlyError(err)); }
    setZipping('');
  }

  const selTeacher = cell && teachers?.find((t) => t.uid === cell.uid);
  return (<>
    <section className="card lp-grid-card">
      <div className="tf-head">
        <div>
          <h2>All teachers</h2>
          <p className="muted small">{waiting ? `${waiting} ${waiting === 1 ? 'upload is' : 'uploads are'} waiting for you to approve.` : 'Tap a box to see the plans.'}</p>
        </div>
        <Link to="/tutor-files" className="btn btn-small btn-quiet">Tutor Files</Link>
      </div>
      {asks.map((f) => <ReopenAsk key={f.id} orgId={orgId} file={f} />)}
      {teachers === null ? <p className="muted">Loading…</p> : teachers.length === 0 ? <p className="muted">No teachers yet.</p> : (
        <div className="table-wrap">
          <table className="lp-grid">
            <thead>
              <tr>
                <th>Teacher</th>
                {weeks.map((w) => {
                  const n = plans.filter((p) => p.day >= w && p.day <= addDays(w, 6) && hasPlan(p)).length;
                  const z = zipping.startsWith(w) ? zipping.split(':')[1] ?? '…' : '';
                  return (
                    <th key={w} className={w === mondayOf(today()) ? 'lp-now' : ''}>
                      <span>{w === last ? 'Next week' : w === mondayOf(today()) ? 'This week' : weekRange(w)}</span>
                      <button type="button" className="lp-zip" disabled={!!zipping || !n} title="Download all" onClick={() => void zip(w)}>{z ? `⏳ ${z}` : `⬇ All${n ? ` (${n})` : ''}`}</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const theirs = plans.filter((p) => p.tutorUid === t.uid);
                return (
                  <tr key={t.uid}>
                    <th scope="row">{t.name}<span className="muted small lp-ncourses">{t.courses.length} {t.courses.length === 1 ? 'course' : 'courses'}</span></th>
                    {weeks.map((w) => {
                      const b = weekBox(w, t.lessons, t.courses, theirs);
                      const picked = cell?.uid === t.uid && cell.week === w;
                      const state = b.of ? (b.done === b.of ? 'all' : b.done ? 'some' : 'none') : b.extra ? 'all' : 'empty';
                      return (
                        <td key={w}>
                          <button type="button" className={`lp-cell lp-${state}${picked ? ' lp-picked' : ''}`} onClick={() => setCell(picked ? null : { uid: t.uid, week: w })}
                            aria-label={`${t.name}, ${weekRange(w)}: ${b.done} of ${b.of} lessons with plans`}>
                            {b.of ? `${b.done} of ${b.of}` : b.extra ? `✓ ${b.extra}` : '–'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Each box: lessons with a plan, of the lessons whose register was marked that week. Green = all, amber = some, red = none. Tap a box to open, approve or send back.</p>
      {cell && selTeacher && <CellDetail orgId={orgId} teacher={selTeacher} week={cell.week} plans={plans.filter((p) => p.tutorUid === cell.uid)} files={courseFiles.filter((p) => p.tutorUid === cell.uid)} />}
    </section>
    {roster && <CoursesAndTutors orgId={orgId} roster={roster} onChanged={() => { load(); onCoursesChanged(); }} />}
  </>);
}

function CellDetail({ orgId, teacher: t, week, plans, files }: { orgId: string; teacher: LessonTeacher; week: string; plans: Plan[]; files: Plan[] }) {
  const sunday = addDays(week, 6);
  const lessons = t.lessons.filter((l) => l.date >= week && l.date <= sunday).sort((a, b) => a.date.localeCompare(b.date));
  const weekPlans = plans.filter((p) => p.day >= week && p.day <= sunday && hasPlan(p)).sort((a, b) => a.day.localeCompare(b.day));
  const missing = lessons.filter((l) => !lessonCovered(l, t.courses, plans));
  const nudge = `Hello ${t.name.split(' ')[0]}, please upload your lesson plan for ${missing.map((l) => `${dayLabel(l.date)} (${l.registerName})`).join(', ')} in Insight-IQ: tap "Upload lesson plan" on Today, then the red day. Thank you.`;
  return (
    <div className="lp-detail">
      <h3>{t.name} · {weekRange(week)}</h3>
      {lessons.length === 0 && weekPlans.length === 0 && <p className="muted small">No registers marked and no plans this week.</p>}
      {missing.map((l) => (
        <div key={`${l.date}${l.registerName}`} className="tf-tutor lp-course">
          <div className="tf-tutor-main"><strong>{dayLabel(l.date)} · {l.registerName}</strong><span className="tf-chip tf-late">No plan</span></div>
        </div>
      ))}
      {weekPlans.map((p) => <CoursePlan key={p.id} orgId={orgId} label={`${dayLabel(p.day)} · ${p.title}`} plan={p} />)}
      {missing.length > 0 && t.phone && (
        <a className="btn btn-small btn-quiet align-start" href={`https://wa.me/${t.phone.replace(/\D/g, '')}?text=${encodeURIComponent(nudge)}`} target="_blank" rel="noopener noreferrer">Remind on WhatsApp</a>
      )}
      {files.length > 0 && (
        <details className="fold">
          <summary>Other files from {t.name.split(' ')[0]} ({files.length})</summary>
          {files.map((p) => <CoursePlan key={p.id} orgId={orgId} label={`${DOC_TYPE_LABELS[(p.docType ?? 'lesson') as DocType] ?? 'File'} · ${p.title}`} plan={p} />)}
        </details>
      )}
    </div>
  );
}

function CoursePlan({ orgId, label, plan: p }: { orgId: string; label: string; plan: Plan }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [backing, setBacking] = useState(false);
  const [note, setNote] = useState('');
  const run = async (key: string, job: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  };
  const chip = p.status === 'approved' ? { t: 'Approved', c: 'done' } : p.status === 'returned' ? { t: 'Sent back', c: 'ask' } : { t: 'Waiting', c: 'ok' };
  return (
    <div className="tf-tutor lp-course">
      <div className="tf-tutor-main">
        <strong>{label}</strong>
        <span className={`tf-chip tf-${chip.c}`}>{chip.t}</span>
        <span className="muted small">sent {formatDateKey(p.sentOn)}</span>
      </div>
      <div className="tf-tutor-ctl">
        {(p.files ?? []).map((f) => (
          <button key={f.id} type="button" className="btn btn-small" disabled={!!busy} onClick={() => run(f.id, () => downloadLessonFile(orgId, p.id, f))}>{busy === f.id ? 'Opening…' : `📄 ${f.name}`}</button>
        ))}
        {p.status === 'sent' && <button type="button" className="btn btn-small btn-primary" disabled={!!busy} onClick={() => run('a', () => approveFile(orgId, p.id), `Approved ${p.tutorName}'s ${label}.`)}>Approve</button>}
        {p.status !== 'returned' && !backing && <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(true)}>Send back</button>}
      </div>
      {p.status === 'returned' && p.returnNote && <p className="tf-note small">“{p.returnNote}”</p>}
      {backing && (
        <div className="tf-ask">
          <input value={note} maxLength={500} placeholder="What should they change?" onChange={(e) => setNote(e.target.value)} autoFocus />
          <button type="button" className="btn btn-small btn-primary" disabled={!!busy || !note.trim()} onClick={() => run('b', () => sendBackFile(orgId, p.id, note), `Sent back to ${p.tutorName}.`).then(() => { setBacking(false); setNote(''); })}>Send back</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/**
 * Courses and tutors (6A, 7B). Courses from Exam Records show as they are (change them there). The principal adds
 * any other course here, for a department or as a common course, with its one tutor; it reaches the tutor's
 * dropdown at once.
 */
function CoursesAndTutors({ orgId, roster, onChanged }: { orgId: string; roster: LessonRoster; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', department: 'common', cohort: '', tutorUid: '' });
  const fromExams = roster.teachers.flatMap((t) => t.courses.filter((c) => c.key.startsWith('c-')).map((c) => ({ ...c, tutor: t.name })))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const manual = [...roster.manual].sort((a, b) => a.name.localeCompare(b.name));
  const dept = (id: string) => (id === 'common' ? 'Common course' : roster.programmes.find((p) => p.id === id)?.name ?? 'Department');

  async function run(job: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await job(); toast.show(done); onChanged(); } catch (err) { toast.show(friendlyError(err)); }
    setBusy(false);
  }
  function add() {
    if (!form.name.trim()) return toast.show('Type the course name.');
    if (!form.tutorUid) return toast.show('Pick the tutor.');
    void run(() => saveCourse(orgId, form), `${form.name.trim()} added. It is in the tutor's list now.`).then(() => { setAdding(false); setForm({ name: '', department: 'common', cohort: '', tutorUid: '' }); });
  }

  return (
    <details className="card fold lp-courses">
      <summary>Courses and tutors ({fromExams.length + manual.length})</summary>
      <p className="muted small">Each course has one tutor. Courses from Exam Records change there. Add any other course here and it reaches the tutor straight away.</p>
      <ul className="lp-files">
        {manual.map((m) => (
          <li key={m.id}>
            <span className="lp-file-name"><b>{m.name}{m.cohort ? ` · ${m.cohort}` : ''}</b><span className="muted small"> · {dept(m.department)}</span></span>
            <span className="lp-file-ctl">
              <select value={m.tutorUid} disabled={busy} aria-label={`Tutor for ${m.name}`} onChange={(e) => void run(() => saveCourse(orgId, { id: m.id, name: m.name, cohort: m.cohort ?? '', department: m.department, tutorUid: e.target.value }), `${m.name} now has a new tutor.`)}>
                {!roster.teachers.some((t) => t.uid === m.tutorUid) && <option value={m.tutorUid}>{m.tutorName}</option>}
                {roster.teachers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
              <button type="button" className="btn btn-small btn-quiet danger-text" disabled={busy} onClick={() => void run(() => removeCourse(orgId, m.id), `${m.name} removed. Plans already sent are kept.`)}>Remove</button>
            </span>
          </li>
        ))}
        {fromExams.map((c) => (
          <li key={`${c.key}${c.tutor}`}><span className="lp-file-name"><b>{c.label}</b><span className="muted small"> · {c.tutor}</span></span><span className="muted small">Exam Records</span></li>
        ))}
      </ul>
      {adding ? (
        <div className="lp-add">
          <label className="field"><span>Course name</span><input value={form.name} maxLength={80} placeholder="For example Entrepreneurship" autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Department</span>
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="common">Common course (every student)</option>
              {roster.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Cohort (optional)</span><input value={form.cohort} maxLength={40} placeholder="For example Cohort 4" onChange={(e) => setForm({ ...form, cohort: e.target.value })} /></label>
          <label className="field"><span>Tutor</span>
            <select value={form.tutorUid} onChange={(e) => setForm({ ...form, tutorUid: e.target.value })}>
              <option value="">Pick the tutor</option>
              {roster.teachers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
            </select>
          </label>
          <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>Add course</button>
            <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : <button type="button" className="btn lp-gold align-start" onClick={() => setAdding(true)}>+ Add a course</button>}
    </details>
  );
}
