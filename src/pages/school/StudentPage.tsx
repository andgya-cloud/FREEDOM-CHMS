import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { CertificateActions } from '../../components/CertificateActions';
import { useToast } from '../../state/ToastContext';
import { usePersonGifts } from '../../state/useGiving';
import { FeeReminderSheet } from '../../components/FeeReminderSheet';
import { friendlyError } from '../../lib/errors';
import { saveStudentPrivate, updateStudent } from '../../lib/schoolWrites';
import { feeStatementPdf, resultsPdf } from '../../lib/schoolPdf';
import { shareOrDownload } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { formatMoney } from '../../../functions/src/shared/giving';
import { formatPhone } from '../../../functions/src/shared/phone';
import {
  OUTCOME_LABELS, overallResult, STUDENT_STATUS_LABELS, studentAttendance, studentResults, type StudentStatus,
} from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function StudentPage() {
  return <SchoolGate title="Student">{(org) => <Student org={org} />}</SchoolGate>;
}

function Student({ org }: { org: Organization }) {
  const { studentId = '' } = useParams();
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const toast = useToast();
  const [reminder, setReminder] = useState(false);
  const [busy, setBusy] = useState('');
  const st = s.students.find((x) => x.id === studentId);
  const course = st ? s.courses.find((c) => c.id === st.courseId) : undefined;
  const { gifts } = usePersonGifts(org.id, studentId);

  if (!st || !course || (s.peopleLoading && !s.byId(st.id))) {
    return <div className="page narrow"><p><Link to="/school/students">← Students</Link></p><p>{s.loading ? 'Loading…' : 'This student was not found.'}</p></div>;
  }
  const name = s.nameOf(st.id);
  const att = studentAttendance(st.id, course.name, s.events, s.records, st.enrolledOn);
  const results = studentResults(course, st.level || null, st.id, s.assessments, s.marks, s.settings);
  const overall = overallResult(results, s.settings);
  const bal = s.balances.find((b) => b.studentId === st.id);
  const invoices = s.invoices.filter((i) => i.studentId === st.id && i.status !== 'void');
  const cert = s.certificates.find((c) => c.studentId === st.id);
  const outcomes = s.outcomes.filter((o) => o.studentId === st.id).sort((a, b) => a.months - b.months);
  const identity = { name, admissionNo: st.admissionNo ?? '', course: course.name, level: st.level, intake: s.intakeName(st.intakeId), status: STUDENT_STATUS_LABELS[st.status] };
  const canEdit = can('people.write');

  async function makePdf(kind: 'report_card' | 'transcript' | 'statement') {
    setBusy(kind);
    try {
      const file = kind === 'statement'
        ? await feeStatementPdf(org, { student: identity, invoices, gifts: gifts.filter((g) => g.fundId === 'school_fees'), balanceCents: bal?.balanceCents ?? 0, paidCents: bal?.paidCents ?? 0, today: s.today })
        : await resultsPdf(org, kind, { student: identity, results: kind === 'transcript' ? studentResults(course!, null, st!.id, s.assessments, s.marks, s.settings) : results, overall, attendance: att, settings: s.settings, today: s.today, certificate: cert ?? null });
      await shareOrDownload(file, `${file.name} from ${org.name}`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  function change(changes: Record<string, unknown>, message: string) {
    updateStudent(org.id, st!.id, changes).catch((err) => toast.show(friendlyError(err)));
    toast.show(message);
  }

  return (
    <div className="page narrow">
      <p><Link to="/school/students">← Students</Link></p>
      <div className="page-head"><h1>{name}</h1><Link to={`/people/${org.id}/${st.id}`} className="btn btn-quiet">Person record</Link></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      <section className="card stack">
        <p><strong>{st.admissionNo ?? 'Admission number pending'}</strong> · {course.name}</p>
        <div className="field-row">
          <label className="field"><span>Status</span>
            <select value={st.status} disabled={!canEdit || st.status === 'graduated'}
              onChange={(e) => {
                const v = e.target.value as StudentStatus;
                change({ status: v, ...(v === 'withdrawn' ? { withdrawnOn: s.today } : {}), ...(v === 'enrolled' && !st.enrolledOn ? { enrolledOn: s.today } : {}) }, `${name} is now ${STUDENT_STATUS_LABELS[v].toLowerCase()}`);
              }}>
              {st.status === 'graduated' && <option value="graduated">Graduated</option>}
              {(['applicant', 'enrolled', 'deferred', 'withdrawn'] as const).map((v) => <option key={v} value={v}>{STUDENT_STATUS_LABELS[v]}</option>)}
            </select>
          </label>
          {course.levels.length > 0 && (
            <label className="field"><span>Level</span>
              <select value={st.level} disabled={!canEdit} onChange={(e) => change({ level: e.target.value }, 'Level saved')}>
                <option value="">None</option>
                {course.levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field"><span>Intake</span>
          <select value={st.intakeId} disabled={!canEdit} onChange={(e) => change({ intakeId: e.target.value }, 'Intake saved')}>
            {s.intakes.filter((i) => i.courseId === st.courseId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        {st.enrolledOn && <p className="small muted">Started {formatDateKey(st.enrolledOn)}{st.withdrawnOn ? ` · withdrew ${formatDateKey(st.withdrawnOn)}` : ''}{st.graduatedOn ? ` · graduated ${formatDateKey(st.graduatedOn)}` : ''}</p>}
      </section>

      <section className="card stack">
        <h2>Attendance</h2>
        <p><span className="big-number">{pct(att.percent)}</span> <span className="muted small">{att.held ? `${att.attended} of ${att.held} classes` : 'No classes marked yet'}</span></p>
        {att.percent != null && att.held >= 3 && att.percent < s.settings.attendanceThreshold && <p className="notice notice-warn small">Below the {s.settings.attendanceThreshold}% threshold.</p>}
      </section>

      <section className="card stack">
        <h2>Results</h2>
        {results.length === 0 ? <p className="muted small">No units set up for {course.name}{st.level ? ` ${st.level}` : ''} yet.</p> : (
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Unit</th><th className="num">Mark</th><th>Grade</th></tr></thead>
              <tbody>{results.map((r) => <tr key={r.unitId}><td>{r.name}</td><td className="num">{r.percent == null ? '–' : `${r.percent}%`}</td><td>{r.grade ?? 'Not assessed'}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="small">Overall: <strong>{overall.percent == null ? 'not yet assessed' : `${overall.percent}% (${overall.grade})`}</strong></p>
        <div className="chips">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void makePdf('report_card')}>{busy === 'report_card' ? 'Making…' : 'Report card'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void makePdf('transcript')}>{busy === 'transcript' ? 'Making…' : 'Transcript'}</button>
        </div>
      </section>

      {s.feesAllowed && (
        <section className="card stack">
          <h2>Fees</h2>
          <p><span className="big-number">{money(org, Math.abs(bal?.balanceCents ?? 0))}</span> <span className="muted small">{(bal?.balanceCents ?? 0) > 0 ? 'to pay' : (bal?.balanceCents ?? 0) < 0 ? 'paid ahead' : 'nothing owed'}</span></p>
          <p className="small muted">Billed {money(org, bal?.billedCents ?? 0)} · paid {money(org, bal?.paidCents ?? 0)}</p>
          {invoices.length > 0 && <ul className="link-list">{invoices.map((i) => <li key={i.id}><div><span className="link-title">{i.label}</span><span className="link-detail">{money(org, i.totalCents)}{i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ''}</span></div></li>)}</ul>}
          {gifts.filter((g) => g.fundId === 'school_fees' && g.status === 'confirmed').length > 0 && (
            <ul className="link-list">
              {gifts.filter((g) => g.fundId === 'school_fees' && g.status === 'confirmed').map((g) => (
                <li key={g.id}><Link to={`/giving/${org.id}/${g.id}`}><span className="link-title">{formatMoney(g.amountCents, org.currency || 'KES')}</span><span className="link-detail">{formatDateKey(g.date)} · {g.receiptNumber ?? 'receipt pending'}</span></Link></li>
              ))}
            </ul>
          )}
          <div className="chips">
            {can('gifts.write') && <Link to="/giving/new" state={{ prefill: { personId: st.id, giverName: name, fundId: 'school_fees' } }} className="btn btn-primary">Record a payment</Link>}
            <button type="button" className="btn" disabled={!!busy} onClick={() => void makePdf('statement')}>{busy === 'statement' ? 'Making…' : 'Fee statement'}</button>
            {(bal?.balanceCents ?? 0) > 0 && can('followups.manage') && <button type="button" className="btn" onClick={() => setReminder(true)}>Remind sponsor</button>}
          </div>
        </section>
      )}

      {!s.feesAllowed && s.balancesAllowed && (
        <section className="card stack">
          <h2>Fee balance</h2>
          <p><span className="big-number">{money(org, Math.abs(bal?.balanceCents ?? 0))}</span> <span className="muted small">{(bal?.balanceCents ?? 0) > 0 ? 'to pay' : (bal?.balanceCents ?? 0) < 0 ? 'paid ahead' : 'nothing owed'}</span></p>
        </section>
      )}

      <section className="card stack">
        <h2>Sponsor or guardian</h2>
        {(st.sponsors ?? []).length === 0 ? <p className="muted small">None saved.</p> : (
          <ul className="link-list">
            {(st.sponsors ?? []).map((sp, i) => (
              <li key={i}><a href={`tel:${sp.phone}`}><span className="link-title">{sp.name}{sp.relation ? ` (${sp.relation})` : ''}</span><span className="link-detail">{formatPhone(sp.phone)} · {sp.whatsapp ? 'agreed to WhatsApp' : 'call only'}</span></a></li>
            ))}
          </ul>
        )}
      </section>

      {(cert || outcomes.length > 0) && (
        <section className="card stack">
          <h2>Graduation</h2>
          {cert && <p>Certificate <strong>{cert.serial ?? 'number pending'}</strong> issued {formatDateKey(cert.issuedOn)}.</p>}
          {cert && <CertificateActions orgId={org.id} cert={cert} canManage={can('school.manage') || can('settings.manage')} email={s.byId(st.id)?.email} />}
          <ul className="link-list">
            {outcomes.map((o) => <li key={o.id}><div><span className="link-title">{o.months}-month check</span><span className="link-detail">{o.status ? `${OUTCOME_LABELS[o.status]}${o.note ? ` · ${o.note}` : ''}` : `due ${formatDateKey(o.due)}`}</span></div></li>)}
          </ul>
        </section>
      )}

      {reminder && <FeeReminderSheet org={org} studentId={st.id} studentName={name} sponsors={st.sponsors ?? []} balanceCents={bal?.balanceCents ?? 0} onClose={() => setReminder(false)} />}
      {can('pastoral.read') && <PrivateCard orgId={org.id} studentId={st.id} />}
    </div>
  );
}

/** Identity numbers some regulators ask for. Only the pastor can see or change them. */
function PrivateCard({ orgId, studentId }: { orgId: string; studentId: string }) {
  const toast = useToast();
  const [exists, setExists] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    return onSnapshot(doc(db, 'organizations', orgId, 'studentPrivate', studentId), (snap) => {
      setExists(snap.exists());
      if (snap.exists()) { setIdNumber(snap.get('idNumber') ?? ''); setNotes(snap.get('notes') ?? ''); }
      setReady(true);
    }, () => setReady(true));
  }, [orgId, studentId]);
  function save() {
    saveStudentPrivate(orgId, studentId, { idNumber: idNumber.trim().slice(0, 40), notes: notes.trim().slice(0, 2000) }, exists).catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }
  return (
    <section className="card stack">
      <h2>Identity number (pastor only)</h2>
      <p className="small muted">For regulators that ask for it. Other staff cannot see this.</p>
      <label className="field"><span>ID or passport number</span><input value={idNumber} disabled={!ready} onChange={(e) => setIdNumber(e.target.value)} /></label>
      <label className="field"><span>Private notes</span><textarea rows={3} value={notes} disabled={!ready} onChange={(e) => setNotes(e.target.value)} /></label>
      <button type="button" className="btn align-start" disabled={!ready} onClick={save}>Save</button>
    </section>
  );
}
