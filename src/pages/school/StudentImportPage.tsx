import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { importStudents } from '../../lib/schoolWrites';
import { toCsv } from '../../lib/analytics';
import { KpiCard, KpiRow } from '../../components/charts';
import { IMPORT_TEMPLATE_HEAD, planStudentImport, type ImportRow, type ImportSheet } from '../../../functions/src/shared/studentImport';
import { STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';
import { SchoolGate, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function StudentImportPage() {
  return <SchoolGate title="Import students">{(org) => <StudentImport org={org} />}</SchoolGate>;
}

function downloadTemplate() {
  const csv = toCsv(IMPORT_TEMPLATE_HEAD, [
    ['Jane Wanjiru', '', '0712345678', 'Female', 'ICT', 'September 2026', 'Level 1', 'Enrolled', '2026-09-01', 'Mary Wanjiru', '0722345678', 'Mother'],
  ]);
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ADIA-students-template.csv';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outcome(r: ImportRow): string {
  if (r.skip) return `Skipped: ${r.skip}`;
  return r.personId ? 'Will add (already in People)' : 'Will add';
}

function StudentImport({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { people } = usePeople();
  const { can, profile } = useAuth();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; sheets: ImportSheet[] } | null>(null);
  const [courseMap, setCourseMap] = useState<Record<string, string>>({});
  const [programme, setProgramme] = useState('');
  const [intake, setIntake] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const plan = useMemo(() => (file ? planStudentImport(
    file.sheets,
    { courses: s.courses, intakes: s.intakes, people: people.filter((p) => p.orgId === org.id), students: s.students },
    { programme: programme || undefined, intake: intake.trim() || undefined, startDate: s.today, courseMap },
  ) : null), [file, s.courses, s.intakes, s.students, people, org.id, programme, intake, s.today, courseMap]);

  const needsSettings = !!plan && (plan.newCourses.length > 0 || plan.newIntakes.length > 0) && !can('settings.manage');
  const shown = plan ? (showAll ? plan.rows : plan.rows.slice(0, 50)) : [];

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setDone(null);
    try {
      const sheets = await readSpreadsheetSheets(f);
      setFile({ name: f.name, sheets });
      setCourseMap({});
    } catch (err) {
      setFile(null);
      const msg = err instanceof Error ? err.message : '';
      setError(/cell value|xml|zip/i.test(msg) || !msg
        ? 'That Excel file could not be read. Open it in Excel or Google Sheets, save it as a new .xlsx or as CSV, and choose it again.'
        : msg);
    }
  }

  function run() {
    if (!plan || !plan.ready.length) return;
    setBusy(true);
    try {
      // Saved on this device at once and sent when online, like every other change.
      importStudents(org.id, plan.ready, { courseIds: s.courses.map((c) => c.id), keepAdmissionNos: can('settings.manage') || can('school.manage'), keepIdNumbers: can('pastoral.read') }, s.today, profile?.uid ?? null).catch((err) => toast.show(friendlyError(err)));
      setDone(plan.ready.length);
      setFile(null);
      toast.show(`${plan.ready.length} students added`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow wide-table">
      <p><Link to="/school/students">← Students</Link></p>
      <h1>Import students from Excel</h1>

      {done != null && (
        <div className="notice">
          <strong>{done} students added.</strong> Admission numbers from your file were kept, and anyone without one gets the next number in a few seconds.{' '}
          <Link to="/school/students">See the students</Link>
        </div>
      )}

      <section className="card stack">
        <p>Choose an Excel (.xlsx) or CSV class list. Every worksheet is read, for example one sheet per department; each needs a row of column titles at the top. Only <strong>Name</strong> is required; ADIA also reads
          Admission no, Phone, Gender, Department (or Programme), Cohort (or Intake; a number such as 3 becomes "Cohort 3"), Level, Status, Start date and a sponsor's name, phone and relation.</p>
        <div className="row-actions">
          <label className="btn btn-primary">
            {file ? 'Choose a different file' : 'Choose the file'}
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="visually-hidden" onChange={(e) => void choose(e)} />
          </label>
          <button type="button" className="btn btn-quiet" onClick={downloadTemplate}>Download a template</button>
        </div>
        <details>
          <summary className="small">My file has no Department or Cohort column</summary>
          <div className="field-row">
            <label className="field"><span>Department for everyone in the file</span>
              <select value={programme} onChange={(e) => setProgramme(e.target.value)}>
                <option value="">Use the file's column</option>
                {s.courses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Cohort for everyone in the file</span>
              <input value={intake} onChange={(e) => setIntake(e.target.value)} placeholder="September 2026" maxLength={80} list="intake-names" />
              <datalist id="intake-names">{[...new Set(s.intakes.map((i) => i.name))].map((n) => <option key={n} value={n} />)}</datalist>
            </label>
          </div>
        </details>
        <p className="hint">Students already in ADIA are skipped, so the same file can be imported again safely.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {file && !plan && <p className="error" role="alert">No column of names was found in {file.name}. Each sheet needs a row of column titles near the top, with one called Name or Full names.</p>}

      {plan && (
        <>
          <KpiRow label="Import summary">
            <KpiCard label="Rows in the file" value={String(plan.rows.length)} note={file?.name} />
            <KpiCard label="Ready to add" value={String(plan.ready.length)} tone="ok" />
            <KpiCard label="Skipped" value={String(plan.rows.length - plan.ready.length)} note="See the reasons below" />
            <KpiCard label="New cohorts" value={String(plan.newIntakes.length)} note={plan.newCourses.length ? `and ${plan.newCourses.length} new department${plan.newCourses.length === 1 ? '' : 's'}` : undefined} />
          </KpiRow>
          {plan.programmes.length > 0 && (
            <section className="card stack">
              <h2>Match the departments</h2>
              <p className="small muted">Check where each department in your file goes. Choose "Add as a new department" only if ADIA doesn't have it yet.</p>
              <table className="table">
                <thead><tr><th>In your file</th><th className="num">Students</th><th>Goes to</th></tr></thead>
                <tbody>
                  {plan.programmes.map((p) => (
                    <tr key={p.key}>
                      <td>{p.name}</td>
                      <td className="num">{p.rows}</td>
                      <td>
                        <select value={p.courseId ?? ''} aria-label={`Department for ${p.name}`} onChange={(e) => setCourseMap((m) => ({ ...m, [p.key]: e.target.value }))}>
                          <option value="">Add as a new department</option>
                          {s.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {plan.sheetsSkipped.length > 0 && <p className="notice small">Left out because they have no name column: {plan.sheetsSkipped.join(', ')}.</p>}
          {plan.missingColumns.length > 0 && (
            <p className="notice small">The file has no {plan.missingColumns.join(' or ')} column. Fill it in above under "My file has no Department or Cohort column".</p>
          )}
          {plan.newCourses.length > 0 && <p className="notice small">These departments will be added: {plan.newCourses.join(', ')}. Check the spelling first; a department spelt differently from one you already have will be added as a new one.</p>}
          {plan.newIntakes.length > 0 && <p className="notice small">These cohorts will be added: {plan.newIntakes.map((i) => `${i.courseName} ${i.name}`).join(', ')}.</p>}
          {!can('settings.manage') && !can('school.manage') && plan.ready.some((r) => r.admissionNo) && <p className="notice small">Only staff with the Settings permission can keep the file's admission numbers, so these students will get new numbers.</p>}
          {needsSettings && <p className="error" role="alert">Adding departments or cohorts needs the Settings permission. Ask the Director to add them, or to do the import.</p>}

          <div className="card exam-table-wrap">
            <table className="table">
              <thead><tr><th>Sheet · row</th><th>Name</th><th>Phone</th><th>Adm no</th><th>Department</th><th>Cohort</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.sheet}:${r.line}`}>
                    <td className="small">{r.sheet ? `${r.sheet} · ${r.line}` : r.line}</td>
                    <td>{r.name || <span className="muted">(blank)</span>}</td>
                    <td className="nowrap">{r.phone ?? <span className="muted small">none</span>}</td>
                    <td>{r.admissionNo ?? <span className="muted small">automatic</span>}</td>
                    <td>{r.programme}{r.newCourse && <span className="badge"> new</span>}</td>
                    <td>{r.intake}{r.newIntake && !r.skip && <span className="badge"> new</span>}</td>
                    <td>{STUDENT_STATUS_LABELS[r.status]}</td>
                    <td className={r.skip ? 'danger-text' : ''}>{outcome(r)}{r.notes.length > 0 && <div className="small muted">{r.notes.join('; ')}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.rows.length > shown.length && <button type="button" className="btn btn-quiet" onClick={() => setShowAll(true)}>Show all {plan.rows.length} rows</button>}
          </div>

          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !plan.ready.length || needsSettings} onClick={run}>
              {busy ? 'Adding…' : `Add ${plan.ready.length} student${plan.ready.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
