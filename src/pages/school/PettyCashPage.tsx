import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { usePettyCash, type FundRow, type RequisitionRow } from '../../state/usePettyCash';
import { approveRequisition, cancelFund, checkRequisition, confirmOwnPassword, rejectRequisition, signFund, startFund, submitRequisition } from '../../lib/pettyCashWrites';
import {
  FUND_SIGNATURES_NEEDED, itemsTotalCents, MAX_PETTY_CASH_ITEMS, nextStepFor, parseAmountCents,
  PETTY_CASH_ORG_TYPES, pettyCashBase, pettyCashCategoriesFor, PETTY_CASH_STATUS_LABELS, type PettyCashCategory, type PettyFundKind,
} from '../../../functions/src/shared/pettyCash';
import { money } from './common';
import { PettyInsights } from '../../components/PettyInsights';
import { useOrg } from '../../state/OrgContext';
import type { Organization } from '../../state/OrgContext';
import type { Timestamp } from 'firebase/firestore';

const when = (t: unknown) => (t && typeof (t as Timestamp).toDate === 'function'
  ? (t as Timestamp).toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now');
const label = (r: RequisitionRow) => r.number ?? 'New request';

/** Petty cash belongs to ADIA Training Centre, Freedom Hope Center and Freedom Church; asks which when another is selected. */
const keepsPettyCash = (type: string | undefined) => (PETTY_CASH_ORG_TYPES as readonly string[]).includes(type ?? '');
function PettyGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
  const { current, organizations, select } = useOrg();
  if (current && keepsPettyCash(current.type)) return <>{children(current)}</>;
  const orgs = organizations.filter((o) => keepsPettyCash(o.type) && !o.deletedAt);
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        <p>Which organization's petty cash?</p>
        <div className="chips">{orgs.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}</div>
      </div>
    </div>
  );
}

function NoAccess() {
  return <div className="page narrow"><h1>Petty cash</h1><p>Petty cash is for the people the pastor has given access.</p></div>;
}

