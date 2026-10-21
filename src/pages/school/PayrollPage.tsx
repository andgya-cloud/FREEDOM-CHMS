import { useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { usePayroll, type PayRun, type StaffRow } from '../../state/usePayroll';
import { approvePayRun, preparePayRun, reviewPayRun, savePayrollRates, saveStaff, type StaffInput } from '../../lib/payrollWrites';
import { payslipPdf } from '../../lib/payrollPdf';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import {
  loanRepaidCents, p9For, payrollCsv, preparePayroll, RETURN_LABELS, returnCsv,
  type MonthAdjustment, type PayItem, type PayLine, type PayrollLoan, type PayrollRates, type ReturnKind,
} from '../../../functions/src/shared/payroll';
import { normalizePhone } from '../../../functions/src/shared/phone';
import { whatsappLink } from '../../../functions/src/shared/followups';
import { parseAmountCents } from '../../../functions/src/shared/pettyCash';
import { money, SchoolGate } from './common';
import type { Organization } from '../../state/OrgContext';

const BASE = '/school/payroll';
const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const kes = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, '');
const num = (cents: number) => (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const itemsTotal = (items: readonly PayItem[]) => items.reduce((t, i) => t + i.amountCents, 0);

function NoAccess() {
  return <div className="page narrow"><h1>Payroll</h1><p>Payroll is for the people the pastor has given access.</p></div>;
}

function PayrollNav() {
  return (
    <nav className="chips no-print" aria-label="Payroll">
      <Link to={BASE} className="chip">Pay runs</Link>
      <Link to={`${BASE}/staff`} className="chip">Staff pay details</Link>
    </nav>
  );
}

export function PayrollPage() {
  return <SchoolGate title="Payroll">{(org) => <PayrollHome org={org} />}</SchoolGate>;
}

function PayrollHome({ org }: { org: Organization }) {
  const p = usePayroll(org);
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  if (!p.any) return <NoAccess />;
  const active = p.staff.filter((s) => s.active);
  const latest = p.runs[0];
  const preview = preparePayroll(active, p.rates).totals;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Payroll</h1>
      </div>
      <PayrollNav />
      <div className="petty-stats">
        <div className="petty-stat petty-stat-budget"><span>Staff on payroll</span><strong>{active.length}</strong></div>
        <div className="petty-stat petty-stat-spent"><span>Monthly gross</span><strong>{money(org, preview.grossCents)}</strong></div>
        <div className="petty-stat petty-stat-left"><span>Monthly net pay</span><strong>{money(org, preview.netCents)}</strong></div>
        <div className="petty-stat payroll-stat-cost"><span>Cost to ADIA</span><strong>{money(org, preview.employerCostCents)}</strong></div>
      </div>
      {p.canManage && (
        <section className="card stack">
          <h2>Prepare a pay run</h2>
          {active.length === 0 ? <p className="muted">Add staff pay details first. <Link to={`${BASE}/staff`}>Add staff</Link></p> : (
            <div className="row-actions">
              <label className="field"><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
              <button type="button" className="btn btn-primary" disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={() => navigate(`${BASE}/${month}`)}>Open {month && /^\d{4}-\d{2}$/.test(month) ? monthName(month) : 'month'}</button>
            </div>
          )}
        </section>
      )}
      <section className="card stack">
        <h2>Pay runs</h2>
        {p.runs.length === 0 ? <p className="muted small">No pay run yet.</p> : (
          <ul className="link-list">
            {p.runs.map((r) => (
              <li key={r.id}>
                <Link to={`${BASE}/${r.month}`}>
                  <span className="link-title">{monthName(r.month)} · {r.status === 'approved' ? 'Approved' : 'Waiting for approval'}</span>
                  <span className="link-detail">{r.totals.staff} staff · net {money(org, r.totals.netCents)} · prepared by {r.preparedByName}{r.approved ? ` · approved by ${r.approved.name}` : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {latest && latest.status === 'draft' && p.canApprove && latest.preparedBy !== p.uid && <p className="small">{monthName(latest.month)} is waiting for your approval.</p>}
      </section>
      <RatesCard org={org} rates={p.rates} saved={p.ratesSaved} canEdit={p.canApprove} />
      {p.loading && <p className="muted small">Loading…</p>}
    </div>
  );
}

const pctText = (r: number) => String(Math.round(r * 10000) / 100);

function RatesCard({ org, rates, saved, canEdit }: { org: Organization; rates: PayrollRates; saved: boolean; canEdit: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    nssf: pctText(rates.nssfRate), nssfLimit: kes(rates.nssfUpperLimitCents), shif: pctText(rates.shifRate),
    shifMin: kes(rates.shifMinimumCents), housing: pctText(rates.housingRate), relief: kes(rates.personalReliefCents),
  });
  const pct = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) && Number(s) <= 50 ? Number(s) / 100 : null);
  const save = () => {
    const next = {
      nssfRate: pct(f.nssf), nssfUpperLimitCents: parseAmountCents(f.nssfLimit), shifRate: pct(f.shif),
      shifMinimumCents: parseAmountCents(f.shifMin), housingRate: pct(f.housing), personalReliefCents: parseAmountCents(f.relief),
    };
    if (Object.values(next).some((v) => v == null)) { toast.show('Please check the numbers.'); return; }
    savePayrollRates(org.id, next as PayrollRates, saved).catch((err) => toast.show(friendlyError(err)));
    toast.show('Rates saved');
    setEditing(false);
  };
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card stack">
      <h2>Deduction rates</h2>
      {!editing ? (
        <>
          <ul className="payroll-rates">
            <li><span>NSSF</span><strong>{pctText(rates.nssfRate)}% of pay up to {money(org, rates.nssfUpperLimitCents)}</strong></li>
            <li><span>SHIF</span><strong>{pctText(rates.shifRate)}% of gross, at least {money(org, rates.shifMinimumCents)}</strong></li>
            <li><span>Housing Levy</span><strong>{pctText(rates.housingRate)}% of gross</strong></li>
            <li><span>Personal relief</span><strong>{money(org, rates.personalReliefCents)} a month</strong></li>
            <li><span>PAYE</span><strong>10% to 35% by the KRA monthly bands</strong></li>
          </ul>
          <p className="muted small">{saved ? 'Set by the board.' : 'These are the rates in force from February 2025. Please check them with the accountant.'} The employer pays the same NSSF and Housing Levy on top.</p>
          {canEdit && <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>Change rates</button>}
        </>
      ) : (
        <>
          <div className="payroll-grid">
            <label className="field"><span>NSSF %</span><input inputMode="decimal" value={f.nssf} onChange={set('nssf')} /></label>
            <label className="field"><span>NSSF upper limit (KES)</span><input inputMode="decimal" value={f.nssfLimit} onChange={set('nssfLimit')} /></label>
            <label className="field"><span>SHIF %</span><input inputMode="decimal" value={f.shif} onChange={set('shif')} /></label>
            <label className="field"><span>SHIF minimum (KES)</span><input inputMode="decimal" value={f.shifMin} onChange={set('shifMin')} /></label>
            <label className="field"><span>Housing Levy %</span><input inputMode="decimal" value={f.housing} onChange={set('housing')} /></label>
            <label className="field"><span>Personal relief (KES)</span><input inputMode="decimal" value={f.relief} onChange={set('relief')} /></label>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={save}>Save rates</button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

export function PayrollStaffPage() {
  return <SchoolGate title="Staff pay details">{(org) => <StaffList org={org} />}</SchoolGate>;
}

function StaffList({ org }: { org: Organization }) {
  const p = usePayroll(org);
  const [adding, setAdding] = useState(false);
  if (!p.any) return <NoAccess />;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Staff pay details</h1>
      </div>
      <PayrollNav />
      {p.canManage && !adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add staff member</button>}
      {adding && <StaffForm org={org} row={null} runs={p.runs} onDone={() => setAdding(false)} />}
      <section className="card stack">
        <h2>Staff</h2>
        {p.staff.length === 0 ? <p className="muted small">No staff added yet.</p> : (
          <ul className="link-list">
            {p.staff.map((s) => {
              const gross = s.basicCents + itemsTotal(s.allowances);
              const owing = (s.loans ?? []).reduce((t, l) => t + Math.max(0, l.principalCents - loanRepaidCents(s.id, l.id, p.runs)), 0);
              return (
                <li key={s.id}>
                  <Link to={`${BASE}/staff/${s.id}`}>
                    <span className="link-title">{s.name}{s.jobTitle ? ` · ${s.jobTitle}` : ''}{s.active ? '' : ' · not on payroll'}</span>
                    <span className="link-detail">Gross {money(org, gross)}{owing > 0 ? ` · loans owing ${money(org, owing)}` : ''}{s.staffNo ? ` · No. ${s.staffNo}` : ''}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {p.loading && <p className="muted small">Loading…</p>}
    </div>
  );
}

interface ItemDraft { key: number; name: string; amount: string }
const toDraft = (items: readonly PayItem[]): ItemDraft[] => items.map((i, n) => ({ key: n, name: i.name, amount: kes(i.amountCents) }));
/** The filled-in rows as pay items, or null when a row is half filled. */
const draftItems = (list: ItemDraft[]): PayItem[] | null => {
  const out: PayItem[] = [];
  for (const i of list) {
    if (!i.name.trim() && !i.amount.trim()) continue;
    const c = parseAmountCents(i.amount);
    if (!i.name.trim() || c == null) return null;
    out.push({ name: i.name.trim(), amountCents: c });
  }
  return out;
};

function ItemsEditor({ title, items, onChange, hint }: { title: string; items: ItemDraft[]; onChange: (v: ItemDraft[]) => void; hint: string }) {
  const update = (key: number, patch: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  return (
    <fieldset className="stack payroll-items">
      <legend>{title}</legend>
      {items.length === 0 && <p className="muted small">{hint}</p>}
      {items.map((i) => (
        <div key={i.key} className="payroll-item">
          <input aria-label="Name" placeholder="Name" value={i.name} maxLength={60} onChange={(e) => update(i.key, { name: e.target.value })} />
          <input aria-label="Amount in KES" placeholder="KES" inputMode="decimal" value={i.amount} onChange={(e) => update(i.key, { amount: e.target.value })} />
          <button type="button" className="btn btn-quiet" aria-label="Remove" onClick={() => onChange(items.filter((x) => x.key !== i.key))}>×</button>
        </div>
      ))}
      {items.length < 20 && <button type="button" className="btn btn-quiet" onClick={() => onChange([...items, { key: Date.now(), name: '', amount: '' }])}>Add</button>}
    </fieldset>
  );
}

interface LoanDraft { id: string; name: string; principal: string; instalment: string; startMonth: string }

function LoansEditor({ org, staffId, loans, runs, onChange }: { org: Organization; staffId: string; loans: LoanDraft[]; runs: PayRun[]; onChange: (v: LoanDraft[]) => void }) {
  const update = (id: string, patch: Partial<LoanDraft>) => onChange(loans.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  return (
    <fieldset className="stack payroll-items">
      <legend>Loans and salary advances (repaid monthly)</legend>
      {loans.length === 0 && <p className="muted small">The monthly instalment is taken from each pay run until the loan is cleared.</p>}
      {loans.map((l) => {
        const principal = parseAmountCents(l.principal) ?? 0;
        const repaid = loanRepaidCents(staffId, l.id, runs);
        return (
          <div key={l.id} className="payroll-loan">
            <input aria-label="Loan name" placeholder="For example Salary advance" value={l.name} maxLength={60} onChange={(e) => update(l.id, { name: e.target.value })} />
            <label className="field"><span>Amount lent (KES)</span><input inputMode="decimal" value={l.principal} onChange={(e) => update(l.id, { principal: e.target.value })} /></label>
            <label className="field"><span>Repay each month (KES)</span><input inputMode="decimal" value={l.instalment} onChange={(e) => update(l.id, { instalment: e.target.value })} /></label>
            <label className="field"><span>Starting</span><input type="month" value={l.startMonth} onChange={(e) => update(l.id, { startMonth: e.target.value })} /></label>
            <p className="small muted payroll-loan-balance">Repaid {money(org, repaid)} · balance {money(org, Math.max(0, principal - repaid))}</p>
            <button type="button" className="btn btn-quiet" aria-label="Remove loan" onClick={() => onChange(loans.filter((x) => x.id !== l.id))}>×</button>
          </div>
        );
      })}
      {loans.length < 20 && <button type="button" className="btn btn-quiet" onClick={() => onChange([...loans, { id: `L${Date.now().toString(36)}`, name: '', principal: '', instalment: '', startMonth: thisMonth() }])}>Add a loan or advance</button>}
    </fieldset>
  );
}

function StaffForm({ org, row, runs, onDone }: { org: Organization; row: StaffRow | null; runs: PayRun[]; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: row?.name ?? '', staffNo: row?.staffNo ?? '', jobTitle: row?.jobTitle ?? '', kraPin: row?.kraPin ?? '',
    nssfNo: row?.nssfNo ?? '', shifNo: row?.shifNo ?? '', idNo: row?.idNo ?? '', phone: row?.phone ?? '', email: row?.email ?? '',
    paymentDetails: row?.paymentDetails ?? '', basic: row ? kes(row.basicCents) : '', active: row?.active ?? true,
  });
  const [allowances, setAllowances] = useState<ItemDraft[]>(toDraft(row?.allowances ?? []));
  const [deductions, setDeductions] = useState<ItemDraft[]>(toDraft(row?.deductions ?? []));
  const [loans, setLoans] = useState<LoanDraft[]>((row?.loans ?? []).map((l) => ({ id: l.id, name: l.name, principal: kes(l.principalCents), instalment: kes(l.instalmentCents), startMonth: l.startMonth })));
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const basicCents = parseAmountCents(f.basic);
    const a = draftItems(allowances);
    const d = draftItems(deductions);
    if (!f.name.trim()) { toast.show('Please enter the name.'); return; }
    if (basicCents == null) { toast.show('Please enter the basic salary in KES.'); return; }
    if (!a || !d) { toast.show('Each allowance and deduction needs a name and an amount.'); return; }
    const phone = f.phone.trim() ? normalizePhone(f.phone) : '';
    if (phone == null) { toast.show('Please check the phone number.'); return; }
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { toast.show('Please check the email address.'); return; }
    const l: PayrollLoan[] = [];
    for (const x of loans) {
      const principalCents = parseAmountCents(x.principal);
      const instalmentCents = parseAmountCents(x.instalment);
      if (!x.name.trim() || !principalCents || !instalmentCents || !/^\d{4}-\d{2}$/.test(x.startMonth)) { toast.show('Each loan needs a name, the amount, the monthly repayment and a starting month.'); return; }
      l.push({ id: x.id, name: x.name.trim(), principalCents, instalmentCents, startMonth: x.startMonth });
    }
    const input: StaffInput = {
      name: f.name.trim(), staffNo: f.staffNo.trim(), jobTitle: f.jobTitle.trim(), kraPin: f.kraPin.trim().toUpperCase(),
      nssfNo: f.nssfNo.trim(), shifNo: f.shifNo.trim(), idNo: f.idNo.trim(), phone, email: f.email.trim(),
      paymentDetails: f.paymentDetails.trim(), basicCents, allowances: a, deductions: d, loans: l, active: f.active,
    };
    saveStaff(org.id, row?.id ?? null, input).catch((err) => toast.show(friendlyError(err)));
    toast.show(row ? 'Saved' : 'Staff member added');
    onDone();
  };
  return (
    <section className="card stack">
      <h2>{row ? `Edit ${row.name}` : 'Add staff member'}</h2>
      <div className="payroll-grid">
        <label className="field"><span>Full name</span><input value={f.name} maxLength={120} onChange={set('name')} /></label>
        <label className="field"><span>Job title</span><input value={f.jobTitle} maxLength={80} onChange={set('jobTitle')} /></label>
        <label className="field"><span>Staff number</span><input value={f.staffNo} maxLength={40} onChange={set('staffNo')} /></label>
        <label className="field"><span>National ID number</span><input value={f.idNo} maxLength={20} onChange={set('idNo')} /></label>
        <label className="field"><span>KRA PIN</span><input value={f.kraPin} maxLength={20} onChange={set('kraPin')} /></label>
        <label className="field"><span>NSSF number</span><input value={f.nssfNo} maxLength={30} onChange={set('nssfNo')} /></label>
        <label className="field"><span>SHIF number</span><input value={f.shifNo} maxLength={30} onChange={set('shifNo')} /></label>
        <label className="field"><span>Phone (for WhatsApp payslips)</span><input type="tel" value={f.phone} maxLength={20} onChange={set('phone')} /></label>
        <label className="field"><span>Email (for emailed payslips)</span><input type="email" value={f.email} maxLength={120} onChange={set('email')} /></label>
        <label className="field"><span>Pay to (bank account or M-Pesa number)</span><input value={f.paymentDetails} maxLength={200} onChange={set('paymentDetails')} /></label>
        <label className="field"><span>Basic salary a month (KES)</span><input inputMode="decimal" value={f.basic} onChange={set('basic')} /></label>
      </div>
      <ItemsEditor title="Allowances (added to pay every month)" items={allowances} onChange={setAllowances} hint="For example house or transport allowance." />
      <ItemsEditor title="Other deductions (taken after tax every month)" items={deductions} onChange={setDeductions} hint="For example welfare or SACCO contributions." />
      <LoansEditor org={org} staffId={row?.id ?? ''} loans={loans} runs={runs} onChange={setLoans} />
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> On the payroll</label>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </section>
  );
}

export function PayrollPersonPage() {
  return <SchoolGate title="Staff member">{(org) => <PersonView org={org} />}</SchoolGate>;
}

function PersonView({ org }: { org: Organization }) {
  const { staffId = '' } = useParams();
  const p = usePayroll(org);
  const [editing, setEditing] = useState(false);
  const years = useMemo(() => [...new Set(p.runs.filter((r) => r.status === 'approved').map((r) => r.month.slice(0, 4)))].sort().reverse(), [p.runs]);
  const [year, setYear] = useState('');
  if (!p.any) return <NoAccess />;
  const s = p.staff.find((x) => x.id === staffId);
  if (!s) return <div className="page narrow"><h1>Staff member</h1><p>{p.loading ? 'Loading…' : 'Not found.'} <Link to={`${BASE}/staff`}>Back to staff</Link></p></div>;
  const y = year || years[0] || String(new Date().getFullYear());
  const history = p.runs.filter((r) => r.lines.some((l) => l.staffId === s.id));
  const p9 = p9For(s.id, y, p.runs);
  return (
    <div className="page narrow payroll-person">
      <div className="page-head no-print"><h1>{s.name}</h1></div>
      <PayrollNav />
      {editing ? <StaffForm org={org} row={s} runs={p.runs} onDone={() => setEditing(false)} /> : (
        <section className="card stack no-print">
          <ul className="payroll-rates">
            <li><span>Job title</span><strong>{s.jobTitle || '–'}</strong></li>
            <li><span>Basic salary</span><strong>{money(org, s.basicCents)}</strong></li>
            <li><span>Allowances</span><strong>{money(org, itemsTotal(s.allowances))}</strong></li>
            <li><span>ID · KRA PIN</span><strong>{s.idNo || '–'} · {s.kraPin || '–'}</strong></li>
            <li><span>NSSF · SHIF</span><strong>{s.nssfNo || '–'} · {s.shifNo || '–'}</strong></li>
            <li><span>Phone · Email</span><strong>{s.phone || '–'} · {s.email || '–'}</strong></li>
            {(s.loans ?? []).map((l) => {
              const repaid = loanRepaidCents(s.id, l.id, p.runs);
              return <li key={l.id}><span>{l.name}</span><strong>{money(org, Math.max(0, l.principalCents - repaid))} left of {money(org, l.principalCents)}</strong></li>;
            })}
          </ul>
          {p.canManage && <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>Edit pay details</button>}
        </section>
      )}
      <section className="card stack no-print">
        <h2>Pay history</h2>
        {history.length === 0 ? <p className="muted small">No pay runs yet.</p> : (
          <div className="table-scroll">
            <table className="table payroll-table">
              <thead><tr><th>Month</th><th className="num">Gross</th><th className="num">PAYE</th><th className="num">Other deductions</th><th className="num">Net pay</th><th>Status</th></tr></thead>
              <tbody>
                {history.map((r) => {
                  const l = r.lines.find((x) => x.staffId === s.id)!;
                  return (
                    <tr key={r.month}><td><Link to={`${BASE}/${r.month}`}>{monthName(r.month)}</Link></td><td className="num">{num(l.grossCents)}</td><td className="num">{num(l.payeCents)}</td>
                      <td className="num">{num(itemsTotal(l.deductions))}</td><td className="num"><strong>{num(l.netCents)}</strong></td><td>{r.status === 'approved' ? 'Approved' : 'Draft'}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card stack p9">
        <div className="p9-head">
          <div>
            <h2>P9 tax deduction card · {y}</h2>
            <p className="small">Employer: {org.name} · Employee: {s.name} · KRA PIN {s.kraPin || '–'}</p>
          </div>
          <div className="row-actions no-print">
            <select aria-label="Year" value={y} onChange={(e) => setYear(e.target.value)}>
              {(years.length ? years : [y]).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print P9</button>
          </div>
        </div>
        {p9.rows.length === 0 ? <p className="muted small">No approved pay runs in {y}.</p> : (
          <div className="table-scroll">
            <table className="table payroll-table">
              <thead><tr><th>Month</th><th className="num">Basic</th><th className="num">Benefits</th><th className="num">Gross</th><th className="num">NSSF</th><th className="num">SHIF</th>
                <th className="num">Housing</th><th className="num">Taxable</th><th className="num">Tax</th><th className="num">Relief</th><th className="num">PAYE</th></tr></thead>
              <tbody>
                {[...p9.rows, p9.totals].map((r) => (
                  <tr key={r.month} className={r.month === 'Total' ? 'p9-total' : undefined}>
                    <td>{r.month === 'Total' ? 'Total' : monthName(r.month)}</td><td className="num">{num(r.basicCents)}</td><td className="num">{num(r.benefitsCents)}</td>
                    <td className="num">{num(r.grossCents)}</td><td className="num">{num(r.nssfCents)}</td><td className="num">{num(r.shifCents)}</td><td className="num">{num(r.housingCents)}</td>
                    <td className="num">{num(r.taxableCents)}</td><td className="num">{num(r.taxCents)}</td><td className="num">{num(r.reliefCents)}</td><td className="num"><strong>{num(r.payeCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">From the approved pay runs. Amounts are in KES.</p>
      </section>
    </div>
  );
}

export function PayrollRunPage() {
  return <SchoolGate title="Pay run">{(org) => <RunView org={org} />}</SchoolGate>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stampDate = (t: unknown) => (t && typeof (t as { toDate?: unknown }).toDate === 'function'
  ? (t as { toDate: () => Date }).toDate().toLocaleDateString('en-KE', { dateStyle: 'medium' }) : '');

interface AdjDraft { earnings: ItemDraft[]; unpaid: ItemDraft[] }

function RunView({ org }: { org: Organization }) {
  const { month = '' } = useParams();
  const p = usePayroll(org);
  const { profile } = useAuth();
  const toast = useToast();
  const name = profile?.displayName ?? 'Staff';
  const run: PayRun | undefined = p.runs.find((r) => r.month === month);
  const [adj, setAdj] = useState<Record<string, AdjDraft> | null>(null);
  const [printMode, setPrintMode] = useState<'summary' | 'slips' | ''>('');
  // Starts from what was saved on the pay run, once it has loaded.
  const drafts: Record<string, AdjDraft> = adj ?? Object.fromEntries(Object.entries(run?.adjustments ?? {}).map(([id, a]) => [id, { earnings: toDraft(a.earnings), unpaid: toDraft(a.unpaid) }]));
  const adjustments = useMemo(() => {
    const out: Record<string, MonthAdjustment> = {};
    for (const [id, a] of Object.entries(drafts)) {
      const earnings = draftItems(a.earnings) ?? [];
      const unpaid = draftItems(a.unpaid) ?? [];
      if (earnings.length || unpaid.length) out[id] = { earnings, unpaid };
    }
    return out;
  }, [drafts]);
  if (!p.any) return <NoAccess />;
  if (!/^\d{4}-\d{2}$/.test(month)) return <div className="page narrow"><h1>Pay run</h1><p>That month was not found. <Link to={BASE}>Back to payroll</Link></p></div>;
  const fresh = preparePayroll(p.staff, p.rates, { month, runs: p.runs, adjustments });
  const editable = p.canManage && (!run || run.status === 'draft');
  const shown = run && !adj ? { lines: run.lines, totals: run.totals } : fresh;
  const prepare = () => {
    if (fresh.lines.length === 0) { toast.show('Add staff pay details first.'); return; }
    if (Object.values(drafts).some((a) => !draftItems(a.earnings) || !draftItems(a.unpaid))) { toast.show('Each one-off amount needs a name and an amount.'); return; }
    preparePayRun(org.id, month, !!run, { ...fresh, rates: p.rates, adjustments }, name).catch((err) => toast.show(friendlyError(err)));
    setAdj(null);
    toast.show(run ? 'Prepared again from the latest details' : 'Pay run prepared');
  };
  const act = (write: Promise<unknown>, done: string) => { write.catch((err) => toast.show(friendlyError(err))); toast.show(done); };
  const print = (mode: 'summary' | 'slips') => { setPrintMode(mode); window.setTimeout(() => { window.print(); setPrintMode(''); }, 50); };
  const t = shown.totals;
  const notPreparer = run && run.preparedBy !== p.uid;
  return (
    <div className={`page narrow payroll-run${printMode ? ` print-${printMode}` : ''}`}>
      <div className="page-head no-print">
        <h1>Pay run · {monthName(month)}</h1>
      </div>
      <PayrollNav />
      <section className="card stack no-print">
        <ol className="payroll-steps">
          <li className={run ? 'done' : ''}><strong>Prepared</strong> {run ? `by ${run.preparedByName}` : 'not yet. This is a preview from the current staff details.'}</li>
          <li className={run?.reviewed ? 'done' : ''}><strong>Reviewed</strong> {run?.reviewed ? `by ${run.reviewed.name}` : 'not yet (optional)'}</li>
          <li className={run?.approved ? 'done' : ''}><strong>Approved</strong> {run?.approved ? `by ${run.approved.name}. It is locked.` : 'not yet'}</li>
        </ol>
        {adj && run && <p className="small payroll-warn">You changed this month's amounts. Press Prepare again to save them.</p>}
        <div className="row-actions">
          {editable && <button type="button" className="btn btn-primary" onClick={prepare}>{run ? 'Prepare again' : 'Prepare pay run'}</button>}
          {run && run.status === 'draft' && !run.reviewed && notPreparer && <button type="button" className="btn btn-quiet" onClick={() => act(reviewPayRun(org.id, month, name), 'Signed as reviewed')}>Sign as reviewed</button>}
          {run && run.status === 'draft' && p.canApprove && notPreparer && !adj && <button type="button" className="btn btn-primary" onClick={() => act(approvePayRun(org.id, month, name), 'Pay run approved')}>Approve pay run</button>}
          {run && run.status === 'draft' && run.preparedBy === p.uid && <span className="muted small">You prepared this, so someone else must review and approve it.</span>}
        </div>
      </section>
      <div className="petty-stats no-print">
        <div className="petty-stat petty-stat-budget"><span>Gross pay</span><strong>{money(org, t.grossCents)}</strong></div>
        <div className="petty-stat petty-stat-spent"><span>Deductions</span><strong>{money(org, t.grossCents - t.netCents)}</strong></div>
        <div className="petty-stat petty-stat-left"><span>Net pay</span><strong>{money(org, t.netCents)}</strong></div>
        <div className="petty-stat payroll-stat-cost"><span>Cost to ADIA</span><strong>{money(org, t.employerCostCents)}</strong></div>
      </div>
      {editable && (
        <section className="card stack no-print">
          <h2>This month only</h2>
          <p className="muted small">Bonus, overtime or arrears are added to pay and taxed. Days not worked are taken off before tax. Loan instalments are added on their own.</p>
          {p.staff.filter((s) => s.active).map((s) => {
            const d = drafts[s.id] ?? { earnings: [], unpaid: [] };
            const setD = (patch: Partial<AdjDraft>) => setAdj({ ...drafts, [s.id]: { ...d, ...patch } });
            const count = d.earnings.length + d.unpaid.length;
            return (
              <details key={s.id} className="payroll-adj" open={count > 0}>
                <summary>{s.name}{count ? ` · ${count} amount${count > 1 ? 's' : ''}` : ''}</summary>
                <ItemsEditor title="Add to pay (bonus, overtime, arrears)" items={d.earnings} onChange={(v) => setD({ earnings: v })} hint="Nothing extra this month." />
                <ItemsEditor title="Take off before tax (days not worked)" items={d.unpaid} onChange={(v) => setD({ unpaid: v })} hint="No days off without pay." />
              </details>
            );
          })}
        </section>
      )}
      <section className="card stack payroll-summary">
        <div className="print-only payroll-print-head"><strong>{org.name}</strong><br />Payroll summary · {monthName(month)}</div>
        <h2 className="no-print">Summary</h2>
        <div className="table-scroll">
          <table className="table payroll-table">
            <thead><tr><th>Name</th><th className="num">Gross</th><th className="num">NSSF</th><th className="num">SHIF</th><th className="num">Housing</th><th className="num">PAYE</th><th className="num">Other</th><th className="num">Net pay</th></tr></thead>
            <tbody>
              {shown.lines.map((l) => (
                <tr key={l.staffId}><td>{l.name}</td><td className="num">{num(l.grossCents)}</td><td className="num">{num(l.nssfCents)}</td><td className="num">{num(l.shifCents)}</td>
                  <td className="num">{num(l.housingCents)}</td><td className="num">{num(l.payeCents)}</td><td className="num">{num(itemsTotal(l.deductions))}</td><td className="num"><strong>{num(l.netCents)}</strong></td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Total ({t.staff})</th><th className="num">{num(t.grossCents)}</th><th className="num">{num(t.nssfCents)}</th><th className="num">{num(t.shifCents)}</th>
                <th className="num">{num(t.housingCents)}</th><th className="num">{num(t.payeCents)}</th><th className="num">{num(t.otherDeductionsCents)}</th><th className="num">{num(t.netCents)}</th></tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">The employer also pays NSSF {money(org, t.employerNssfCents)} and Housing Levy {money(org, t.employerHousingCents)}. Total cost to ADIA {money(org, t.employerCostCents)}. Amounts are in KES.</p>
        <div className="sign-block">
          {([['Prepared by', run ? { name: run.preparedByName, at: run.updatedAt } : null], ['Reviewed by', run?.reviewed ?? null], ['Approved by', run?.approved ?? null]] as const).map(([label, who]) => (
            <div key={label}>
              <span className="sign-label">{label}</span>
              <span className="sign-name">{who?.name ?? ''}</span>
              <span className="sign-line">Signature</span>
              <span className="sign-line">Date {who ? stampDate(who.at) : ''}</span>
            </div>
          ))}
        </div>
      </section>
      {run && (
        <section className="card stack no-print">
          <h2>Downloads and printing</h2>
          <div className="row-actions">
            <button type="button" className="btn btn-quiet" onClick={() => print('summary')}>Print summary with signatures</button>
            <button type="button" className="btn btn-quiet" onClick={() => print('slips')}>Print all payslips</button>
            <button type="button" className="btn btn-quiet" onClick={() => download(`ADIA-payroll-${month}.csv`, payrollCsv(month, run.lines))}>Bank list (CSV)</button>
          </div>
          <h3>Monthly returns</h3>
          <p className="muted small">Lists for entering or uploading on iTax (KRA), the NSSF portal and the SHA portal. They are due by the 9th of the next month.</p>
          <div className="row-actions">
            {(Object.keys(RETURN_LABELS) as ReturnKind[]).map((k) => (
              <button key={k} type="button" className="btn btn-quiet" onClick={() => download(`ADIA-${k}-${month}.csv`, returnCsv(k, month, run.lines))}>{RETURN_LABELS[k]}</button>
            ))}
          </div>
          {run.lines.some((l) => !l.idNo) && <p className="small payroll-warn">Some staff have no ID number. Add it in Staff pay details, then press Prepare again, before filing.</p>}
        </section>
      )}
      {run && (
        <section className="payslips">
          <h2 className="no-print">Payslips</h2>
          {run.lines.map((l) => <Payslip key={l.staffId} org={org} month={month} line={l} run={run} />)}
        </section>
      )}
    </div>
  );
}

function Payslip({ org, month, line: l, run }: { org: Organization; month: string; line: PayLine; run: PayRun }) {
  const toast = useToast();
  const text = `Hello ${l.name.split(' ')[0]}, here is your ${org.name} payslip for ${monthName(month)}. Net pay ${money(org, l.netCents)}.`;
  const pdf = () => payslipPdf(org, monthName(month), month, l, run.approved?.name ?? null);
  const whatsapp = async () => {
    try {
      const how = await shareOrDownload(await pdf(), text);
      if (how === 'downloaded') {
        if (l.phone) window.open(whatsappLink(l.phone, `${text} The payslip PDF is attached.`), '_blank', 'noopener');
        toast.show(l.phone ? 'Payslip saved. Attach it in the WhatsApp chat that opened.' : 'Payslip saved. Add a phone number to open WhatsApp directly.');
      }
    } catch (err) { toast.show(friendlyError(err)); }
  };
  const email = async () => {
    try {
      const file = await pdf();
      downloadFile(file);
      window.location.href = `mailto:${encodeURIComponent(l.email ?? '')}?subject=${encodeURIComponent(`Payslip ${monthName(month)}`)}&body=${encodeURIComponent(`${text}\n\nPlease find the payslip attached.`)}`;
      toast.show('Payslip saved. Attach it to the email that opened.');
    } catch (err) { toast.show(friendlyError(err)); }
  };
  const earnings: [string, number][] = [['Basic salary', l.basicCents], ...l.allowances.map((a) => [a.name, a.amountCents] as [string, number]),
    ...(l.oneOff ?? []).map((a) => [`${a.name} (this month)`, a.amountCents] as [string, number]),
    ...(l.unpaid ?? []).map((a) => [`Less: ${a.name}`, -a.amountCents] as [string, number])];
  const deductions: [string, number][] = [['NSSF', l.nssfCents], ['SHIF', l.shifCents], ['Housing Levy', l.housingCents], ['PAYE', l.payeCents],
    ...l.deductions.map((d) => [d.name, d.amountCents] as [string, number])];
  const field = (label: string, value: string | undefined) => <div><span>{label}</span><strong>{value || '–'}</strong></div>;
  return (
    <article className="slip">
      <header className="slip-head">
        <img className="slip-crest" src="/org/adia-crest.png" alt="" width={72} height={72} />
        <div className="slip-title">
          <h3>ADIA Training Centre</h3>
          <p>Staff Payslip</p>
        </div>
        <div className="slip-month"><span>Pay period</span><strong>{monthName(month)}</strong></div>
      </header>
      <div className="slip-body">
        <div className="slip-who">
          {field('Name', l.name)}
          {field('Job title', l.jobTitle)}
          {field('Staff no.', l.staffNo)}
          {field('ID number', l.idNo)}
          {field('KRA PIN', l.kraPin)}
          {field('NSSF / SHIF', `${l.nssfNo || '–'} / ${l.shifNo || '–'}`)}
        </div>
        <div className="slip-cols">
          <section>
            <h4>Earnings</h4>
            {earnings.map(([k, v], i) => <div key={i} className="slip-row"><span>{k}</span><span>{money(org, v)}</span></div>)}
            <div className="slip-row slip-sum"><span>Gross pay</span><span>{money(org, l.grossCents)}</span></div>
          </section>
          <section>
            <h4>Deductions</h4>
            {deductions.map(([k, v], i) => <div key={i} className="slip-row"><span>{k}</span><span>{money(org, v)}</span></div>)}
            <div className="slip-row slip-sum"><span>Total deductions</span><span>{money(org, l.totalDeductionsCents)}</span></div>
          </section>
        </div>
        <div className="slip-net"><span>Net pay</span><strong>{money(org, l.netCents)}</strong></div>
        <p className="slip-note">
          Taxable pay {money(org, l.taxableCents)} · Tax {money(org, l.taxBeforeReliefCents)} less personal relief {money(org, l.reliefCents)}
          {l.paymentDetails ? ` · Paid to ${l.paymentDetails}` : ''}
        </p>
        <footer className="slip-foot">
          <span>{run.approved ? `Approved by ${run.approved.name}` : 'Not yet approved'}</span>
          <span>Computer-generated payslip · Keep it confidential</span>
        </footer>
      </div>
      <div className="row-actions no-print slip-actions">
        <button type="button" className="btn btn-quiet" onClick={whatsapp}>Send by WhatsApp</button>
        <button type="button" className="btn btn-quiet" onClick={email} disabled={!l.email} title={l.email ? undefined : 'Add an email in Staff pay details'}>Send by email</button>
      </div>
    </article>
  );
}
