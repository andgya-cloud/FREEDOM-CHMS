import { Fragment, useEffect, useMemo, useState } from 'react';
import { AdiaDate } from '../../components/AdiaDate';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useExamCohorts } from '../../state/useExams';
import {
  useClassTimetables, useExamTimetables, useRooms, useTimetableKeeper, useTimetableOptions,
  type ClassTimetableRow, type TimetableCourse,
} from '../../state/useTimetables';
import { publishTimetable, saveClassSlot, saveClassTimetable, saveExamRows, saveRooms, startClassTimetable, startExamTimetable } from '../../lib/timetableWrites';
import { classTimetablePdf, classTimetableWorkbook, examTimetablePdf, examTimetableWorkbook, type ExamLine } from '../../lib/timetableReport';
import { downloadFile } from '../../lib/givingPdf';
import { printFile } from '../../lib/printFile';
import { orderCohorts, cohortLabel } from '../../../functions/src/shared/examCohorts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import {
  DAY_NAMES, DAY_SHORT, EXAM_PAPERS, EXAM_PAPER_LABELS, classClashes, classTimetableId, cleanRoom, clock, examClashes, examPeriodName, examTimetableId,
  parseSlotKey, periodProblem, periodText, slotKey, sortExamRows,
  TIMETABLE_COMMON_COURSES, commonCourseOf, commonDeptId, commonDeptName, courseOptionValue, isStandInSheet, withCommonCourses,
  type ClassSlot, type ClassTimetable, type ExamPaper, type ExamRow, type Period,
} from '../../../functions/src/shared/timetable';
import { SchoolGate, SchoolTitle, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function TimetablePage() {
  return <SchoolGate title="Timetables">{(org) => <TimetableScreen org={org} />}</SchoolGate>;
}

type Tab = 'class' | 'exam';

/** School › Timetables (Andy, 2026-11-20, 2A): the same two boards as in Exam Records, for every ADIA account. */
function TimetableScreen({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'exam' ? 'exam' : 'class';
  const { byName: classes } = useExamCohorts(org.id);
  const order = orderCohorts([...new Set(s.intakes.map((i) => i.name))], s.intakes, classes);
  const names = [...order.current, ...order.past].map((c) => c.name);
  const picked = params.get('cohort') ?? '';
  const cohort = names.includes(picked) ? picked : names[0] ?? '';
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <div className="page timetables">
      {can('people.read') ? <SchoolTitle feesAllowed={s.feesAllowed} /> : <div className="page-head"><h1>Timetables</h1></div>}
      <div className="segmented exam-tabs" role="tablist" aria-label="Timetables">
        <button type="button" role="tab" aria-selected={tab === 'class'} className={tab === 'class' ? 'on' : ''} onClick={() => set('tab', '')}>Class timetable</button>
        <button type="button" role="tab" aria-selected={tab === 'exam'} className={tab === 'exam' ? 'on' : ''} onClick={() => set('tab', 'exam')}>Exam timetable</button>
      </div>
      <div className="field-row tt-pickers">
        <label className="field"><span>Cohort</span>
          <select value={cohort} onChange={(e) => set('cohort', e.target.value)}>
            {order.current.length > 0 && <optgroup label="Current">{order.current.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
            {order.past.length > 0 && <optgroup label="Past cohorts">{order.past.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
          </select>
        </label>
      </div>
      {!cohort ? <p className="muted">No cohorts yet.</p> : tab === 'exam' ? <ExamBoard org={org} cohort={cohort} /> : <ClassBoard org={org} cohort={cohort} />}
    </div>
  );
}

/** The cohort's departments, from its intakes. */
function useDepartments(s: ReturnType<typeof useSchoolPage>, cohort: string) {
  return useMemo(() => [...new Set(s.intakes.filter((i) => i.name === cohort).map((i) => i.courseId))]
    .map((id) => ({ id, name: s.courseName(id) || 'Department' })).sort((a, b) => a.name.localeCompare(b.name)), [s.intakes, s.courses, cohort]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The seven common courses, under the departments in the Department dropdowns (Andy, 2026-11-20). */
const COMMON_DEPTS = TIMETABLE_COMMON_COURSES.map((name) => ({ id: commonDeptId(name), name }));
function DeptOptions({ depts }: { depts: { id: string; name: string }[] }) {
  return (
    <>
      {depts.length > 0 && <optgroup label="Departments">{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
      <optgroup label="Common courses">{COMMON_DEPTS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
    </>
  );
}
/** A stand-in for a common course with no marks sheet yet is saved with no sheet. */
const realSheet = (sheetId: string) => (isStandInSheet(sheetId) ? null : sheetId);

const statusText = (t: { published: boolean; publishedOn: string | null; changedOn: string | null } | undefined) =>
  !t ? '' : t.published ? `Published${t.publishedOn ? ` ${formatDateKey(t.publishedOn)}` : ''}${t.changedOn ? ` · Updated ${formatDateKey(t.changedOn)}` : ''}` : 'Draft · only the timetable keepers see it';

function StatusPill({ t }: { t: { published: boolean; publishedOn: string | null; changedOn: string | null } }) {
  return <span className={`badge ${t.published ? 'badge-regular' : 'badge-visitor'}`}>{statusText(t)}</span>;
}

function Downloads({ make }: { make: (kind: 'print' | 'xlsx' | 'pdf') => Promise<File> }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  async function run(kind: 'print' | 'xlsx' | 'pdf') {
    setBusy(kind);
    try { const f = await make(kind); if (kind === 'print') printFile(f); else downloadFile(f); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  return (
    <div className="row-actions tt-downloads no-print">
      <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('print')}>{busy === 'print' ? 'Opening…' : 'Print'}</button>
      <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
      <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
    </div>
  );
}

// ---- Class timetable ---------------------------------------------------------------------------

/** Periods kept in time order; the boxes move with their period. */
function reorder(periods: Period[], slots: Record<string, ClassSlot>, drop?: number) {
  const idx = periods.map((p, i) => ({ p, i })).filter(({ i }) => i !== drop).sort((a, b) => a.p.start.localeCompare(b.p.start));
  const map = new Map(idx.map(({ i }, n) => [i, n]));
  const out: Record<string, ClassSlot> = {};
  for (const [k, v] of Object.entries(slots)) {
    const { day, period } = parseSlotKey(k);
    const n = map.get(period);
    if (n != null) out[slotKey(day, n)] = v;
  }
  return { periods: idx.map(({ p }) => p), slots: out };
}

/**
 * The class timetable (Andy, 2026-11-20, 4A-6A 9A-13A): a weekly grid for each cohort, semester and department.
 * A box holds a course (its lecturer comes with it) and a room; clashes are warned, never blocked.
 */
export function ClassBoard({ org, cohort }: { org: Organization; cohort: string }) {
  const s = useSchoolPage(org);
  const { user } = useAuth();
  const toast = useToast();
  const keeper = useTimetableKeeper();
  const { rows: all, loading } = useClassTimetables(org.id);
  const depts = useDepartments(s, cohort);
  const [sem, setSem] = useState<1 | 2>(1);
  const [dept, setDept] = useState('');
  const dep = depts.some((d) => d.id === dept) || commonDeptName(dept) ? dept : (depts[0] ?? COMMON_DEPTS[0])!.id;
  const common = commonDeptName(dep);
  const depName = common ?? depts.find((d) => d.id === dep)?.name ?? '';
  const id = classTimetableId(cohort, sem, dep);
  const t = all.find((x) => x.id === id);
  const named = useMemo(() => all.map((x) => ({ ...x, departmentName: commonDeptName(x.courseId) ?? (s.courseName(x.courseId) || 'Department') })), [all, s.courses]); // eslint-disable-line react-hooks/exhaustive-deps
  const clashes = t && keeper ? classClashes({ ...t, departmentName: depName }, named) : {};
  const { options, error } = useTimetableOptions(org.id, cohort, keeper);
  const { rooms, exists } = useRooms(org.id);
  const [open, setOpen] = useState('');
  useEffect(() => setOpen(''), [id]);
  const courses = withCommonCourses((options?.courses ?? []).filter((c) => c.semester == null || c.semester === sem), options?.staff ?? [])
    .filter((c) => (common ? c.courseId == null && commonCourseOf(c.name) === common : c.courseId == null || c.courseId === dep));
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const days = t?.saturday ? 6 : 5;

  function start() {
    startClassTimetable(org.id, id, { cohort, semester: sem, courseId: dep }).catch(fail);
    toast.show('Timetable started. Click a box to add a class.');
  }
  /** 10A: the nearest earlier grid for this department, with the lecturers brought up to date. */
  function copyLast() {
    const from = all.filter((x) => x.id !== id && x.courseId === dep && Object.keys(x.slots).length > 0)
      .sort((a, b) => Number(b.cohort === cohort) - Number(a.cohort === cohort) || (b.to ?? '').localeCompare(a.to ?? '') || b.cohort.localeCompare(a.cohort))[0];
    if (!from) { toast.show(`There is no earlier ${depName} timetable to copy yet.`); return; }
    if (t && Object.keys(t.slots).length && !window.confirm(`Replace this timetable with a copy of ${from.cohort} · Semester ${from.semester}?`)) return;
    const byName = new Map(courses.map((c) => [c.name.toLowerCase(), c]));
    const slots = Object.fromEntries(Object.entries(from.slots).map(([k, v]) => {
      const c = byName.get(v.course.toLowerCase());
      return [k, c ? { ...v, sheetId: realSheet(c.sheetId), lecturer: c.lecturer, lecturerUid: c.lecturerUid } : v];
    }));
    const copy = { periods: from.periods, saturday: from.saturday, slots };
    if (t) saveClassTimetable(org.id, t, copy, s.today).catch(fail);
    else startClassTimetable(org.id, id, { cohort, semester: sem, courseId: dep, ...copy }).catch(fail);
    toast.show(`Copied ${from.cohort} · Semester ${from.semester}. Change what's different.`);
  }
  function publish(on: boolean) {
    if (!t) return;
    publishTimetable('class', org.id, t.id, on, s.today).catch(fail);
    toast.show(on ? 'Published. Everyone at ADIA can see it now.' : 'Back to a draft. Only the keepers see it.');
  }
  async function make(kind: 'print' | 'xlsx' | 'pdf') {
    const info = { cohort, department: depName, semester: sem, status: `${statusText(t)}${t?.from || t?.to ? ` · ${t?.from ? formatDateKey(t.from) : '?'} to ${t?.to ? formatDateKey(t.to) : '?'}` : ''}` };
    return kind === 'xlsx' ? classTimetableWorkbook(info, t!) : classTimetablePdf(info, t!);
  }

  const openAt = open ? parseSlotKey(open) : null;
  return (
    <section className="stack tt-board">
      <div className="field-row tt-pickers">
        <label className="field"><span>Semester</span>
          <select value={sem} onChange={(e) => setSem(Number(e.target.value) as 1 | 2)}><option value={1}>Semester 1</option><option value={2}>Semester 2</option></select>
        </label>
        <label className="field"><span>Department</span>
          <select value={dep} onChange={(e) => setDept(e.target.value)}><DeptOptions depts={depts} /></select>
        </label>
      </div>
      {!dep ? <p className="muted">{cohort} has no departments yet.</p> : !t ? (
        <div className="card stack">
          <h2>Class timetable · {cohort} · {depName} · Semester {sem}</h2>
          {loading ? <p className="muted">Loading…</p> : keeper ? (
            <>
              <p className="muted">No timetable yet. Start with ADIA's usual day (8:00 to 4:00 with tea and lunch), or copy an earlier one.</p>
              <div className="row-actions"><button type="button" className="btn btn-primary" onClick={start}>Start the timetable</button><button type="button" className="btn btn-quiet" onClick={copyLast}>Copy from last semester</button></div>
            </>
          ) : <p className="muted">This timetable has not been published yet.</p>}
        </div>
      ) : (
        <>
          {keeper && (
            <div className="tt-status no-print">
              <StatusPill t={t} />
              {!t.published ? <button type="button" className="btn btn-gold btn-small" onClick={() => publish(true)}>Publish</button>
                : <button type="button" className="link-button small" onClick={() => publish(false)}>Take it back to a draft</button>}
              <button type="button" className="btn btn-quiet btn-small" onClick={copyLast}>Copy from last semester</button>
              <label className="tt-check"><input type="checkbox" checked={t.saturday} onChange={(e) => saveClassTimetable(org.id, t, { saturday: e.target.checked }, s.today).catch(fail)} /> Include Saturday</label>
            </div>
          )}
          <div className="card stack">
            <div className="card-head"><h2>Class timetable · {cohort} · {depName} · Semester {sem}</h2></div>
            <p className="muted small">
              {keeper ? 'Click a box to choose the course and the room. The lecturer comes with the course.' : 'Your classes are in gold.'}
              {!keeper && t.changedOn ? ` Updated ${formatDateKey(t.changedOn)}.` : ''}
              {t.from || t.to ? ` Runs ${t.from ? formatDateKey(t.from) : '…'} to ${t.to ? formatDateKey(t.to) : '…'}.` : ''}
            </p>
            {keeper && error && <p className="small up-bad">{error}</p>}
            <div className="table-scroll">
              <table className="tt-grid">
                <thead><tr><th className="tt-time" />{DAY_SHORT.slice(0, days).map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>
                  {t.periods.map((p, i) => p.isBreak ? (
                    <tr key={i} className="tt-break"><td className="tt-time">{periodText(p)}</td><td colSpan={days}>{p.label || 'Break'}</td></tr>
                  ) : (
                    <tr key={i}>
                      <td className="tt-time">{periodText(p)}</td>
                      {Array.from({ length: days }, (_, d) => {
                        const k = slotKey(d, i);
                        const c = t.slots[k];
                        const mine = !!c && !!user && c.lecturerUid === user.uid;
                        const clash = clashes[k];
                        if (!c?.course) return <td key={d}>{keeper ? <button type="button" className={`tt-slot tt-empty${open === k ? ' tt-on' : ''}`} onClick={() => setOpen(open === k ? '' : k)}>+ Add</button> : <div className="tt-slot tt-empty" />}</td>;
                        const body = <><b>{c.course}</b>{c.lecturer && <span>{c.lecturer}</span>}{c.room && <span>{c.room}</span>}{clash && <span className="tt-warn">⚠ Clash</span>}</>;
                        return (
                          <td key={d}>
                            {keeper ? <button type="button" className={`tt-slot${mine ? ' tt-mine' : ''}${clash ? ' tt-clash' : ''}${open === k ? ' tt-on' : ''}`} onClick={() => setOpen(open === k ? '' : k)}>{body}</button>
                              : <div className={`tt-slot${mine ? ' tt-mine' : ''}`}>{body}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {keeper && openAt && t.periods[openAt.period] && (
              <SlotEditor key={`${open}|${options ? 1 : 0}`} title={`${DAY_NAMES[openAt.day]} · ${periodText(t.periods[openAt.period]!)}`} slot={t.slots[open]} courses={courses} typed={!options} rooms={rooms}
                clash={clashes[open]} onClose={() => setOpen('')}
                onSave={(slot) => { saveClassSlot(org.id, t, open, slot, s.today).catch(fail); setOpen(''); toast.show(slot ? 'Saved' : 'Box emptied'); }} />
            )}
            {keeper && <TimetableSettings t={t} today={s.today} onSave={(c) => saveClassTimetable(org.id, t, c, s.today).catch(fail)} />}
            <Downloads make={make} />
          </div>
        </>
      )}
      {keeper && <RoomsCard orgId={org.id} rooms={rooms} exists={exists} />}
    </section>
  );
}

function SlotEditor({ title, slot, courses, typed, rooms, clash, onSave, onClose }: {
  title: string; slot: ClassSlot | undefined; courses: TimetableCourse[]; typed: boolean; rooms: string[]; clash?: string[]; onSave: (s: ClassSlot | null) => void; onClose: () => void;
}) {
  const [sheetId, setSheetId] = useState(slot ? courseOptionValue(slot.sheetId, slot.course) : '');
  const [course, setCourse] = useState(slot?.course ?? '');
  const [lecturer, setLecturer] = useState(slot?.lecturer ?? '');
  const [room, setRoom] = useState(slot?.room ?? '');
  const picked = courses.find((c) => c.sheetId === sheetId);
  const roomList = room && !rooms.includes(room) ? [room, ...rooms] : rooms;
  function save() {
    if (!typed && !sheetId) { onSave(null); return; }
    if (typed && !course.trim()) { onSave(null); return; }
    onSave(typed || !picked
      ? { course: course.trim().slice(0, 120), sheetId: slot?.sheetId ?? null, lecturer: lecturer.trim().slice(0, 120), lecturerUid: slot?.lecturerUid ?? '', room }
      : { course: picked.name.slice(0, 120), sheetId: realSheet(picked.sheetId), lecturer: picked.lecturer.slice(0, 120), lecturerUid: picked.lecturerUid, room });
  }
  return (
    <div className="tt-editor no-print">
      <b>{title}</b>
      <div className="field-row">
        {typed ? (
          <>
            <label className="field"><span>Course</span><input value={course} maxLength={120} onChange={(e) => setCourse(e.target.value)} placeholder="Course name" /></label>
            <label className="field"><span>Lecturer</span><input value={lecturer} maxLength={120} onChange={(e) => setLecturer(e.target.value)} placeholder="Name" /></label>
          </>
        ) : (
          <>
            <label className="field"><span>Course</span>
              <select value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
                <option value="">Free (no class)</option>
                {slot?.sheetId && !courses.some((c) => c.sheetId === slot.sheetId) && <option value={slot.sheetId}>{slot.course}</option>}
                {courses.map((c) => <option key={c.sheetId} value={c.sheetId}>{c.name}{c.courseId == null ? ' (common)' : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>Lecturer</span><input value={picked?.lecturer ?? (sheetId === slot?.sheetId ? slot?.lecturer ?? '' : '')} disabled /></label>
          </>
        )}
        <label className="field"><span>Room</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)}><option value="">No room</option>{roomList.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
      </div>
      {!typed && courses.length === 0 && <p className="small muted">This cohort has no courses for this semester yet. Add them in Exam Records › Setup.</p>}
      {clash?.map((m) => <p key={m} className="small up-bad">⚠ {m}. You can still save it.</p>)}
      <div className="row-actions">
        <button type="button" className="btn btn-primary btn-small" onClick={save}>Save</button>
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** 5A: the day's periods and the semester's dates, folded away. */
function TimetableSettings({ t, today, onSave }: { t: ClassTimetableRow; today: string; onSave: (c: Partial<ClassTimetable>) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Period[]>(t.periods);
  useEffect(() => setDraft(t.periods), [t.periods]);
  function commit(periods: Period[], drop?: number) {
    const bad = periods.map((p) => periodProblem(p)).find(Boolean);
    if (bad) { toast.show(bad); return; }
    const next = reorder(periods, t.slots, drop);
    onSave({ periods: next.periods, slots: next.slots });
  }
  const edit = (i: number, c: Partial<Period>) => setDraft(draft.map((p, n) => (n === i ? { ...p, ...c } : p)));
  return (
    <details className="tt-settings no-print">
      <summary>The day's periods and the semester's dates</summary>
      <div className="stack">
        <div className="field-row">
          <label className="field"><span>Semester starts</span><AdiaDate type="date" value={t.from ?? ''} onChange={(e) => onSave({ from: e.target.value || null })} /></label>
          <label className="field"><span>Semester ends</span><AdiaDate type="date" value={t.to ?? ''} min={t.from ?? undefined} onChange={(e) => onSave({ to: e.target.value || null })} /></label>
        </div>
        <p className="small muted">Lecturers see their classes for today on their Today page while the semester runs{t.from || t.to ? '' : ' (with no dates, always)'}.</p>
        <ul className="tt-periods">
          {draft.map((p, i) => (
            <li key={i}>
              <input type="time" aria-label="Starts" value={p.start} onChange={(e) => edit(i, { start: e.target.value })} onBlur={() => commit(draft)} />
              <span>to</span>
              <input type="time" aria-label="Ends" value={p.end} onChange={(e) => edit(i, { end: e.target.value })} onBlur={() => commit(draft)} />
              <select aria-label="Lesson or break" value={p.isBreak ? 'break' : 'lesson'} onChange={(e) => { const next = draft.map((x, n) => (n === i ? { ...x, isBreak: e.target.value === 'break', label: e.target.value === 'break' ? x.label || 'Break' : '' } : x)); setDraft(next); commit(next); }}>
                <option value="lesson">Lesson</option><option value="break">Break</option>
              </select>
              {p.isBreak && <input aria-label="Break name" value={p.label} maxLength={30} onChange={(e) => edit(i, { label: e.target.value })} onBlur={() => commit(draft)} />}
              <button type="button" className="btn btn-quiet btn-small" aria-label="Remove" disabled={draft.length <= 1}
                onClick={() => { if (Object.keys(t.slots).some((k) => parseSlotKey(k).period === i) && !window.confirm('Remove this period and the classes in it?')) return; commit(draft, i); }}>✕</button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-quiet btn-small align-start" disabled={draft.length >= 12} onClick={() => {
          const last = draft[draft.length - 1];
          const start = last?.end ?? '08:00';
          const h = Math.min(23, Number(start.slice(0, 2)) + 2);
          commit([...draft, { start, end: `${String(h).padStart(2, '0')}:${start.slice(3, 5)}`, label: '', isBreak: false }]);
        }}>+ Add a period</button>
        <p className="small muted">Changes save as you go{t.published ? ` and show "Updated ${formatDateKey(today)}"` : ''}.</p>
      </div>
    </details>
  );
}

/** 14A: the rooms, shared by both timetables. */
function RoomsCard({ orgId, rooms, exists }: { orgId: string; rooms: string[]; exists: boolean }) {
  const toast = useToast();
  const [v, setV] = useState('');
  const save = (next: string[]) => saveRooms(orgId, next, exists).catch((err) => toast.show(friendlyError(err)));
  function add() {
    const r = cleanRoom(v);
    if (!r) return;
    if (rooms.some((x) => x.toLowerCase() === r.toLowerCase())) { toast.show(`${r} is already in the list`); return; }
    save([...rooms, r]);
    setV('');
  }
  return (
    <details className="card fold-card no-print">
      <summary><span>Rooms ({rooms.length})</span></summary>
      <div className="stack">
        <p className="small muted">The rooms both timetables choose from.</p>
        {rooms.length > 0 && <div className="chips">{rooms.map((r) => <span key={r} className="chip">{r} <button type="button" className="link-button" aria-label={`Remove ${r}`} onClick={() => save(rooms.filter((x) => x !== r))}>✕</button></span>)}</div>}
        <div className="field-row tt-room-add">
          <label className="field"><span>New room</span><input value={v} maxLength={40} placeholder="e.g. ICT Lab" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></label>
          <button type="button" className="btn btn-quiet align-end" disabled={!cleanRoom(v)} onClick={add}>Add</button>
        </div>
      </div>
    </details>
  );
}

// ---- Exam timetable ----------------------------------------------------------------------------

const newRowId = () => Math.random().toString(36).slice(2, 10);

/**
 * The exam timetable (Andy, 2026-11-20, 7A-12A): one list for each cohort and exam period, each paper with its
 * date, time, course, department, room and invigilator. Published, it goes on the calendar with a reminder the
 * day before, and its last date becomes that paper's deadline in Exam Records.
 */
export function ExamBoard({ org, cohort }: { org: Organization; cohort: string }) {
  const s = useSchoolPage(org);
  const toast = useToast();
  const keeper = useTimetableKeeper();
  const { rows: all, loading } = useExamTimetables(org.id);
  const lists = all.filter((x) => x.cohort === cohort).sort((a, b) => b.month.localeCompare(a.month) || a.name.localeCompare(b.name));
  const [pick, setPick] = useState('');
  const [making, setMaking] = useState(false);
  const t = lists.find((x) => x.id === pick) ?? lists[0];
  useEffect(() => { setPick(''); setMaking(false); }, [cohort]);
  const depts = useDepartments(s, cohort);
  const [dept, setDept] = useState('');
  const { options, error } = useTimetableOptions(org.id, cohort, keeper);
  const { rooms, exists } = useRooms(org.id);
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const clashes = t && keeper ? examClashes(t, all.filter((x) => x.published)) : {};
  const staff = options?.staff ?? [];
  const courses = withCommonCourses((options?.courses ?? []).filter((c) => !t?.semester || c.semester == null || c.semester === t.semester), staff);
  const deptName = (id: string | null) => commonDeptName(id) ?? (id ? s.courseName(id) || 'Department' : 'All departments');
  const common = commonDeptName(dept);
  const inDept = (r: ExamRow) => !dept || (common ? commonCourseOf(r.course) === common : r.courseId == null || r.courseId === dept);
  const shown = t ? sortExamRows(t.rows).filter(inDept) : [];

  function setRows(rows: ExamRow[]) { if (t) saveExamRows(org.id, t, rows, s.today).catch(fail); }
  const update = (id: string, c: Partial<ExamRow>) => t && setRows(t.rows.map((r) => (r.id === id ? { ...r, ...c } : r)));
  function addRow() {
    if (!t) return;
    const last = sortExamRows(t.rows).pop();
    // Under a common course, the new paper is that course.
    const c = common ? courses.find((x) => x.courseId == null && commonCourseOf(x.name) === common) : undefined;
    setRows([...t.rows, { id: newRowId(), date: last?.date ?? null, start: last?.start ?? '08:00', end: last?.end ?? '10:00', course: c?.name ?? (common || ''), sheetId: c ? realSheet(c.sheetId) : null, courseId: common ? null : dept || null, room: '', invigilator: '', invigilatorUid: '' }]);
  }
  function copyLast() {
    if (!t) return;
    const from = all.filter((x) => x.id !== t.id && x.rows.length > 0)
      .sort((a, b) => Number(b.cohort === cohort) - Number(a.cohort === cohort) || Number(b.paper === t.paper) - Number(a.paper === t.paper) || b.month.localeCompare(a.month))[0];
    if (!from) { toast.show('There is no earlier exam timetable to copy yet.'); return; }
    if (t.rows.length && !window.confirm(`Replace these papers with a copy of ${from.cohort} · ${from.name}?`)) return;
    setRows(from.rows.map((r) => ({ ...r, id: newRowId() })));
    toast.show(`Copied ${from.name}. Change the dates.`);
  }
  function publish(on: boolean) {
    if (!t) return;
    if (on && t.rows.some((r) => !r.date || !r.course)) { toast.show('Give every paper a date and a course first.'); return; }
    publishTimetable('exam', org.id, t.id, on, s.today).catch(fail);
    toast.show(on ? 'Published. The papers go on the calendar, with a reminder the day before.' : 'Back to a draft. The papers come off the calendar.');
  }
  const lines = (): ExamLine[] => sortExamRows(t?.rows ?? []).filter(inDept).map((r) => ({
    date: r.date ? formatDateKey(r.date) : '', time: `${clock(r.start)} – ${clock(r.end)}`, course: r.course, department: deptName(r.courseId), room: r.room, invigilator: r.invigilator,
  }));
  const make = (kind: 'print' | 'xlsx' | 'pdf') => {
    const info = { cohort, name: `${t!.name}${dept ? ` · ${deptName(dept)}` : ''}`, status: statusText(t) };
    return kind === 'xlsx' ? examTimetableWorkbook(info, lines()) : examTimetablePdf(info, lines());
  };

  return (
    <section className="stack tt-board">
      <div className="field-row tt-pickers">
        <label className="field"><span>Exam period</span>
          <select value={making ? '+' : t?.id ?? ''} onChange={(e) => { if (e.target.value === '+') setMaking(true); else { setMaking(false); setPick(e.target.value); } }}>
            {lists.length === 0 && !making && <option value="">None yet</option>}
            {lists.map((x) => <option key={x.id} value={x.id}>{x.name}{keeper && !x.published ? ' (draft)' : ''}</option>)}
            {keeper && <option value="+">+ New exam period…</option>}
          </select>
        </label>
        <label className="field"><span>Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option><DeptOptions depts={depts} /></select>
        </label>
      </div>
      {keeper && (making || (!loading && lists.length === 0)) && (
        <NewExamPeriod today={s.today} onCreate={(paper, semester, month) => {
          const id = examTimetableId(cohort, paper, semester, month);
          if (all.some((x) => x.id === id)) { setPick(id); setMaking(false); toast.show('That exam period is already here.'); return; }
          startExamTimetable(org.id, id, { cohort, paper, semester, month, name: examPeriodName(paper, semester, month), rows: [] }).catch(fail);
          setPick(id);
          setMaking(false);
          toast.show(`${examPeriodName(paper, semester, month)} started. Add the papers.`);
        }} onCancel={lists.length ? () => setMaking(false) : undefined} />
      )}
      {!t ? (!keeper && <p className="muted">No exam timetable for {cohort} has been published yet.</p>) : !making && (
        <>
          {keeper && (
            <div className="tt-status no-print">
              <StatusPill t={t} />
              {!t.published ? <button type="button" className="btn btn-gold btn-small" onClick={() => publish(true)}>Publish</button>
                : <button type="button" className="link-button small" onClick={() => publish(false)}>Take it back to a draft</button>}
              <button type="button" className="btn btn-quiet btn-small" onClick={copyLast}>Copy from last exam period</button>
            </div>
          )}
          <div className="card stack">
            <div className="card-head"><h2>Exam timetable · {cohort} · {t.name}</h2></div>
            <p className="muted small">
              {keeper ? 'Published, each paper goes on the Events calendar with a reminder for everyone the day before' : 'Good luck to every student.'}
              {keeper && (['cat1', 'cat2', 'cat3', 'final'] as ExamPaper[]).includes(t.paper) ? `, and the last date becomes the ${EXAM_PAPER_LABELS[t.paper].replace(/ exams$/, '')} deadline in Exam Records.` : keeper ? '.' : ''}
              {!keeper && t.changedOn ? ` Updated ${formatDateKey(t.changedOn)}.` : ''}
            </p>
            {keeper && error && <p className="small up-bad">{error}</p>}
            {shown.length === 0 ? <p className="muted">{keeper ? 'No papers yet. Add the first one below.' : 'No papers listed yet.'}</p> : (
              <div className="table-scroll">
                <table className="table tt-exams">
                  <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>Department</th><th>Room</th><th>Invigilator</th>{keeper && <th className="no-print" />}</tr></thead>
                  <tbody>
                    {shown.map((r, n) => {
                      const firstOfDay = n === 0 || shown[n - 1]!.date !== r.date;
                      if (!keeper) return (
                        <tr key={r.id} className={firstOfDay ? 'tt-day' : undefined}>
                          <td>{firstOfDay ? (r.date ? formatDateKey(r.date) : '–') : ''}</td><td className="tt-nowrap">{clock(r.start)} – {clock(r.end)}</td><td><b>{r.course}</b></td>
                          <td>{deptName(r.courseId)}</td><td>{r.room || '–'}</td><td>{r.invigilator || '–'}</td>
                        </tr>
                      );
                      const roomList = r.room && !rooms.includes(r.room) ? [r.room, ...rooms] : rooms;
                      return (
                        <Fragment key={r.id}>
                          <tr className={clashes[r.id] ? 'tt-row-clash' : undefined}>
                            <td><AdiaDate type="date" aria-label="Date" value={r.date ?? ''} onChange={(e) => update(r.id, { date: e.target.value || null })} /></td>
                            <td className="tt-nowrap"><input type="time" aria-label="Starts" value={r.start} onChange={(e) => e.target.value && update(r.id, { start: e.target.value })} /> <input type="time" aria-label="Ends" value={r.end} onChange={(e) => e.target.value && update(r.id, { end: e.target.value })} /></td>
                            <td>
                              {options ? (
                                <select aria-label="Course" value={courseOptionValue(r.sheetId, r.course) || (r.course ? `t:${r.course}` : '')} onChange={(e) => {
                                  const c = courses.find((x) => x.sheetId === e.target.value);
                                  if (c) update(r.id, { course: c.name.slice(0, 120), sheetId: realSheet(c.sheetId), courseId: c.courseId });
                                }}>
                                  <option value="" disabled>Choose…</option>
                                  {r.course && !courses.some((c) => c.sheetId === courseOptionValue(r.sheetId, r.course)) && <option value={courseOptionValue(r.sheetId, r.course) || `t:${r.course}`}>{r.course}</option>}
                                  {courses.map((c) => <option key={c.sheetId} value={c.sheetId}>{c.name}{c.courseId ? ` · ${deptName(c.courseId)}` : ' (common)'}</option>)}
                                </select>
                              ) : <TypedCell value={r.course} label="Course" onSave={(v) => update(r.id, { course: v.slice(0, 120) })} />}
                              {clashes[r.id]?.map((m) => <div key={m} className="small up-bad">⚠ {m}</div>)}
                            </td>
                            <td className="small">{deptName(r.courseId)}</td>
                            <td><select aria-label="Room" value={r.room} onChange={(e) => update(r.id, { room: e.target.value })}><option value="">No room</option>{roomList.map((x) => <option key={x} value={x}>{x}</option>)}</select></td>
                            <td>
                              {options ? (
                                <select aria-label="Invigilator" value={r.invigilatorUid || (r.invigilator ? `t:${r.invigilator}` : '')} onChange={(e) => {
                                  const p = staff.find((x) => x.uid === e.target.value);
                                  update(r.id, p ? { invigilator: p.name.slice(0, 120), invigilatorUid: p.uid } : { invigilator: '', invigilatorUid: '' });
                                }}>
                                  <option value="">Choose…</option>
                                  {r.invigilator && !staff.some((x) => x.uid === r.invigilatorUid) && <option value={r.invigilatorUid || `t:${r.invigilator}`}>{r.invigilator}</option>}
                                  {staff.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                                </select>
                              ) : <TypedCell value={r.invigilator} label="Invigilator" onSave={(v) => update(r.id, { invigilator: v.slice(0, 120), invigilatorUid: '' })} />}
                            </td>
                            <td className="no-print"><button type="button" className="btn btn-quiet btn-small" aria-label="Remove this paper" onClick={() => { setRows(t.rows.filter((x) => x.id !== r.id)); toast.show(`${r.course || 'Paper'} removed`); }}>✕</button></td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {keeper && <button type="button" className="btn btn-quiet btn-small align-start no-print" disabled={t.rows.length >= 150} onClick={addRow}>+ Add a paper</button>}
            {shown.length > 0 && <Downloads make={make} />}
          </div>
        </>
      )}
      {keeper && <RoomsCard orgId={org.id} rooms={rooms} exists={exists} />}
    </section>
  );
}

function TypedCell({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input aria-label={label} value={v} maxLength={120} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function NewExamPeriod({ today, onCreate, onCancel }: { today: string; onCreate: (paper: ExamPaper, semester: 1 | 2 | null, month: string) => void; onCancel?: () => void }) {
  const [paper, setPaper] = useState<ExamPaper>('cat1');
  const [semester, setSemester] = useState<'1' | '2' | ''>('1');
  const [month, setMonth] = useState(today.slice(0, 7));
  const sem = semester ? (Number(semester) as 1 | 2) : null;
  return (
    <div className="card stack no-print">
      <h2>New exam period</h2>
      <div className="field-row">
        <label className="field"><span>Exams</span><select value={paper} onChange={(e) => setPaper(e.target.value as ExamPaper)}>{EXAM_PAPERS.map((p) => <option key={p} value={p}>{EXAM_PAPER_LABELS[p]}</option>)}</select></label>
        <label className="field"><span>Semester</span><select value={semester} onChange={(e) => setSemester(e.target.value as '1' | '2' | '')}><option value="1">Semester 1</option><option value="2">Semester 2</option><option value="">No semester</option></select></label>
        <label className="field"><span>Month</span><AdiaDate type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      </div>
      <p className="small muted">It will be called <strong>{examPeriodName(paper, sem, month)}</strong>.</p>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={() => onCreate(paper, sem, month)}>Start it</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

