import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { usePettyCash, type RequisitionRow } from '../../state/usePettyCash';
import { approveRequisition, checkRequisition, rejectRequisition, setPettyBudget, submitRequisition } from '../../lib/pettyCashWrites';
import {
  budgetSummary, itemsTotalCents, MAX_PETTY_CASH_ITEMS, nextStepFor, parseAmountCents,
  PETTY_CASH_CATEGORIES, PETTY_CASH_STATUS_LABELS, type PettyCashCategory,
} from '../../../functions/src/shared/pettyCash';
import { SchoolGate, money } from './common';
import type { Organization } from '../../state/OrgContext';
import type { Timestamp } from 'firebase/firestore';

const when = (t: unknown) => (t && typeof (t as Timestamp).toDate === 'function'
  ? (t as Timestamp).toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now');
const monthName = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
const label = (r: RequisitionRow) => r.number ?? 'New request';

function NoAccess() {
  return <div className="page narrow"><h1>Petty cash</h1><p>Petty cash is for the people the pastor has given access.</p></div>;
}

/** The month's budget and its live balance. A board member can set it. */
function BudgetCard({ org, extraCents = 0 }: { org: Organization; extraCents?: number }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const s = budgetSummary(p.budget?.amountCents ?? null, p.month, p.requisitions, extraCents);
  function save() {
    const cents = parseAmountCents(amount);
    if (cents == null) { toast.show('Type the budget in shillings, for example 100000.'); return; }
    setPettyBudget(org.id, p.month, cents, '', !!p.budget).catch((err) => toast.show(friendlyError(err)));
    setEditing(false);
    toast.show('Budget saved');
  }
  return (
    <section className={`card stack petty-budget petty-${s.state}`} aria-label="Budget">
      <div className="card-head">
        <h2>{monthName(p.month)} budget</h2>
        {p.canApprove && !editing && <button type="button" className="btn btn-quiet" onClick={() => { setAmount(p.budget ? String(p.budget.amountCents / 100) : ''); setEditing(true); }}>{p.budget ? 'Change' : 'Set budget'}</button>}
      </div>
      {editing ? (
        <div className="field-row">
          <label className="field"><span>Budget for {monthName(p.month)} (KES)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100000" autoFocus /></label>
          <button type="button" className="btn btn-primary align-start" onClick={save}>Save</button>
          <button type="button" className="btn btn-quiet align-start" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : s.budgetCents == null ? (
        <p className="muted small">{p.canApprove ? 'No budget set for this month yet.' : 'No budget set for this month yet. A board member sets it.'}</p>
      ) : (
        <>
          <ul className="petty-figures">
            <li><span>Budget</span><strong>{money(org, s.budgetCents)}</strong></li>
            <li><span>Approved</span><strong>{money(org, s.approvedCents)}</strong></li>
            <li><span>{extraCents ? 'Waiting, with this request' : 'Waiting for approval'}</span><strong>{money(org, s.pendingCents)}</strong></li>
            <li><span>Balance</span><strong className="petty-balance">{money(org, s.balanceCents ?? 0)}</strong></li>
          </ul>
          <div className="petty-bar" role="img" aria-label={`${Math.min(s.usedPercent, 100).toFixed(0)}% of the budget used`}><span style={{ width: `${Math.min(s.usedPercent, 100)}%` }} /></div>
          {s.state === 'over' && <p className="small danger-text">This is over the month's budget.</p>}
        </>
      )}
    </section>
  );
}

function RequisitionList({ org, rows, empty }: { org: Organization; rows: RequisitionRow[]; empty: string }) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="link-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/school/petty-cash/${r.id}`}>
            <span className="link-title">{label(r)} · {r.requesterName}</span>
            <span className="link-detail">{money(org, r.totalCents)} · {PETTY_CASH_STATUS_LABELS[r.status]} · {r.category}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Petty cash home: the budget, what is waiting for you, your requests and the approved ones. */
export function PettyCashPage() {
  return <SchoolGate title="Petty cash">{(org) => <Home org={org} />}</SchoolGate>;
}

function Home({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const actor = { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove };
  const waiting = p.requisitions.filter((r) => nextStepFor(r, actor));
  const mine = p.requisitions.filter((r) => r.requesterId === p.uid);
  const approved = p.requisitions.filter((r) => r.status === 'approved');
  const inProgress = p.requisitions.filter((r) => r.status === 'submitted' || r.status === 'checked');
  if (!p.any) return <NoAccess />;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Petty cash</h1>
        <Link to="/school/petty-cash/new" className="btn btn-primary">New requisition</Link>
      </div>
      <BudgetCard org={org} />
      {(p.canCheck || p.canApprove) && (
        <section className="card stack">
          <h2>Waiting for you</h2>
          <RequisitionList org={org} rows={waiting} empty="Nothing needs your signature." />
        </section>
      )}
      <section className="card stack">
        <h2>My requests</h2>
        <RequisitionList org={org} rows={mine} empty="You have not made a request yet." />
      </section>
      {p.seesAll && (
        <>
          <section className="card stack">
            <h2>In progress</h2>
            <RequisitionList org={org} rows={inProgress} empty="No requests are waiting." />
          </section>
          <section className="card stack">
            <h2>Approved</h2>
            <RequisitionList org={org} rows={approved} empty="Nothing approved yet." />
          </section>
        </>
      )}
      {p.loading && <p className="muted small">Loading…</p>}
    </div>
  );
}

interface Line { key: number; description: string; amount: string }

export function NewRequisitionPage() {
  return <SchoolGate title="New requisition">{(org) => <NewRequisition org={org} />}</SchoolGate>;
}

function NewRequisition({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState<PettyCashCategory | ''>('');
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', amount: '' }]);
  const [copyFrom, setCopyFrom] = useState('');
  const parsed = lines.map((l) => ({ description: l.description.trim(), amountCents: parseAmountCents(l.amount) }));
  const total = itemsTotalCents(parsed.map((i) => ({ amountCents: i.amountCents ?? 0 })));
  const previous = useMemo(() => p.requisitions.filter((r) => r.requesterId === p.uid || p.seesAll).slice(0, 30), [p.requisitions, p.uid, p.seesAll]);
  if (!p.any) return <NoAccess />;

  const update = (key: number, field: 'description' | 'amount', value: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  function copy() {
    const r = previous.find((x) => x.id === copyFrom);
    if (!r) return;
    setCategory(r.category);
    setLines(r.items.map((i, n) => ({ key: n + 1, description: i.description, amount: String(i.amountCents / 100) })));
    toast.show(`${label(r)} copied. Change anything, then submit it as a new request.`);
  }
  function submit() {
    if (!category) { toast.show('Choose a category.'); return; }
    if (parsed.some((i) => !i.description || i.amountCents == null || i.amountCents <= 0)) { toast.show('Fill in a description and an amount for every item.'); return; }
    const { id, saved } = submitRequisition(org.id, {
      requesterName: profile?.displayName ?? 'Staff', category,
      items: parsed.map((i) => ({ description: i.description.slice(0, 200), amountCents: i.amountCents! })), month: p.month,
    });
    saved.catch((err) => toast.show(friendlyError(err)));
    toast.show('Request submitted. It now goes to the accountant.');
    navigate(`/school/petty-cash/${id}`);
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>New requisition</h1><Link to="/school/petty-cash" className="btn btn-quiet">Back</Link></div>
      {previous.length > 0 && (
        <section className="card stack">
          <h2>Start from an old requisition</h2>
          <div className="field-row">
            <label className="field"><span>Old requisition</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Choose one…</option>
                {previous.map((r) => <option key={r.id} value={r.id}>{label(r)} · {r.requesterName} · {money(org, r.totalCents)}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-quiet align-start" disabled={!copyFrom} onClick={copy}>Copy it</button>
          </div>
        </section>
      )}
      <section className="card stack">
        <div className="card-head"><h2>Request</h2><span className="petty-number">Number given when saved</span></div>
        <div className="field-row">
          <label className="field"><span>Requester</span><input value={profile?.displayName ?? ''} readOnly /></label>
          <label className="field"><span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as PettyCashCategory)}>
              <option value="">Choose a category…</option>
              {PETTY_CASH_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <h3>Expense items</h3>
        {lines.map((l, n) => (
          <div key={l.key} className="field-row petty-line">
            <label className="field"><span>Item {n + 1}</span><input value={l.description} maxLength={200} onChange={(e) => update(l.key, 'description', e.target.value)} placeholder="What is it for?" /></label>
            <label className="field petty-amount"><span>Amount (KES)</span><input inputMode="decimal" value={l.amount} onChange={(e) => update(l.key, 'amount', e.target.value)} placeholder="0.00" /></label>
            <button type="button" className="btn btn-quiet danger-text align-start" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Delete</button>
          </div>
        ))}
        {lines.length < MAX_PETTY_CASH_ITEMS && (
          <button type="button" className="btn btn-quiet align-start" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, description: '', amount: '' }])}>Add another item</button>
        )}
        <p className="petty-total">Total <strong>{money(org, total)}</strong></p>
      </section>
      <BudgetCard org={org} extraCents={total} />
      <button type="button" className="btn btn-primary" onClick={submit}>Submit requisition</button>
    </div>
  );
}

export function RequisitionPage() {
  return <SchoolGate title="Requisition">{(org) => <Requisition org={org} />}</SchoolGate>;
}

function Requisition({ org }: { org: Organization }) {
  const { reqId = '' } = useParams();
  const p = usePettyCash(org);
  const { profile } = useAuth();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  if (!p.any) return <NoAccess />;
  const r = p.requisitions.find((x) => x.id === reqId);
  if (!r) return <div className="page narrow"><h1>Requisition</h1><p className="muted">{p.loading ? 'Loading…' : 'This requisition was not found.'}</p><Link to="/school/petty-cash">Back to petty cash</Link></div>;
  const step = nextStepFor(r, { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove });
  const name = profile?.displayName ?? 'Staff';
  const act = (write: Promise<unknown>, done: string) => { write.catch((err) => toast.show(friendlyError(err))); toast.show(done); };

  return (
    <div className="page narrow petty-print">
      <div className="page-head">
        <h1>{label(r)}</h1>
        <div className="row-actions">
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print</button>
          <Link to="/school/petty-cash" className="btn btn-quiet">Back</Link>
        </div>
      </div>
      <section className="card stack">
        <ul className="petty-figures petty-details">
          <li><span>Requester</span><strong>{r.requesterName}</strong></li>
          <li><span>Category</span><strong>{r.category}</strong></li>
          <li><span>Date</span><strong>{when(r.createdAt)}</strong></li>
          <li><span>Status</span><strong>{PETTY_CASH_STATUS_LABELS[r.status]}</strong></li>
        </ul>
        <h2>Expense items</h2>
        <ul className="petty-items">
          {r.items.map((i, n) => <li key={n}><span>{n + 1}. {i.description}</span><strong>{money(org, i.amountCents)}</strong></li>)}
        </ul>
        <p className="petty-total">Total <strong>{money(org, r.totalCents)}</strong></p>
      </section>
      <section className="card stack">
        <h2>Approval history</h2>
        <ol className="petty-steps">
          <li className="done"><strong>1. Requested by {r.requesterName}</strong><span className="small muted">{when(r.createdAt)}</span></li>
          <li className={r.checked ? 'done' : ''}><strong>2. Checked by the accountant{r.checked ? `: ${r.checked.name}` : ''}</strong><span className="small muted">{r.checked ? when(r.checked.at) : 'Not yet'}</span></li>
          <li className={r.approved ? 'done' : ''}><strong>3. Final approval by a board member{r.approved ? `: ${r.approved.name}` : ''}</strong><span className="small muted">{r.approved ? when(r.approved.at) : 'Not yet'}</span></li>
        </ol>
        {r.rejection && <p className="notice">Rejected by {r.rejection.name} ({when(r.rejection.at)}): {r.rejection.reason}</p>}
      </section>
      {step && (
        <section className="card stack">
          <h2>{step === 'check' ? 'Check this request' : 'Give final approval'}</h2>
          {rejecting ? (
            <div className="field-row">
              <label className="field"><span>Why is it rejected?</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
              <button type="button" className="btn btn-danger align-start" disabled={!reason.trim()} onClick={() => { act(rejectRequisition(org.id, r.id, name, reason.trim()), 'Request rejected'); setRejecting(false); }}>Reject</button>
              <button type="button" className="btn btn-quiet align-start" onClick={() => setRejecting(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row-actions">
              <button type="button" className="btn btn-primary" onClick={() => act(step === 'check' ? checkRequisition(org.id, r.id, name) : approveRequisition(org.id, r.id, name), step === 'check' ? 'Checked. It now goes for final approval.' : 'Approved')}>
                {step === 'check' ? 'Mark as checked' : 'Approve'}
              </button>
              <button type="button" className="btn btn-quiet danger-text" onClick={() => setRejecting(true)}>Reject</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
