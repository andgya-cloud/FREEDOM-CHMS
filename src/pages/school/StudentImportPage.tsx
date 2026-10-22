import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { readStatementFile } from '../../lib/statementFile';
import { importStudents } from '../../lib/schoolWrites';
import { toCsv } from '../../lib/analytics';
import { KpiCard, KpiRow } from '../../components/charts';
import { IMPORT_TEMPLATE_HEAD, planStudentImport, type ImportCell, type ImportRow } from '../../../functions/src/shared/studentImport';
import { STUDENT_STATUS_LABELS } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
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
  const [file, setFile] = useState<{ name: string; rows: ImportCell[][] } | null>(null);
  const [programme, setProgramme] = useState('');
  const [intake, setIntake] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const plan = useMemo(() => (file ? planStudentImport(
    file.rows,
    { courses: s.courses, intakes: s.intakes, people: people.filter((p) => p.orgId === org.id), students: s.students },
    { programme: programme || undefined, intake: intake.trim() || undefined, startDate: s.today },
  ) : null), [file, s.courses, s.intakes, s.students, people, org.id, programme, intake, s.today]);

  const needsSettings = !!plan && (plan.newCourses.length > 0 || plan.newIntakes.length > 0) && !can('settings.manage');
  const shown = plan ? (showAll ? plan.rows : plan.rows.slice(0, 50)) : [];

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setDone(null);
    try {
      const rows = await readStatementFile(f);
      setFile({ name: f.name, rows });
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
      importStudents(org.id, plan.ready, { courseIds: s.courses.map((c) => c.id), keepAdmissionNos: can('settings.manage') }, s.today, profile?.uid ?? null).catch((err) => toast.show(friendlyError(err)));
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
      <SchoolNav feesAllowed={s.feesAllowed} />

      {done != null && (
        <div className="notice">
          <strong>{done} students added.</strong> Admission numbers from your file were kept, and anyone without one gets the next number in a few seconds.{' '}
          <Link to="/school/students">See the students</Link>
        </div>
      )}

      <section className="card stack">
        <p>Choose an Excel (.xlsx) or CSV class list. The first row should hold the column titles. Only <strong>Name</strong> is required; ADIA also reads
          Admission no, Phone, Gender, Programme (or Course), Intake (or Cohort), Level, Status, Start date and a sponsor's name, phone and relation.</p>
        <div className="row-actions">
          <label className="btn btn-primary">
            {file ? 'Choose a different file' : 'Choose the file'}
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="visually-hidden" onChange={(e) => void choose(e)} />
          </label>
          <button type="button" className="btn btn-quiet" onClick={downloadTemplate}>Download a template</button>
        </div>
        <details>
          <summary className="small">My file has no Programme or Intake column</summary>
          <div className="field-row">
            <label className="field"><span>Programme for everyone in the file</span>
              <select value={programme} onChange={(e) => setProgramme(e.target.value)}>
                <option value="">Use the file's column</option>
                {s.courses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Intake for everyone in the file</span>
              <input value={intake} onChange={(e) => setIntake(e.target.value)} placeholder="September 2026" maxLength={80} list="intake-names" />
              <datalist id="intake-names">{[...new Set(s.intakes.map((i) => i.name))].map((n) => <option key={n} value={n} />)}</datalist>
            </label>
          </div>
        </details>
        <p className="hint">Students already in ADIA are skipped, so the same file can be imported again safely.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {file && !plan && <p className="error" role="alert">No "Name" column was found in the first ten rows of {file.name}. Add a row of column titles at the top and try again.</p>}

      {plan && (
        <>
          <KpiRow label="Import summary">
            <KpiCard label="Rows in the file" value={String(plan.rows.length)} note={file?.name} />
            <KpiCard label="Ready to add" value={String(plan.ready.length)} tone="ok" />
            <KpiCard label="Skipped" value={String(plan.rows.length - plan.ready.length)} note="See the reasons below" />
            <KpiCard label="New intakes" value={String(plan.newIntakes.length)} note={plan.newCourses.length ? `and ${plan.newCourses.length} new programme${plan.newCourses.length === 1 ? '' : 's'}` : undefined} />
          </KpiRow>
          {plan.missingColumns.length > 0 && (
            <p className="notice small">The file has no {plan.missingColumns.join(' or ')} column. Fill it in above under "My file has no Programme or Intake column".</p>
          )}
          {plan.newCourses.length > 0 && <p className="notice small">These programmes will be added: {plan.newCourses.join(', ')}. Check the spelling first; a programme spelt differently from one you already have will be added as a new one.</p>}
          {plan.newIntakes.length > 0 && <p className="notice small">These intakes will be added: {plan.newIntakes.map((i) => `${i.courseName} ${i.name}`).join(', ')}.</p>}
          {!can('settings.manage') && plan.ready.some((r) => r.admissionNo) && <p className="notice small">Only staff with the Settings permission can keep the file's admission numbers, so these students will get new numbers.</p>}
          {needsSettings && <p className="error" role="alert">Adding programmes or intakes needs the Settings permission. Ask the pastor to add them, or to do the import.</p>}

          <div className="card exam-table-wrap">
            <table className="table">
              <thead><tr><th className="num">Row</th><th>Name</th><th>Adm no</th><th>Programme</th><th>Intake</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line}>
                    <td className="num">{r.line}</td>
                    <td>{r.name || <span className="muted">(blank)</span>}{r.phone && <div className="small muted">{r.phone}</div>}</td>
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
