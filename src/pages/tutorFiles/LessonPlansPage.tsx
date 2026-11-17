import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useLiveDoc, useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { approveFile, askToChange, sendBackFile } from '../../lib/tutorFiles';
import { checkFile, downloadLessonFile, downloadWeekZip, lessonRoster, myCourses, removeLessonFile, uploadLessonFile, type LessonTeacher } from '../../lib/lessonPlans';
import { isInventoryManager, TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { addDays, mondayOf } from '../../../functions/src/shared/metrics';
import {
  canChangeWeek, cellState, hasPlan, LESSON_ACCEPT, LESSON_MAX_FILES, LESSON_TYPES_TEXT, weekChoices, weekFileId, weekRange, type TeachingCourse,
} from '../../../functions/src/shared/lessonPlans';
import type { TutorFile } from '../../../functions/src/shared/tutorFiles';
import { ReopenAsk } from './TutorFilesPage';
import { PoweredBy } from '../../components/PoweredBy';

type Plan = TutorFile & { id: string };
const today = () => localDateKey(new Date());
const nextMonday = () => addDays(mondayOf(today()), 7);
const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Weekly lesson plans at ADIA (Andy, 2026-11-17, 1A-9A). Teachers upload; the principal checks. */
export function LessonPlansPage() {
  const { profile, can } = useAuth();
  const { current } = useOrg();
  const toast = useToast();
  const orgId = current?.type === 'college' ? current.id : '';
  const manager = (!!profile && isInventoryManager(profile)) || can('exams.manage');
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const [courses, setCourses] = useState<TeachingCourse[] | null>(null);
  useEffect(() => {
    if (!orgId) return;
    myCourses(orgId).then(setCourses).catch((err) => { setCourses([]); toast.show(friendlyError(err)); });
  }, [orgId, toast]);
  if (!orgId) return <div className="page narrow"><p>Lesson plans are part of ADIA Training Centre.</p></div>;
  const teaches = (courses?.length ?? 0) > 0;
  return (
    <div className={`page lp-page${manager ? '' : ' narrow'}`}>
      <h1>Lesson plans</h1>
      {courses === null && <p className="muted">Loading your courses…</p>}
      {courses && teaches && <UploadCard orgId={orgId} courses={courses} />}
      {courses && !teaches && (trainer || !manager) && (
        <section className="card"><p>You have no courses yet. Ask the principal to give you your courses in Exam Records, then come back here.</p></section>
      )}
      {manager && <PrincipalGrid orgId={orgId} />}
      <PoweredBy />
    </div>
  );
}

/* ------------------------------------------------------------------ the teacher */

function UploadCard({ orgId, courses }: { orgId: string; courses: TeachingCourse[] }) {
  const { profile } = useAuth();
  const toast = useToast();
  const uid = profile?.uid ?? '';
  const weeks = useMemo(() => weekChoices(today()), []);
  const [courseKey, setCourseKey] = useState(courses[0]!.key);
  const [week, setWeek] = useState(nextMonday());
  const course = courses.find((c) => c.key === courseKey) ?? courses[0]!;
  const fileId = weekFileId(course.key, week, uid);
  const { data } = useLiveDoc<TutorFile>(() => (uid ? doc(db, 'organizations', orgId, 'tutorFiles', fileId) : null), [orgId, fileId, uid]);
  const plan = data ? { ...data, id: fileId } : null;
  const { rows: mine } = useLiveQuery<Plan>(() => (uid ? query(collection(db, 'organizations', orgId, 'tutorFiles'), where('tutorUid', '==', uid)) : null), [orgId, uid]);
  const recent = mine.filter((p) => p.kind === 'week' && hasPlan(p)).sort((a, b) => b.day.localeCompare(a.day) || a.title.localeCompare(b.title)).slice(0, 8);

  const [uploads, setUploads] = useState<{ name: string; p: number }[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const now = today();
  const open = canChangeWeek(plan, now);
  const count = plan?.files?.length ?? 0;

  async function send(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (pick.current) pick.current.value = '';
    if (camera.current) camera.current.value = '';
    if (!files.length) return;
    if (!open) return toast.show('This plan is approved and locked. Tap "Ask to change" first.');
    const room = LESSON_MAX_FILES - count;
    if (files.length > room) return toast.show(`A plan holds up to ${LESSON_MAX_FILES} files. You can add ${room} more.`);
    const bad = files.map(checkFile).find(Boolean);
    if (bad) return toast.show(bad);
    setUploads(files.map((f) => ({ name: f.name, p: 0 })));
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadLessonFile(orgId, course.key, week, files[i]!, (p) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, p } : x))));
        ok++;
      } catch (err) { toast.show(`${files[i]!.name}: ${friendlyError(err)}`); }
    }
    setUploads([]);
    if (ok) toast.show(`Well done! ${ok === 1 ? 'Your lesson plan is' : `${ok} files are`} uploaded. The principal can see ${ok === 1 ? 'it' : 'them'} now.`);
  }
  function drop(e: DragEvent) { e.preventDefault(); setOver(false); void send(Array.from(e.dataTransfer.files)); }
  async function run(label: string, job: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  }

  const status = !plan || !count ? { t: 'Not uploaded yet', c: 'muted' }
    : plan.status === 'approved' ? { t: open ? `Opened for changes until ${formatDateKey(plan.reopenUntil)}` : `Approved by ${plan.approvedByName} 🔒`, c: open ? 'ask' : 'done' }
    : plan.status === 'returned' ? { t: 'Sent back to you. Please change it and upload again.', c: 'late' }
    : { t: 'Uploaded ✓ Waiting for the principal', c: 'ok' };

  return (
    <>
      <section className="card lp-upload">
        <div className="lp-pickers">
          <label className="field"><span>Course</span>
            <select value={course.key} onChange={(e) => setCourseKey(e.target.value)}>
              {courses.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Week</span>
            <select value={week} onChange={(e) => setWeek(e.target.value)}>
              {weeks.map((w) => <option key={w.monday} value={w.monday}>{w.label}</option>)}
            </select>
          </label>
        </div>

        <p className={`tf-status tf-${status.c}`}>{status.t}</p>
        {plan?.status === 'returned' && plan.returnNote && <p className="tf-note">“{plan.returnNote}”</p>}

        {count > 0 && (
          <ul className="lp-files">
            {plan!.files!.map((f) => (
              <li key={f.id}>
                <span className="lp-file-name">{f.name}<span className="muted small"> · {sizeText(f.size)}</span></span>
                <span className="lp-file-ctl">
                  <button type="button" className="btn btn-small btn-quiet" disabled={!!busy} onClick={() => run(`d${f.id}`, () => downloadLessonFile(orgId, fileId, f))}>{busy === `d${f.id}` ? 'Opening…' : 'Open'}</button>
                  {open && <button type="button" className="btn btn-small btn-quiet danger-text" disabled={!!busy} onClick={() => run(`r${f.id}`, () => removeLessonFile(orgId, fileId, f.id), `${f.name} removed.`)}>Remove</button>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div
            className={`lp-drop${over ? ' lp-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
          >
            <input ref={pick} type="file" hidden multiple accept={LESSON_ACCEPT} onChange={(e) => void send(e.target.files)} />
            <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void send(e.target.files)} />
            {uploads.length > 0 ? (
              <div className="lp-progress">
                {uploads.map((u, i) => (
                  <div key={i}><span className="small">{u.name}</span><progress value={u.p} max={1} /></div>
                ))}
              </div>
            ) : (<>
              <button type="button" className="btn lp-gold" onClick={() => pick.current?.click()}>{count ? 'Add more files' : 'Choose files'}</button>
              <button type="button" className="btn" onClick={() => camera.current?.click()}>Take a photo</button>
              <p className="muted small">{LESSON_TYPES_TEXT}. Up to 20 MB each, several at once. On a computer you can drag files here.</p>
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

      {recent.length > 0 && (
        <details className="card fold">
          <summary>My recent lesson plans ({recent.length})</summary>
          <ul className="lp-recent">
            {recent.map((p) => (
              <li key={p.id}>
                <button type="button" className="link-button-inline" onClick={() => { if (courses.some((c) => c.key === p.courseKey)) setCourseKey(p.courseKey!); if (weeks.some((w) => w.monday === p.day)) setWeek(p.day); }}>
                  {p.title} · {weekRange(p.day)}
                </button>
                <span className={`tf-chip tf-${p.status === 'approved' ? 'done' : p.status === 'returned' ? 'late' : 'ok'}`}>{p.status === 'approved' ? 'Approved' : p.status === 'returned' ? 'Sent back' : 'Waiting'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the principal */

const WEEKS_SHOWN = 6; // four weeks back, this week and next week

function PrincipalGrid({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [teachers, setTeachers] = useState<LessonTeacher[] | null>(null);
  useEffect(() => { lessonRoster(orgId).then(setTeachers).catch((err) => { setTeachers([]); toast.show(friendlyError(err)); }); }, [orgId, toast]);
  const last = nextMonday();
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(last, -7 * (WEEKS_SHOWN - 1 - i)));
  const { rows } = useLiveQuery<Plan>(() => query(collection(db, 'organizations', orgId, 'tutorFiles'), where('day', '>=', weeks[0]!)), [orgId, weeks[0]]);
  const plans = rows.filter((p) => p.kind === 'week');
  const { rows: asked } = useLiveQuery<Plan>(() => query(collection(db, 'organizations', orgId, 'tutorFiles'), where('kind', '==', 'week')), [orgId]);
  const asks = asked.filter((p) => p.reopenRequest);
  const [cell, setCell] = useState<{ uid: string; week: string } | null>(null);
  const [zipping, setZipping] = useState('');
  const waiting = plans.filter((p) => p.status === 'sent' && hasPlan(p)).length;

  async function zip(week: string) {
    const list = plans.filter((p) => p.day === week && hasPlan(p));
    if (!list.length) return toast.show('No lesson plans for that week yet.');
    setZipping(week);
    try {
      await downloadWeekZip(orgId, `Lesson plans ${weekRange(week)}.zip`, list.map((p) => ({ fileId: p.id, tutorName: p.tutorName, title: p.title, files: p.files ?? [] })),
        (d, of) => setZipping(`${week}:${d}/${of}`));
    } catch (err) { toast.show(friendlyError(err)); }
    setZipping('');
  }

  const selTeacher = cell && teachers?.find((t) => t.uid === cell.uid);
  return (
    <section className="card lp-grid-card">
      <div className="tf-head">
        <div>
          <h2>All teachers</h2>
          <p className="muted small">{waiting ? `${waiting} ${waiting === 1 ? 'plan is' : 'plans are'} waiting for you to approve.` : 'Tap a box to see the plans.'}</p>
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
                  const n = plans.filter((p) => p.day === w && hasPlan(p)).length;
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
              {teachers.map((t) => (
                <tr key={t.uid}>
                  <th scope="row">{t.name}<span className="muted small lp-ncourses">{t.courses.length} {t.courses.length === 1 ? 'course' : 'courses'}</span></th>
                  {weeks.map((w) => {
                    const mine = plans.filter((p) => p.tutorUid === t.uid && p.day === w).map((p) => ({ ...p, courseKey: p.courseKey ?? '' }));
                    const s = cellState(t.courses.map((c) => c.key), mine);
                    const picked = cell?.uid === t.uid && cell.week === w;
                    const approved = s.state === 'all' && mine.filter(hasPlan).every((p) => p.status === 'approved');
                    return (
                      <td key={w}>
                        <button type="button" className={`lp-cell lp-${s.state}${approved ? ' lp-approved' : ''}${picked ? ' lp-picked' : ''}`} onClick={() => setCell(picked ? null : { uid: t.uid, week: w })}
                          aria-label={`${t.name}, ${weekRange(w)}: ${s.done} of ${s.of}`}>
                          {s.state === 'all' ? (approved ? '✓✓' : '✓') : s.state === 'some' ? `${s.done}/${s.of}` : <span className="tf-dot" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">✓ uploaded · ✓✓ approved · 1/3 some courses · red dot none yet. Tap a box to open, approve or send back.</p>
      {cell && selTeacher && <CellDetail orgId={orgId} teacher={selTeacher} week={cell.week} plans={plans.filter((p) => p.tutorUid === cell.uid && p.day === cell.week)} />}
    </section>
  );
}

function CellDetail({ orgId, teacher: t, week, plans }: { orgId: string; teacher: LessonTeacher; week: string; plans: Plan[] }) {
  const missing = t.courses.filter((c) => !plans.some((p) => p.courseKey === c.key && hasPlan(p)));
  const nudge = `Hello ${t.name.split(' ')[0]}, please upload your lesson plan for ${weekRange(week)} (${missing.map((c) => c.label).join(', ')}) in Insight-IQ: tap "Upload lesson plan" on Today. Thank you.`;
  return (
    <div className="lp-detail">
      <h3>{t.name} · {weekRange(week)}</h3>
      {t.courses.map((c) => {
        const p = plans.find((x) => x.courseKey === c.key && hasPlan(x));
        return <CoursePlan key={c.key} orgId={orgId} label={c.label} plan={p} />;
      })}
      {/* Plans for a course the teacher no longer has still show. */}
      {plans.filter((p) => hasPlan(p) && !t.courses.some((c) => c.key === p.courseKey)).map((p) => <CoursePlan key={p.id} orgId={orgId} label={p.title} plan={p} />)}
      {missing.length > 0 && t.phone && (
        <a className="btn btn-small btn-quiet align-start" href={`https://wa.me/${t.phone.replace(/\D/g, '')}?text=${encodeURIComponent(nudge)}`} target="_blank" rel="noopener noreferrer">Remind on WhatsApp</a>
      )}
    </div>
  );
}

function CoursePlan({ orgId, label, plan: p }: { orgId: string; label: string; plan?: Plan }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [backing, setBacking] = useState(false);
  const [note, setNote] = useState('');
  const run = async (key: string, job: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); }
    setBusy('');
  };
  const chip = !p ? { t: 'Not uploaded', c: 'late' } : p.status === 'approved' ? { t: 'Approved', c: 'done' } : p.status === 'returned' ? { t: 'Sent back', c: 'ask' } : { t: p.late ? 'Uploaded late' : 'Uploaded', c: 'ok' };
  return (
    <div className="tf-tutor lp-course">
      <div className="tf-tutor-main">
        <strong>{label}</strong>
        <span className={`tf-chip tf-${chip.c}`}>{chip.t}</span>
        {p && <span className="muted small">{formatDateKey(p.sentOn)}</span>}
      </div>
      {p && (
        <div className="tf-tutor-ctl">
          {(p.files ?? []).map((f) => (
            <button key={f.id} type="button" className="btn btn-small" disabled={!!busy} onClick={() => run(f.id, () => downloadLessonFile(orgId, p.id, f))}>{busy === f.id ? 'Opening…' : `📄 ${f.name}`}</button>
          ))}
          {p.status === 'sent' && <button type="button" className="btn btn-small btn-primary" disabled={!!busy} onClick={() => run('a', () => approveFile(orgId, p.id), `Approved ${p.tutorName}'s plan.`)}>Approve</button>}
          {p.status !== 'returned' && !backing && <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(true)}>Send back</button>}
        </div>
      )}
      {p?.status === 'returned' && p.returnNote && <p className="tf-note small">“{p.returnNote}”</p>}
      {backing && p && (
        <div className="tf-ask">
          <input value={note} maxLength={500} placeholder="What should they change?" onChange={(e) => setNote(e.target.value)} autoFocus />
          <button type="button" className="btn btn-small btn-primary" disabled={!!busy || !note.trim()} onClick={() => run('b', () => sendBackFile(orgId, p.id, note), `Sent back to ${p.tutorName}.`).then(() => { setBacking(false); setNote(''); })}>Send back</button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setBacking(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
