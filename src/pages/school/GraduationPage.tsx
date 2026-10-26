import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { issueCertificate, recordOutcome } from '../../lib/schoolWrites';
import { saveGraduationGrades } from '../../lib/examWrites';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { useExamAccess, useExamCohorts, useExamResults } from '../../state/useExams';
import { saveExamCohort } from '../../lib/examWrites';
import { classOf, orderCohorts, cohortLabel } from '../../../functions/src/shared/examCohorts';
import { parseGraduationList, type GraduationRow } from '../../../functions/src/shared/graduation';
import { admissionKey } from '../../../functions/src/shared/examResults';
import { csvFile } from '../../lib/schoolPdf';
import { downloadFile } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { OUTCOME_LABELS, OUTCOME_STATUSES, type OutcomeStatus } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
import { CertificateActions } from '../../components/CertificateActions';
import { uploadCertificate } from '../../lib/certificateFiles';
import { fileAdmissionKey } from '../../../functions/src/shared/certificateFiles';
import type { Organization } from '../../state/OrgContext';
import type { OutcomeRow } from '../../state/useSchool';

export function GraduationPage() {
  return <SchoolGate title="Graduation">{(org) => <Graduation org={org} />}</SchoolGate>;
}

function Graduation({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const toast = useToast();
  const [studentId, setStudentId] = useState('');
  const [issuedOn, setIssuedOn] = useState(s.today);
  const candidates = s.students.filter((st) => st.status === 'enrolled').map((st) => ({ st, name: s.nameOf(st.id) })).sort((a, b) => a.name.localeCompare(b.name));
  const picked = s.students.find((x) => x.id === studentId);
  const register = [...s.certificates].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  const { byName: classes } = useExamCohorts(org.id);
  /** "Cohort 1 · Class of 2025": each graduating class is dated (Andy, 2026-10-25). */
  const classFor = (studentId: string, issuedOn: string) => {
    const st = s.students.find((x) => x.id === studentId);
    const cohort = st ? s.intakeName(st.intakeId) : '';
    const year = classOf(classes[cohort]?.graduationDate ?? issuedOn);
    return cohort ? `${cohort} · ${year}` : year;
  };
  const due = s.outcomes.filter((o) => o.status == null && o.due <= s.today).sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = s.outcomes.filter((o) => o.status == null && o.due > s.today).sort((a, b) => a.due.localeCompare(b.due));
  const recorded = s.outcomes.filter((o) => o.status != null).sort((a, b) => (b.recordedOn ?? '').localeCompare(a.recordedOn ?? ''));

  function issue() {
    if (!picked || !issuedOn) return;
    issueCertificate(org.id, picked.id, picked.courseId, issuedOn).catch((err) => toast.show(friendlyError(err)));
    toast.show(`Certificate issued to ${s.nameOf(picked.id)}`);
    setStudentId('');
  }

  const canFiles = can('school.manage') || can('settings.manage');

  function registerCsv() {
    const rows = register.map((c) => [c.serial ?? '', s.nameOf(c.studentId), s.courseName(c.courseId), classFor(c.studentId, c.issuedOn), c.issuedOn]);
    downloadFile(csvFile(`Certificate register ${s.today}.csv`, [['Serial number', 'Name', 'Programme', 'Class', 'Issued on'], ...rows]));
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Graduation</h1></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      {(can('settings.manage') || can('school.manage')) && (
        <section className="card stack">
          <h2>Issue a certificate</h2>
          <p className="small muted">The certificate gets the next serial number, the student becomes a graduate, and follow-ups at 3, 6 and 12 months are created. This cannot be undone.</p>
          <label className="field"><span>Student</span>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Choose…</option>
              {candidates.map(({ st, name }) => <option key={st.id} value={st.id}>{name} · {s.courseName(st.courseId)}</option>)}
            </select>
          </label>
          <label className="field"><span>Date issued</span><input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>
          <button type="button" className="btn btn-primary align-start" disabled={!picked || !issuedOn} onClick={issue}>Issue certificate</button>
        </section>
      )}

      {(can('settings.manage') || can('school.manage')) && <GraduationUpload org={org} s={s} />}

      <section className="card stack">
        <h2>Follow-ups due</h2>
        {due.length === 0 ? <p className="muted small">Nothing due now.</p> : due.map((o) => <OutcomeForm key={o.id} orgId={org.id} outcome={o} name={s.nameOf(o.studentId)} today={s.today} canRecord={can('people.write')} />)}
        {upcoming.length > 0 && <p className="small muted">Coming up: {upcoming.slice(0, 5).map((o) => `${s.nameOf(o.studentId)} (${o.months} months, ${formatDateKey(o.due)})`).join('; ')}.</p>}
      </section>

      {recorded.length > 0 && (
        <section className="card stack">
          <h2>Recorded answers</h2>
          <ul className="link-list">
            {recorded.map((o) => <li key={o.id}><Link to={`/school/students/${o.studentId}`}><span className="link-title">{s.nameOf(o.studentId)} · {o.months} months</span><span className="link-detail">{OUTCOME_LABELS[o.status as OutcomeStatus]}{o.note ? ` · ${o.note}` : ''}</span></Link></li>)}
          </ul>
        </section>
      )}

      <section className="card stack">
        <div className="card-head"><h2>Certificate register</h2>{register.length > 0 && <button type="button" className="btn btn-quiet" onClick={registerCsv}>Download</button>}</div>
        {register.length > 0 && canFiles && <UploadMany org={org} s={s} />}
        {register.length === 0 ? <p className="muted small">No certificates issued yet.</p> : (
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Serial</th><th>Name</th><th>Programme</th><th>Class</th><th>Issued</th><th>Certificate</th></tr></thead>
              <tbody>{register.map((c) => <tr key={c.id}><td>{c.serial ?? 'pending'}</td><td><Link to={`/school/students/${c.studentId}`}>{s.nameOf(c.studentId)}</Link></td><td>{s.courseName(c.courseId)}</td><td>{classFor(c.studentId, c.issuedOn)}</td><td>{formatDateKey(c.issuedOn)}</td>
                <td><CertificateActions orgId={org.id} cert={c} canManage={canFiles} email={s.byId(c.studentId)?.email} compact /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OutcomeForm({ orgId, outcome, name, today, canRecord }: { orgId: string; outcome: OutcomeRow; name: string; today: string; canRecord: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState<OutcomeStatus | ''>('');
  const [note, setNote] = useState('');
  function save() {
    if (!status) return;
    recordOutcome(orgId, outcome.studentId, outcome.months, status, note.trim(), today).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${name}: saved`);
  }
  return (
    <div className="stack">
      <p><strong>{name}</strong> <span className="muted small">{outcome.months}-month check, due {formatDateKey(outcome.due)}</span></p>
      {canRecord && (
        <>
          <div className="field-row">
            <label className="field"><span>What are they doing?</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as OutcomeStatus)}>
                <option value="">Choose…</option>
                {OUTCOME_STATUSES.map((v) => <option key={v} value={v}>{OUTCOME_LABELS[v]}</option>)}
              </select>
            </label>
            <label className="field"><span>Note (optional)</span><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          <button type="button" className="btn align-start" disabled={!status} onClick={save}>Save</button>
        </>
      )}
    </div>
  );
}

type Match = { row: GraduationRow; st: ReturnType<typeof useSchoolPage>['students'][number] | null; why: 'graduate' | 'already' | 'fail' | 'not-enrolled' | 'unknown' };

/**
 * The graduation list from Excel (Andy, 2026-10-25): each student who passed gets their certificate (and
 * becomes a graduate, with the 3, 6 and 12-month follow-ups); a Fail stays as it is. The final points and
 * grade are kept with the student's results.
 */
function GraduationUpload({ org, s }: { org: Organization; s: ReturnType<typeof useSchoolPage> }) {
  const toast = useToast();
  const exams = useExamAccess();
  const { results } = useExamResults(org.id);
  const { byName: classes } = useExamCohorts(org.id);
  const order = orderCohorts([...new Set(s.intakes.map((i) => i.name))], s.intakes, classes);
  const choices = [...order.current, ...order.past];
  const [cohort, setCohort] = useState('');
  const [issuedOn, setIssuedOn] = useState(s.today);
  function pickClass(c: string) {
    setCohort(c);
    const d = classes[c]?.graduationDate;
    if (d) setIssuedOn(d);
  }
  const [plan, setPlan] = useState<{ file: string; matches: Match[]; problems: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const certified = new Set(s.certificates.map((c) => c.studentId));
  const plain = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const list = parseGraduationList(await readSpreadsheetSheets(f));
      const live = s.students.filter((st) => !st.deletedAt);
      const byAdm = new Map(live.filter((st) => st.admissionNo).map((st) => [admissionKey(st.admissionNo), st]));
      const byName = new Map(live.map((st) => [plain(s.nameOf(st.id)), st]));
      const matches: Match[] = list.rows.map((row) => {
        const st = byAdm.get(admissionKey(row.admissionNo)) ?? byName.get(plain(row.name)) ?? null;
        const why: Match['why'] = !st ? 'unknown' : !row.passed ? 'fail' : st.status === 'graduated' || certified.has(st.id) ? 'already' : st.status === 'enrolled' ? 'graduate' : 'not-enrolled';
        return { row, st, why };
      });
      setPlan({ file: f.name, matches, problems: list.problems });
    } catch (err) { toast.show(friendlyError(err)); }
  }

  async function save() {
    if (!plan || !issuedOn) return;
    setSaving(true);
    try {
      const go = plan.matches.filter((m) => m.why === 'graduate');
      for (const m of go) issueCertificate(org.id, m.st!.id, m.st!.courseId, issuedOn).catch((err) => toast.show(friendlyError(err)));
      if (exams.canManage) {
        const existing = new Set(results.map((r) => r.id));
        await saveGraduationGrades(org.id, plan.matches.filter((m) => m.st && m.row.points != null).map((m) => ({
          studentId: m.st!.id, cohort: s.intakeName(m.st!.intakeId) || 'Cohort', admissionNo: m.st!.admissionNo ?? m.row.admissionNo, studentName: s.nameOf(m.st!.id),
          courseId: m.st!.courseId, points: m.row.points!, grade: m.row.grade,
        })), existing);
      }
      // The graduation date names the class: "Class of 2025" (Andy, 2026-10-25).
      if (cohort && exams.canManage && classes[cohort]?.graduationDate !== issuedOn && !classes[cohort]?.closed) {
        saveExamCohort(org.id, cohort, !!classes[cohort], { graduationDate: issuedOn }).catch((err) => toast.show(friendlyError(err)));
      }
      toast.show(`${go.length} ${go.length === 1 ? 'certificate' : 'certificates'} issued${cohort ? ` to ${cohort}, ${classOf(issuedOn)}` : ''}.${exams.canManage ? ' Final points and grades saved.' : ''}`);
      setPlan(null);
    } catch (err) { toast.show(friendlyError(err)); } finally { setSaving(false); }
  }

  const group = (why: Match['why']) => plan?.matches.filter((m) => m.why === why) ?? [];
  const list = (ms: Match[]) => <ul className="small">{ms.map((m) => <li key={m.row.row}>{m.row.name} · {m.row.admissionNo}{m.row.points != null ? ` · ${m.row.points}` : ''}{m.row.grade ? ` ${m.row.grade}` : ''}</li>)}</ul>;
  const go = group('graduate');
  return (
    <section className="card stack">
      <h2>Upload the graduation list</h2>
      <p className="small muted">An Excel file with Student name, Adm No., Points and Grade, under each department's name. Everyone who passed gets their certificate; a Fail stays as it is.</p>
      <div className="row-actions">
        <label className="field"><span>Graduating class</span>
          <select value={cohort} onChange={(e) => pickClass(e.target.value)}>
            <option value="">Choose…</option>
            {choices.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}
          </select>
        </label>
        <label className="field"><span>Graduation date</span><input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>
        <label className="btn btn-primary align-end">Choose the Excel file<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => void choose(e)} /></label>
      </div>
      {plan && (
        <div className="stack">
          <p><strong>{plan.file}</strong>: {plan.matches.length} students. <strong>{go.length}</strong> will graduate{cohort ? ` with ${cohort}, ${classOf(issuedOn)}` : ''}.</p>
          {plan.problems.length > 0 && <ul className="small up-bad">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {go.length > 0 && <details open><summary>{go.length} will get a certificate</summary>{list(go)}</details>}
          {group('fail').length > 0 && <details><summary>{group('fail').length} did not pass (no certificate)</summary>{list(group('fail'))}</details>}
          {group('already').length > 0 && <details><summary>{group('already').length} already graduated</summary>{list(group('already'))}</details>}
          {group('not-enrolled').length > 0 && <details><summary className="up-bad">{group('not-enrolled').length} not enrolled now (deferred or withdrawn), left as they are</summary>{list(group('not-enrolled'))}</details>}
          {group('unknown').length > 0 && <details open><summary className="up-bad">{group('unknown').length} not found in Students</summary>{list(group('unknown'))}</details>}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={saving || (!go.length && !exams.canManage)} onClick={() => void save()}>{saving ? 'Saving…' : go.length ? `Issue ${go.length} certificates` : 'Save the points and grades'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setPlan(null)}>Cancel</button>
          </div>
          <p className="small muted">Certificates get the next serial numbers and cannot be undone.</p>
        </div>
      )}
    </section>
  );
}

/**
 * Many certificates at once (Andy, 2026-10-26, 5A): PDFs named by admission number, e.g. ADIA-2025-014.pdf,
 * each kept for the graduate with that number. Files that match nobody with a certificate are listed and skipped.
 */
function UploadMany({ org, s }: { org: Organization; s: ReturnType<typeof useSchoolPage> }) {
  const toast = useToast();
  const [plan, setPlan] = useState<{ file: File; studentId: string | null }[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const certified = new Set(s.certificates.map((c) => c.studentId));
  function choose(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    const byAdm = new Map(s.students.filter((st) => certified.has(st.id) && st.admissionNo).map((st) => [fileAdmissionKey(st.admissionNo!), st.id]));
    setPlan(files.map((file) => ({ file, studentId: byAdm.get(fileAdmissionKey(file.name)) ?? null })));
    setDone(null);
  }
  const go = (plan ?? []).filter((p) => p.studentId);
  const skip = (plan ?? []).filter((p) => !p.studentId);
  async function upload() {
    let n = 0;
    const failed: string[] = [];
    setDone(0);
    for (const p of go) {
      try { await uploadCertificate(org.id, p.studentId!, p.file); } catch (err) { failed.push(`${p.file.name}: ${friendlyError(err)}`); }
      setDone(++n);
    }
    toast.show(`${go.length - failed.length} ${go.length - failed.length === 1 ? 'certificate' : 'certificates'} uploaded${failed.length ? `, ${failed.length} failed` : ''}.`);
    if (failed.length) setPlan(go.filter((p) => failed.some((f) => f.startsWith(p.file.name))));
    else setPlan(null);
    setDone(null);
  }
  return (
    <details className="fold-card">
      <summary>Upload many certificates</summary>
      <p className="small muted">Choose the PDFs together. Name each file by the graduate's admission number, for example ADIA-2025-014.pdf. Each is kept for that graduate; a file for the same graduate replaces the earlier one.</p>
      <label className="btn align-start">Choose PDFs<input type="file" accept="application/pdf,.pdf" multiple hidden onChange={choose} /></label>
      {plan && (
        <div className="stack">
          {go.length > 0 && <details open><summary>{go.length} matched</summary><ul className="small">{go.map((p) => <li key={p.file.name}>{p.file.name} → {s.nameOf(p.studentId!)}</li>)}</ul></details>}
          {skip.length > 0 && <details open><summary className="up-bad">{skip.length} not matched to a graduate</summary><ul className="small">{skip.map((p) => <li key={p.file.name}>{p.file.name}</li>)}</ul></details>}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={!go.length || done !== null} onClick={() => void upload()}>{done !== null ? `Uploading ${done} of ${go.length}…` : `Upload ${go.length}`}</button>
            <button type="button" className="btn btn-quiet" disabled={done !== null} onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </details>
  );
}
