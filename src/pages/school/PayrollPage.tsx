import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { usePayroll, type PayRun, type StaffRow } from '../../state/usePayroll';
import { approvePayRun, preparePayRun, savePayrollRates, saveStaff, type StaffInput } from '../../lib/payrollWrites';
import { payrollCsv, preparePayroll, type PayItem, type PayLine, type PayrollRates } from '../../../functions/src/shared/payroll';
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
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  if (!p.any) return <NoAccess />;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Staff pay details</h1>
      </div>
      <PayrollNav />
      {p.canManage && !editing && <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Add staff member</button>}
      {editing && <StaffForm key={editing === 'new' ? 'new' : editing.id} org={org} row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <section className="card stack">
        <h2>Staff</h2>
        {p.staff.length === 0 ? <p className="muted small">No staff added yet.</p> : (
          <ul className="link-list">
            {p.staff.map((s) => {
              const gross = s.basicCents + itemsTotal(s.allowances);
              return (
                <li key={s.id}>
                  <button type="button" className="link-button" onClick={() => p.canManage && setEditing(s)} disabled={!p.canManage}>
                    <span className="link-title">{s.name}{s.jobTitle ? ` · ${s.jobTitle}` : ''}{s.active ? '' : ' · not on payroll'}</span>
                    <span className="link-detail">Gross {money(org, gross)}{s.deductions.length ? ` · ${s.deductions.length} other deduction${s.deductions.length > 1 ? 's' : ''}` : ''}{s.staffNo ? ` · No. ${s.staffNo}` : ''}</span>
                  </button>
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

function StaffForm({ org, row, onDone }: { org: Organization; row: StaffRow | null; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: row?.name ?? '', staffNo: row?.staffNo ?? '', jobTitle: row?.jobTitle ?? '', kraPin: row?.kraPin ?? '',
    nssfNo: row?.nssfNo ?? '', shifNo: row?.shifNo ?? '', paymentDetails: row?.paymentDetails ?? '',
    basic: row ? kes(row.basicCents) : '', active: row?.active ?? true,
  });
  const [allowances, setAllowances] = useState<ItemDraft[]>(toDraft(row?.allowances ?? []));
  const [deductions, setDeductions] = useState<ItemDraft[]>(toDraft(row?.deductions ?? []));
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const items = (list: ItemDraft[]): PayItem[] | null => {
    const out: PayItem[] = [];
    for (const i of list) {
      if (!i.name.trim() && !i.amount.trim()) continue;
      const c = parseAmountCents(i.amount);
      if (!i.name.trim() || c == null) return null;
      out.push({ name: i.name.trim(), amountCents: c });
    }
    return out;
  };
  const save = () => {
    const basicCents = parseAmountCents(f.basic);
    const a = items(allowances);
    const d = items(deductions);
    if (!f.name.trim()) { toast.show('Please enter the name.'); return; }
    if (basicCents == null) { toast.show('Please enter the basic salary in KES.'); return; }
    if (!a || !d) { toast.show('Each allowance and deduction needs a name and an amount.'); return; }
    const input: StaffInput = {
      name: f.name.trim(), staffNo: f.staffNo.trim(), jobTitle: f.jobTitle.trim(), kraPin: f.kraPin.trim().toUpperCase(),
      nssfNo: f.nssfNo.trim(), shifNo: f.shifNo.trim(), paymentDetails: f.paymentDetails.trim(), basicCents, allowances: a, deductions: d, active: f.active,
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
        <label className="field"><span>KRA PIN</span><input value={f.kraPin} maxLength={20} onChange={set('kraPin')} /></label>
        <label className="field"><span>NSSF number</span><input value={f.nssfNo} maxLength={30} onChange={set('nssfNo')} /></label>
        <label className="field"><span>SHIF number</span><input value={f.shifNo} maxLength={30} onChange={set('shifNo')} /></label>
        <label className="field"><span>Pay to (bank account or M-Pesa number)</span><input value={f.paymentDetails} maxLength={200} onChange={set('paymentDetails')} /></label>
        <label className="field"><span>Basic salary a month (KES)</span><input inputMode="decimal" value={f.basic} onChange={set('basic')} /></label>
      </div>
      <ItemsEditor title="Allowances (added to pay)" items={allowances} onChange={setAllowances} hint="For example house or transport allowance." />
      <ItemsEditor title="Other deductions (taken after tax)" items={deductions} onChange={setDeductions} hint="For example a salary advance or loan repayment." />
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> On the payroll</label>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </section>
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

function RunView({ org }: { org: Organization }) {
  const { month = '' } = useParams();
  const p = usePayroll(org);
  const { profile } = useAuth();
  const toast = useToast();
  const name = profile?.displayName ?? 'Staff';
  if (!p.any) return <NoAccess />;
  if (!/^\d{4}-\d{2}$/.test(month)) return <div className="page narrow"><h1>Pay run</h1><p>That month was not found. <Link to={BASE}>Back to payroll</Link></p></div>;
  const run: PayRun | undefined = p.runs.find((r) => r.month === month);
  const fresh = preparePayroll(p.staff, p.rates);
  const shown = run ? { lines: run.lines, totals: run.totals } : fresh;
  const prepare = () => {
    if (fresh.lines.length === 0) { toast.show('Add staff pay details first.'); return; }
    preparePayRun(org.id, month, !!run, { ...fresh, rates: p.rates }, name).catch((err) => toast.show(friendlyError(err)));
    toast.show(run ? 'Prepared again from the latest details' : 'Pay run prepared');
  };
  const approve = () => {
    approvePayRun(org.id, month, name).catch((err) => toast.show(friendlyError(err)));
    toast.show('Pay run approved');
  };
  const t = shown.totals;
  return (
    <div className="page narrow payroll-run">
      <div className="page-head no-print">
        <h1>Pay run · {monthName(month)}</h1>
      </div>
      <PayrollNav />
      <section className="card stack no-print">
        <p className="payroll-status">
          {!run ? 'Not prepared yet. This is a preview from the current staff details.'
            : run.status === 'approved' ? `Approved by ${run.approved?.name}. Prepared by ${run.preparedByName}. It is locked.`
            : `Prepared by ${run.preparedByName}. Waiting for approval by someone else.`}
        </p>
        <div className="row-actions">
          {p.canManage && (!run || run.status === 'draft') && <button type="button" className="btn btn-primary" onClick={prepare}>{run ? 'Prepare again' : 'Prepare pay run'}</button>}
          {run && run.status === 'draft' && p.canApprove && run.preparedBy !== p.uid && <button type="button" className="btn btn-primary" onClick={approve}>Approve pay run</button>}
          {run && run.status === 'draft' && p.canApprove && run.preparedBy === p.uid && <span className="muted small">You prepared this, so someone else must approve it.</span>}
          {run && <button type="button" className="btn btn-quiet" onClick={() => download(`ADIA-payroll-${month}.csv`, payrollCsv(month, run.lines))}>Download for the bank (CSV)</button>}
          {run && <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print payslips</button>}
        </div>
      </section>
      <div className="petty-stats no-print">
        <div className="petty-stat petty-stat-budget"><span>Gross pay</span><strong>{money(org, t.grossCents)}</strong></div>
        <div className="petty-stat petty-stat-spent"><span>Deductions</span><strong>{money(org, t.grossCents - t.netCents)}</strong></div>
        <div className="petty-stat petty-stat-left"><span>Net pay</span><strong>{money(org, t.netCents)}</strong></div>
        <div className="petty-stat payroll-stat-cost"><span>Cost to ADIA</span><strong>{money(org, t.employerCostCents)}</strong></div>
      </div>
      <section className="card stack no-print">
        <h2>Summary</h2>
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
        <p className="muted small">The employer also pays NSSF {money(org, t.employerNssfCents)} and Housing Levy {money(org, t.employerHousingCents)} to KRA. Amounts are in KES.</p>
      </section>
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
  const row = (label: string, cents: number, strong = false) => (
    <tr><td>{strong ? <strong>{label}</strong> : label}</td><td className="num">{strong ? <strong>{money(org, cents)}</strong> : money(org, cents)}</td></tr>
  );
  return (
    <article className="card payslip">
      <header className="payslip-head">
        <div><strong>{org.name}</strong><br /><span>Payslip · {monthName(month)}</span></div>
        <div className="payslip-who"><strong>{l.name}</strong>{l.jobTitle && <><br />{l.jobTitle}</>}{l.staffNo && <><br />Staff no. {l.staffNo}</>}</div>
      </header>
      <p className="small payslip-ids">KRA PIN {l.kraPin || '–'} · NSSF {l.nssfNo || '–'} · SHIF {l.shifNo || '–'}</p>
      <div className="payslip-cols">
        <table className="table">
          <thead><tr><th>Earnings</th><th className="num">KES</th></tr></thead>
          <tbody>
            {row('Basic salary', l.basicCents)}
            {l.allowances.map((a, i) => <tr key={i}><td>{a.name}</td><td className="num">{money(org, a.amountCents)}</td></tr>)}
            {row('Gross pay', l.grossCents, true)}
          </tbody>
        </table>
        <table className="table">
          <thead><tr><th>Deductions</th><th className="num">KES</th></tr></thead>
          <tbody>
            {row('NSSF', l.nssfCents)}
            {row('SHIF', l.shifCents)}
            {row('Housing Levy', l.housingCents)}
            {row(`PAYE (tax ${num(l.taxBeforeReliefCents)} less relief ${num(l.reliefCents)})`, l.payeCents)}
            {l.deductions.map((d, i) => <tr key={i}><td>{d.name}</td><td className="num">{money(org, d.amountCents)}</td></tr>)}
            {row('Total deductions', l.totalDeductionsCents, true)}
          </tbody>
        </table>
      </div>
      <p className="payslip-net">Net pay <strong>{money(org, l.netCents)}</strong></p>
      <p className="small muted">Taxable pay {money(org, l.taxableCents)}{l.paymentDetails ? ` · Paid to ${l.paymentDetails}` : ''}{run.approved ? ` · Approved by ${run.approved.name}` : ' · Not yet approved'}</p>
    </article>
  );
}
