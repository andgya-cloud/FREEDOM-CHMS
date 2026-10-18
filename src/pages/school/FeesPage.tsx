import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { billStudents, saveFeeStructure, voidInvoice } from '../../lib/schoolWrites';
import { csvFile } from '../../lib/schoolPdf';
import { downloadFile } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { parseAmount } from '../../../functions/src/shared/giving';
import { arrearsList, collectionRate, invoiceTotal, type FeeItem } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function FeesPage() {
  return <SchoolGate title="Fees">{(org) => <Fees org={org} />}</SchoolGate>;
}

function Fees({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  if (!s.feesAllowed) return <div className="page narrow"><h1>Fees</h1><p>Fees are for the pastor and the people the pastor has given access.</p></div>;

  const arrears = arrearsList(s.balances, s.today);
  const billed = s.balances.reduce((a, b) => a + b.billedCents, 0);
  const paid = s.balances.reduce((a, b) => a + b.paidCents, 0);

  function download() {
    const rows = arrears.map((a) => {
      const st = s.students.find((x) => x.id === a.studentId);
      return [st?.admissionNo ?? '', s.nameOf(a.studentId), st ? s.courseName(st.courseId) : '', (a.balanceCents / 100).toFixed(2), a.overdue ? 'Overdue' : ''];
    });
    downloadFile(csvFile(`Fee arrears ${s.today}.csv`, [['Admission number', 'Name', 'Programme', 'Balance', 'Overdue'], ...rows]));
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Fees</h1>
        {can('gifts.write') && <Link to="/giving/import" className="btn btn-quiet">Import Paybill statement</Link>}
      </div>
      <SchoolNav feesAllowed />
      <ul className="tiles">
        <li><div className="tile"><span className="tile-label">Billed</span><span className="tile-value">{money(org, billed)}</span></div></li>
        <li><div className="tile"><span className="tile-label">Paid</span><span className="tile-value">{money(org, paid)}</span></div></li>
        <li><div className="tile"><span className="tile-label">Collected</span><span className="tile-value">{pct(collectionRate(billed, paid))}</span></div></li>
        <li><div className="tile"><span className="tile-label">Owed</span><span className="tile-value">{money(org, arrears.reduce((a, b) => a + b.balanceCents, 0))}</span></div></li>
      </ul>

      <section className="card stack">
        <div className="card-head"><h2>Arrears</h2>{arrears.length > 0 && <button type="button" className="btn btn-quiet" onClick={download}>Download</button>}</div>
        <p className="small muted">Students who owe money, largest first. Payments recorded as School fees for the student are counted automatically.</p>
        {arrears.length === 0 ? <p className="muted">Nobody owes fees.</p> : (
          <ul className="link-list">
            {arrears.map((a) => (
              <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{s.nameOf(a.studentId)}</span><span className="link-detail">{money(org, a.balanceCents)}{a.overdue ? ' · overdue' : ''}</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      {can('gifts.write') && <Billing org={org} s={s} />}
      <Invoices org={org} s={s} canVoid={can('gifts.write')} />
    </div>
  );
}

type Page = ReturnType<typeof useSchoolPage>;

function Billing({ org, s }: { org: Organization; s: Page }) {
  const toast = useToast();
  const [courseId, setCourseId] = useState('');
  const [intakeId, setIntakeId] = useState('');
  const [items, setItems] = useState<{ name: string; amount: string }[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [label, setLabel] = useState('Tuition');
  const [due, setDue] = useState('');
  const structure = s.structures.find((x) => x.courseId === courseId && x.intakeId === intakeId);

  if (courseId && intakeId && loadedFor !== `${courseId}_${intakeId}`) {
    setLoadedFor(`${courseId}_${intakeId}`);
    setItems((structure?.items ?? []).map((i) => ({ name: i.name, amount: String(i.amountCents / 100) })));
  }

  const parsed: FeeItem[] = items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim().slice(0, 80), amountCents: parseAmount(i.amount) ?? 0 }));
  const valid = parsed.length > 0 && parsed.every((i) => i.amountCents > 0);

  function saveStructure() {
    if (!valid) return toast.show('Give every fee a name and an amount.');
    saveFeeStructure(org.id, courseId, intakeId, parsed, !!structure).catch((err) => toast.show(friendlyError(err)));
    toast.show('Fee structure saved');
  }

  function bill() {
    if (!valid || !label.trim()) return toast.show('Save the fees and give the bill a name first.');
    const existing = new Set(s.invoices.map((i) => i.id));
    const ids = s.students.filter((st) => st.intakeId === intakeId && st.status === 'enrolled').map((st) => st.id);
    const { count, synced } = billStudents(org.id, ids, parsed, label.trim().slice(0, 60), due || null, intakeId, existing);
    synced.catch((err) => toast.show(friendlyError(err)));
    toast.show(count ? `${count} bill${count === 1 ? '' : 's'} made` : 'Everyone in this intake already has this bill.');
  }

  return (
    <section className="card stack">
      <h2>Fee structure and billing</h2>
      <div className="field-row">
        <label className="field"><span>Programme</span>
          <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setIntakeId(''); setLoadedFor(''); }}>
            <option value="">Choose…</option>{s.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Intake</span>
          <select value={intakeId} onChange={(e) => { setIntakeId(e.target.value); setLoadedFor(''); }}>
            <option value="">Choose…</option>{s.intakes.filter((i) => i.courseId === courseId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      </div>
      {courseId && intakeId && (
        <>
          <h3>Fees for this intake</h3>
          {items.map((it, i) => (
            <div key={i} className="field-row">
              <label className="field"><span>Fee</span><input value={it.name} onChange={(e) => setItems((l) => l.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} placeholder="Tuition, Exam fee, Materials" /></label>
              <label className="field"><span>Amount</span><input inputMode="decimal" value={it.amount} onChange={(e) => setItems((l) => l.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} /></label>
              <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setItems((l) => l.filter((_, n) => n !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-quiet align-start" onClick={() => setItems((l) => [...l, { name: '', amount: '' }])}>Add a fee</button>
          <p className="small">Total per student: <strong>{money(org, invoiceTotal(parsed))}</strong></p>
          <button type="button" className="btn align-start" onClick={saveStructure}>Save fee structure</button>
          <h3>Bill the intake</h3>
          <div className="field-row">
            <label className="field"><span>Bill name</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            <label className="field"><span>Due date</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <button type="button" className="btn btn-primary align-start" onClick={bill}>Bill all enrolled students</button>
          <p className="small muted">Students who already have this bill are skipped, so it is safe to press again after new students join.</p>
        </>
      )}
    </section>
  );
}

function Invoices({ org, s, canVoid }: { org: Organization; s: Page; canVoid: boolean }) {
  const toast = useToast();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const recent = [...s.invoices].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)).filter((i) => i.status !== 'void').slice(0, 30);
  return (
    <section className="card stack">
      <h2>Recent bills</h2>
      {recent.length === 0 ? <p className="muted small">No bills yet.</p> : (
        <ul className="link-list">
          {recent.map((i) => (
            <li key={i.id}>
              <div>
                <Link to={`/school/students/${i.studentId}`}><span className="link-title">{s.nameOf(i.studentId)} · {i.label}</span><span className="link-detail">{money(org, i.totalCents)}{i.dueDate ? ` · due ${formatDateKey(i.dueDate)}` : ''}</span></Link>
                {canVoid && (voiding === i.id ? (
                  <div className="field-row">
                    <label className="field"><span>Why is it cancelled?</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                    <button type="button" className="btn btn-danger align-start" disabled={!reason.trim()} onClick={() => { voidInvoice(org.id, i.id, reason.trim()).catch((err) => toast.show(friendlyError(err))); setVoiding(null); setReason(''); toast.show('Bill cancelled'); }}>Cancel the bill</button>
                  </div>
                ) : <button type="button" className="btn btn-quiet danger-text" onClick={() => setVoiding(i.id)}>Cancel this bill</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
