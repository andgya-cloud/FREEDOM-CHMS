import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { useOrg } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useSchool } from '../../state/useSchool';
import { useAllExamSheets, useExamAccess, useExamCohorts, useExamSettings, type ExamSheetRow } from '../../state/useExams';
import { closedNow, confirmPassword, createExamSheet, logExam, saveExamCohort, savePastTotals } from '../../lib/examWrites';
import { friendlyError } from '../../lib/errors';
import { openedInThisTab, rememberOpened } from '../../lib/pastOpen';
import { markProblem, markText, mergedMarks, parseMark, type MarkValue } from '../../../functions/src/shared/exams';
import { courseListFromSheets, courseListKey, sortCourseList, type CourseListItem } from '../../../functions/src/shared/examCohorts';
import { cohortStart, isTotalOnly, TOTAL_ONLY_WEIGHTS } from '../../../functions/src/shared/pastRecords';
import { STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';

/** How long a cohort opened for past results stays open if the page is left without closing it. */
const OPEN_FOR_MS = 3 * 60 * 60 * 1000;

/**
 * Key in past results (Andy, 2026-11-01, 5A 6A): pick a cohort and a course and type one total mark (out of 100)
 * per student. A closed cohort asks for the person's password once, opens for this visit only, and closes again
 * when they leave the page (or after three hours, whichever comes first).
 */
export function PastResultsPage() {
  const { current } = useOrg();
  const access = useExamAccess();
  if (!current || current.type !== 'college') return <div className="page narrow"><p>Past results are for ADIA Training Centre.</p></div>;
  if (!access.canManage) return <div className="page narrow"><p><Link to="/attendance">← Attendance</Link></p><p>Only the Director and the principal key in past results.</p></div>;
  return <PastResults orgId={current.id} />;
}

function PastResults({ orgId }: { orgId: string }) {
  const [params, setParams] = useSearchParams();
  const school = useSchool(orgId);
  const { sheets } = useAllExamSheets(orgId);
  const { byName } = useExamCohorts(orgId);
  const { settings } = useExamSettings(orgId);
  const { uid, myName } = useExamAccess();
  const { byId } = usePeople();
  const toast = useToast();

  const cohorts = useMemo(() => {
    const names = [...new Set([...school.intakes.map((i) => i.name.trim()), ...sheets.map((s) => s.cohort.trim())].filter(Boolean))];
    return names.sort((a, b) => (cohortStart(school.intakes, b) ?? b).localeCompare(cohortStart(school.intakes, a) ?? a, undefined, { numeric: true }));
  }, [school.intakes, sheets]);
  const cohort = params.get('cohort') && cohorts.includes(params.get('cohort')!) ? params.get('cohort')! : cohorts[0] ?? '';
  const info = byName[cohort];
  const closed = info?.closed === true;

  // Closes any cohort left open for past results whose time has run out (a page closed without leaving it).
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current) return;
    const late = Object.values(byName).filter((c) => c && !c.closed && c.autoCloseAt && c.autoCloseAt.toMillis() < Date.now());
    if (!late.length) return;
    swept.current = true;
    for (const c of late) saveExamCohort(orgId, c!.cohort, true, { closed: true, closedAt: closedNow(), closedByName: myName, autoCloseAt: null }).catch(() => {});
  }, [byName, orgId, myName]);

  // The cohort this visit opened: closed again on leaving the page, switching cohort, or closing the tab (5A).
  // A tab closed offline sends the close the next time the app opens; failing that, the three-hour limit applies.
  const opened = useRef<string | null>(null);
  // After a reload on this page, the cohort this tab opened is still ours to close.
  if (opened.current == null) { const mine = openedInThisTab(); if (mine && mine.orgId === orgId && mine.cohort === cohort) opened.current = cohort; }
  useEffect(() => {
    const closeAgain = () => {
      const c = opened.current;
      if (!c) return;
      opened.current = null;
      rememberOpened(null);
      saveExamCohort(orgId, c, true, { closed: true, closedAt: closedNow(), closedByName: myName, autoCloseAt: null }).catch(() => {});
      logExam(orgId, { action: 'Closed again', cohort: c, sheetId: null, detail: 'After keying in past results', byName: myName }).catch(() => {});
    };
    // Closing the tab: try to close now; the note in this tab, or the three-hour limit, covers a lost write.
    const onHide = () => { const c = opened.current; if (c) saveExamCohort(orgId, c, true, { closed: true, closedAt: closedNow(), closedByName: myName, autoCloseAt: null }).catch(() => {}); };
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); closeAgain(); };
  }, [orgId, myName, cohort]);

  const newestFirst = cohorts;
  const list: CourseListItem[] = useMemo(() => (settings.courseList ? sortCourseList(settings.courseList) : courseListFromSheets(sheets, newestFirst)), [settings.courseList, sheets, newestFirst]);
  const cohortSheets = sheets.filter((s) => s.cohort.trim() === cohort);
  const options = useMemo(() => {
    const byKey = new Map<string, { key: string; item: CourseListItem; sheet: ExamSheetRow | null }>();
    for (const s of cohortSheets) byKey.set(courseListKey(s), { key: courseListKey(s), item: { name: s.courseName, courseId: s.courseId, semester: s.semester ?? null }, sheet: s });
    for (const item of list) if (!byKey.has(courseListKey(item))) byKey.set(courseListKey(item), { key: courseListKey(item), item, sheet: null });
    return sortCourseList([...byKey.values()].map((o) => ({ ...o.item, key: o.key, sheet: o.sheet })));
  }, [cohortSheets, list]);
  const deptName = (id: string | null) => (id ? school.courses.find((c) => c.id === id)?.name ?? 'Department' : 'Common courses');
  const groups = [...new Set(options.map((o) => o.courseId ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : deptName(a).localeCompare(deptName(b))));
  const chosen = options.find((o) => o.key === params.get('course')) ?? options[0];
  const sheet = chosen?.sheet ?? null;
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); n.set(k, v); if (k === 'cohort') n.delete('course'); setParams(n, { replace: true }); };

  const intakeIds = new Set(school.intakes.filter((i) => i.name.trim() === cohort && (!chosen?.courseId || i.courseId === chosen.courseId)).map((i) => i.id));
  const students = school.students
    .filter((s) => intakeIds.has(s.intakeId) && s.status !== 'applicant' && (!chosen?.courseId || s.courseId === chosen.courseId))
    .map((s) => ({ ...s, name: byId(s.id)?.fullName ?? 'Student' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const existing = sheet ? mergedMarks(sheet as never) : {};
  const totalOnly = !sheet || isTotalOnly(sheet.weights);
  const hasPaperMarks = !!sheet && !totalOnly && Object.values(existing).some((m) => (['cat1', 'cat2', 'cat3', 'final'] as const).some((c) => m[c] != null));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setTyped({}); setErrors({}); }, [cohort, chosen?.key]);
  const valueOf = (id: string) => typed[id] ?? (totalOnly ? markText(existing[id]?.final) : '');

  const [password, setPassword] = useState('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  async function open(e: FormEvent) {
    e.preventDefault();
    setOpening(true);
    setOpenError('');
    try {
      await confirmPassword(password);
      await saveExamCohort(orgId, cohort, !!info, { closed: false, reopenedAt: closedNow(), reopenedByName: myName, autoCloseAt: Timestamp.fromMillis(Date.now() + OPEN_FOR_MS) });
      opened.current = cohort;
      rememberOpened({ orgId, cohort });
      logExam(orgId, { action: 'Opened for past results', cohort, sheetId: null, detail: 'Closes again on leaving', byName: myName }).catch(() => {});
      setPassword('');
    } catch (err) {
      setOpenError((err as { code?: string }).code === 'auth/invalid-credential' || (err as { code?: string }).code === 'auth/wrong-password' ? 'That password is not right.' : friendlyError(err));
    } finally {
      setOpening(false);
    }
  }

  function save() {
    if (!chosen) return;
    const bad: Record<string, string> = {};
    const marks: Record<string, MarkValue> = { ...Object.fromEntries(Object.entries(existing).map(([id, m]) => [id, (totalOnly ? m.final ?? null : null) as MarkValue])) };
    for (const s of students) {
      const { value, problem } = parseMark(valueOf(s.id));
      const p = problem ?? markProblem(value, 100);
      if (p) bad[s.id] = p;
      else marks[s.id] = value;
    }
    setErrors(bad);
    if (Object.keys(bad).length) return toast.show('Some marks need checking (shown in red).');
    const clean = Object.fromEntries(Object.entries(marks).filter(([, v]) => v != null));
    let sheetId = sheet?.id;
    try {
      if (!sheetId) {
        const made = createExamSheet(orgId, { cohort, courseId: chosen.courseId, courseName: chosen.name, teacherName: 'Past records', weights: TOTAL_ONLY_WEIGHTS, ownerUid: uid, ownerName: myName, semester: chosen.semester ?? null });
        made.synced.catch((err) => toast.show(friendlyError(err)));
        sheetId = made.ref.id;
      }
      savePastTotals(orgId, sheetId, clean, myName, !totalOnly || !sheet).catch((err) => toast.show(friendlyError(err)));
      logExam(orgId, { action: 'Past results typed in', cohort, sheetId, detail: `${chosen.name}: ${Object.keys(clean).length} totals`, byName: myName }).catch(() => {});
      setTyped({});
      toast.show(`${chosen.name}: ${Object.keys(clean).length} marks saved`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow past-results">
      <p><Link to="/attendance">← Attendance</Link></p>
      <h1>Key in past results</h1>
      <div className="filter-row two">
        <label className="field"><span>Cohort</span>
          <select className="filter-select" value={cohort} onChange={(e) => set('cohort', e.target.value)}>
            {cohorts.map((c) => <option key={c} value={c}>{c}{byName[c]?.closed ? ' (closed)' : ''}</option>)}
          </select>
        </label>
        <label className="field"><span>Course</span>
          <select className="filter-select" value={chosen?.key ?? ''} onChange={(e) => set('course', e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g || 'common'} label={deptName(g || null)}>
                {options.filter((o) => (o.courseId ?? '') === g).map((o) => <option key={o.key} value={o.key}>{o.name}{o.semester ? ` · Semester ${o.semester}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {closed ? (
        <form className="card form narrow-block" onSubmit={open}>
          <h2>{cohort} is closed</h2>
          <p className="muted">Type your password to open it for typing. It closes again by itself when you leave this page.</p>
          <label className="field"><span>Your password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {openError && <p className="error" role="alert">{openError}</p>}
          <button type="submit" className="btn btn-primary" disabled={opening || !password}>{opening ? 'Opening…' : `Open ${cohort}`}</button>
        </form>
      ) : !chosen ? (
        <p className="muted">No courses are set up yet. Add the course list under Exam Records → Setup.</p>
      ) : hasPaperMarks ? (
        <div className="notice">{chosen.name} was marked paper by paper. <Link to={`/school/exams/sheet/${sheet!.id}`}>Open it in Exam Records</Link> to change marks.</div>
      ) : students.length === 0 ? (
        <p className="muted">No students in {cohort} for this course.</p>
      ) : (
        <section className="card">
          <div className="card-head">
            <h2>{chosen.name}</h2>
            {opened.current === cohort && <span className="badge badge-warn">Open for this visit</span>}
          </div>
          <p className="muted small">One total mark out of 100 for each student. ABS for absent, EX for exempt. Leave a box empty if you don't have the mark.</p>
          <table className="past-results-table">
            <thead><tr><th>Student</th><th>Total /100</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name} <span className="muted small">{s.admissionNo ?? ''}</span>{s.status !== 'enrolled' && <span className="badge badge-muted">{STUDENT_STATUS_LABELS[s.status]}</span>}</th>
                  <td>
                    <input className={errors[s.id] ? 'mark-input bad' : 'mark-input'} inputMode="decimal" aria-label={`${s.name} total`} value={valueOf(s.id)}
                      onChange={(e) => setTyped((t) => ({ ...t, [s.id]: e.target.value }))} />
                    {errors[s.id] && <span className="error small">{errors[s.id]}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={save}>Save {chosen.name}</button></div>
        </section>
      )}
    </div>
  );
}
