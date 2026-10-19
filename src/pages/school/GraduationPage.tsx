import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { issueCertificate, recordOutcome } from '../../lib/schoolWrites';
import { csvFile } from '../../lib/schoolPdf';
import { downloadFile } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { OUTCOME_LABELS, OUTCOME_STATUSES, type OutcomeStatus } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
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
  const due = s.outcomes.filter((o) => o.status == null && o.due <= s.today).sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = s.outcomes.filter((o) => o.status == null && o.due > s.today).sort((a, b) => a.due.localeCompare(b.due));
  const recorded = s.outcomes.filter((o) => o.status != null).sort((a, b) => (b.recordedOn ?? '').localeCompare(a.recordedOn ?? ''));

  function issue() {
    if (!picked || !issuedOn) return;
    issueCertificate(org.id, picked.id, picked.courseId, issuedOn).catch((err) => toast.show(friendlyError(err)));
    toast.show(`Certificate issued to ${s.nameOf(picked.id)}`);
    setStudentId('');
  }

  function registerCsv() {
    const rows = register.map((c) => [c.serial ?? '', s.nameOf(c.studentId), s.courseName(c.courseId), c.issuedOn]);
    downloadFile(csvFile(`Certificate register ${s.today}.csv`, [['Serial number', 'Name', 'Programme', 'Issued on'], ...rows]));
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Graduation</h1></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      {can('settings.manage') && (
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
        {register.length === 0 ? <p className="muted small">No certificates issued yet.</p> : (
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Serial</th><th>Name</th><th>Programme</th><th>Issued</th></tr></thead>
              <tbody>{register.map((c) => <tr key={c.id}><td>{c.serial ?? 'pending'}</td><td>{s.nameOf(c.studentId)}</td><td>{s.courseName(c.courseId)}</td><td>{formatDateKey(c.issuedOn)}</td></tr>)}</tbody>
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