/** Total budget, spent and remaining since the last reset, and the tile that starts a reset. */
function Stats({ org, onReset }: { org: Organization; onReset: () => void }) {
  const p = usePettyCash(org);
  const s = p.summary;
  return (
    <div className="petty-stats">
      <div className="petty-stat petty-stat-budget"><span>Total budget</span><strong>{money(org, s.budgetCents)}</strong></div>
      <div className="petty-stat petty-stat-spent"><span>Total spent</span><strong>{money(org, s.spentCents)}</strong></div>
      <div className={`petty-stat petty-stat-left${s.remainingCents < 0 ? ' petty-stat-over' : ''}`}><span>Remaining</span><strong>{money(org, s.remainingCents)}</strong></div>
      <button type="button" className="petty-reset" onClick={onReset} disabled={!p.canAuthorize} title={p.canAuthorize ? undefined : 'Only the signing stakeholders can reset the budget'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" /></svg>
        <strong>Reset<br />Budget</strong>
        <small>3-SIG AUTH</small>
      </button>
    </div>
  );
}

const FUND_TEXT: Record<PettyFundKind, { title: string; sub: string; done: string }> = {
  topup: { title: 'Top-Up Authorization', sub: `Any ${FUND_SIGNATURES_NEEDED} stakeholders must sign to add funds`, done: 'Top-up complete. The money is now in the budget.' },
  reset: { title: 'Reset Budget Authorization', sub: `Any ${FUND_SIGNATURES_NEEDED} stakeholders must sign to start the budget again from zero`, done: 'Budget reset. It now starts again from zero.' },
};

/** A top-up or a reset collecting its three signatures. Each stakeholder signs from their own account with their own password. */
function FundCard({ org, kind, onClose }: { org: Organization; kind: PettyFundKind; onClose?: () => void }) {
  const p = usePettyCash(org);
  const { profile } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const open: FundRow | undefined = p.funds.find((f) => f.kind === kind && f.status === 'collecting');
  const signed = open ? Object.entries(open.signatures).sort(([, a], [, b]) => ((a.at as Timestamp)?.toMillis?.() ?? Date.now()) - ((b.at as Timestamp)?.toMillis?.() ?? Date.now())) : [];
  const iSigned = !!open && p.uid in open.signatures;
  const cents = kind === 'topup' ? (open ? open.amountCents : parseAmountCents(amount)) : 0;
  const ready = kind === 'reset' || (cents != null && cents > 0);
  const name = profile?.displayName ?? 'Stakeholder';
  const text = FUND_TEXT[kind];

  async function confirm() {
    if (!ready || !password) return;
    setBusy(true);
    try {
      await confirmOwnPassword(password);
    } catch (err) {
      setBusy(false);
      toast.show(friendlyError(err));
      return;
    }
    const last = !!open && signed.length + 1 >= FUND_SIGNATURES_NEEDED;
    const write = open ? signFund(org.id, open, name) : startFund(org.id, kind, cents ?? 0, name);
    write.catch((err) => toast.show(friendlyError(err)));
    setPassword(''); setAmount(''); setBusy(false);
    toast.show(last ? text.done : `Signed. ${FUND_SIGNATURES_NEEDED - signed.length - 1} more signature${FUND_SIGNATURES_NEEDED - signed.length - 1 === 1 ? '' : 's'} needed.`);
    if (last && kind === 'reset') onClose?.();
  }

  return (
    <section className="petty-auth" aria-label={text.title}>
      <div className="petty-auth-head">
        <div className="petty-auth-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d={kind === 'topup' ? 'M9 3h6l-1.5 3h-3zM6 10c0-2 2.7-4 6-4s6 2 6 4l1 8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM12 10v7M10 12.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-1 1-2 1.3-2 .6-2 1.4.9 1.3 2 1.3 2-.6 2-1.3' : 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4'} /></svg>
        </div>
        <div className="petty-auth-title"><h2>{text.title}</h2><p>{text.sub}</p></div>
        <span className="petty-auth-count">{signed.length}/{FUND_SIGNATURES_NEEDED}</span>
      </div>
      <div className="petty-auth-body">
        {kind === 'topup' && (open ? (
          <p className="petty-auth-amount">Top-up of <strong>{money(org, open.amountCents)}</strong>, started by {signed[0]?.[1].name ?? 'a stakeholder'}</p>
        ) : (
          <label className="field"><span className="petty-caps">Top-up amount (KES)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount to top up e.g. 500000" disabled={!p.canAuthorize} />
          </label>
        ))}
        {kind === 'reset' && <p className="petty-warn">Resetting sets the total budget and spending back to zero. Requests still waiting for a signature carry over.</p>}
        {!ready && <p className="petty-warn">Enter the top-up amount above before stakeholders can sign</p>}
        <ol className="petty-signers">
          {Array.from({ length: FUND_SIGNATURES_NEEDED }, (_, n) => {
            const s = signed[n];
            const mine = !s && n === signed.length && p.canAuthorize && !iSigned;
            return (
              <li key={n} className={s ? 'signed' : ''}>
                <div className="petty-signer-head"><span className="petty-signer-no">{s ? '✓' : n + 1}</span><h3>Authorizer {n + 1}</h3>{s && <span className="petty-signer-when">{when(s[1].at)}</span>}</div>
                {s ? (
                  <p className="petty-signer-name">Signed by {s[1].name}</p>
                ) : mine ? (
                  <div className="petty-signer-form">
                    <label className="field"><span>Stakeholder</span><input value={name} readOnly /></label>
                    <div className="petty-signer-row">
                      <label className="field"><span>Your Insight-IQ password</span>
                        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password / signature" disabled={!ready || busy} />
                      </label>
                      <button type="button" className="btn btn-primary" disabled={!ready || !password || busy} onClick={confirm}>{busy ? 'Checking…' : '✓ Confirm'}</button>
                    </div>
                  </div>
                ) : (
                  <p className="petty-signer-name muted">{iSigned ? 'Waiting for another stakeholder to sign from their own account' : p.canAuthorize ? 'Waiting for the signature above' : 'Waiting for a stakeholder to sign'}</p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="row-actions">
          {open && open.createdBy === p.uid && <button type="button" className="btn btn-quiet danger-text" onClick={() => { cancelFund(org.id, open.id).catch((err) => toast.show(friendlyError(err))); toast.show('Cancelled'); }}>Cancel this {kind === 'topup' ? 'top-up' : 'reset'}</button>}
          {onClose && !open && <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>}
        </div>
      </div>
    </section>
  );
}

function RequisitionList({ org, rows, empty }: { org: Organization; rows: RequisitionRow[]; empty: string }) {
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="link-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`${pettyCashBase(org.type)}/${r.id}`}>
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
  return <PettyGate title="Petty cash">{(org) => <Home org={org} />}</PettyGate>;
}

function Home({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const actor = { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove };
  const waiting = p.requisitions.filter((r) => nextStepFor(r, actor));
  const mine = p.requisitions.filter((r) => r.requesterId === p.uid);
  const approved = p.requisitions.filter((r) => r.status === 'approved');
  const resetOpen = p.funds.some((f) => f.kind === 'reset' && f.status === 'collecting');
  const [showReset, setShowReset] = useState(false);
  const inProgress = p.requisitions.filter((r) => r.status === 'submitted' || r.status === 'checked');
  if (!p.any) return <NoAccess />;
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Petty cash</h1>
        {p.canRequest && <Link to={`${pettyCashBase(org.type)}/new`} className="btn btn-primary">New requisition</Link>}
      </div>
      {p.seesAll && <Stats org={org} onReset={() => setShowReset(true)} />}
      {p.seesAll && (showReset || resetOpen) && <FundCard org={org} kind="reset" onClose={() => setShowReset(false)} />}
      {p.seesAll && <FundCard org={org} kind="topup" />}
      {(p.canCheck || p.canApprove) && (
        <section className="card stack">
          <h2>Waiting for you</h2>
          <RequisitionList org={org} rows={waiting} empty="Nothing needs your signature." />
        </section>
      )}
      {p.canRequest && (
        <section className="card stack">
          <h2>My requests</h2>
          <RequisitionList org={org} rows={mine} empty="You have not made a request yet." />
        </section>
      )}
      {p.seesAll && !p.loading && <PettyInsights org={org} month={p.month} requisitions={p.requisitions} summary={p.summary} />}
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
  return <PettyGate title="New requisition">{(org) => <NewRequisition org={org} />}</PettyGate>;
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
    navigate(`${pettyCashBase(org.type)}/${id}`);
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>New requisition</h1><Link to={pettyCashBase(org.type)} className="btn btn-quiet">Back</Link></div>
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
              {pettyCashCategoriesFor(org.type).map((c) => <option key={c} value={c}>{c}</option>)}
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
      {p.seesAll && <p className="petty-left">Remaining in the budget after this request: <strong>{money(org, p.summary.remainingCents - total)}</strong></p>}
      <button type="button" className="btn btn-primary" onClick={submit}>Submit requisition</button>
    </div>
  );
}

export function RequisitionPage() {
  return <PettyGate title="Requisition">{(org) => <Requisition org={org} />}</PettyGate>;
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
  if (!r) return <div className="page narrow"><h1>Requisition</h1><p className="muted">{p.loading ? 'Loading…' : 'This requisition was not found.'}</p><Link to={pettyCashBase(org.type)}>Back to petty cash</Link></div>;
  const step = nextStepFor(r, { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove });
  const name = profile?.displayName ?? 'Staff';
  const act = (write: Promise<unknown>, done: string) => { write.catch((err) => toast.show(friendlyError(err))); toast.show(done); };

  return (
    <div className="page narrow petty-print">
      <div className="page-head">
        <h1>{label(r)}</h1>
        <div className="row-actions">
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print</button>
          <Link to={pettyCashBase(org.type)} className="btn btn-quiet">Back</Link>
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
