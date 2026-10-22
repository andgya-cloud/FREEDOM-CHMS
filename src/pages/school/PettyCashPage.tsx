import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { millis, usePettyCash, usePettyCashAccess, useReceipts, type FundRow, type ReceiptRow, type RequisitionRow } from '../../state/usePettyCash';
import { addReceipt, approveRequisition, cancelFund, checkRequisition, confirmOwnPassword, receiptData, rejectRequisition, removeReceipt, signFund, signRequisition, startFund, submitRequisition } from '../../lib/pettyCashWrites';
import { requisitionPdf } from '../../lib/pettyPdf';
import { coSignFund, coSignRequisition } from '../../lib/coSign';
import { downloadFile } from '../../lib/givingPdf';
import {
  categoryBudgets, categoryLabel, lineAmountCents, type CategoryBudgetRow,
  FUND_SIGNATURES_NEEDED, itemsTotalCents, waitingForAccountant, MAX_RECEIPTS_PER_REQUEST, REQUEST_SIGNATURES_NEEDED, MAX_PETTY_CASH_ITEMS, nextStepFor, parseAmountCents,
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
const SUBMITTED_TEXT = `Request submitted. It now needs ${REQUEST_SIGNATURES_NEEDED} stakeholder signatures.`;
/** Signatures in the order they were given. */
const signaturesOf = (r: RequisitionRow) => Object.entries(r.signatures ?? {}).sort(([, a], [, b]) => (millis(a.at) ?? Date.now()) - (millis(b.at) ?? Date.now()));

/** Petty cash belongs to ADIA Training Centre, Freedom Hope Center and Freedom Church; asks which when another is selected. */
const keepsPettyCash = (type: string | undefined) => (PETTY_CASH_ORG_TYPES as readonly string[]).includes(type ?? '');
export function PettyGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
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

export function NoAccess() {
  return <div className="page narrow"><h1>Petty cash</h1><p>Petty cash is for the people the pastor has given access.</p></div>;
}

/** The petty cash sections, shown at the top of every petty cash page. */
export function PettyNav({ org }: { org: Organization }) {
  const p = usePettyCashAccess();
  const base = pettyCashBase(org.type);
  const items: [string, string, boolean][] = [
    [base, 'Overview', true], [`${base}/new`, 'New requisition', p.canRequest], [`${base}/receipts`, 'Receipts', p.seesAll],
    [`${base}/balance-sheet`, 'Balance sheet', p.seesAll], [`${base}/budget`, 'Budget tracker', p.seesAll],
  ];
  return (
    <nav className="chips petty-nav no-print" aria-label="Petty cash">
      {items.filter((i) => i[2]).map(([to, text]) => <NavLink key={to} to={to} end className={({ isActive }) => `chip${isActive ? ' chip-on' : ''}`}>{text}</NavLink>)}
    </nav>
  );
}

/** Each category's allowance as a bar: approved spending, then what is waiting, against what was set aside. */
export function BudgetHealth({ org, rows }: { org: Organization; rows: CategoryBudgetRow[] }) {
  const set = rows.filter((r) => r.allocatedCents > 0);
  if (set.length === 0) return null;
  return (
    <section className="card stack petty-health" aria-label="Budget by category">
      <h2>Budget by category</h2>
      <ul className="petty-health-list">
        {set.map((r) => {
          const used = Math.min(100, (r.spentCents / r.allocatedCents) * 100);
          const waiting = Math.min(100 - used, (r.pendingCents / r.allocatedCents) * 100);
          const over = r.spentCents + r.pendingCents > r.allocatedCents;
          return (
            <li key={r.category}>
              <div className="petty-health-head"><strong>{r.category}</strong><span className={over ? 'danger-text' : 'muted'}>{money(org, r.spentCents)} of {money(org, r.allocatedCents)}</span></div>
              <div className="petty-health-bar" role="img" aria-label={`${r.category}: ${Math.round(used)}% spent, ${Math.round(waiting)}% waiting`}>
                <span className={`petty-health-used${over ? ' over' : ''}`} style={{ width: `${used}%` }} />
                <span className="petty-health-wait" style={{ width: `${waiting}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="small muted">Solid: approved. Light: waiting for signatures.</p>
    </section>
  );
}

/** Total budget, spent and remaining since the last reset, and the tile that starts a reset. */
function Stats({ org, onReset }: { org: Organization; onReset: () => void }) {
  const p = usePettyCash(org);
  const s = p.summary;
  // A top-up still collecting signatures is shown, but only counts once the third stakeholder signs.
  const pending = p.funds.find((f) => f.kind === 'topup' && f.status === 'collecting');
  const pendingLeft = pending ? FUND_SIGNATURES_NEEDED - Object.keys(pending.signatures).length : 0;
  return (
    <div className="petty-stats">
      <div className="petty-stat petty-stat-budget"><span>Total budget</span><strong>{money(org, s.budgetCents)}</strong>
        {pending && <small className="petty-stat-pending">+ {money(org, pending.amountCents)} once {pendingLeft} more sign{pendingLeft === 1 ? 's' : ''}</small>}
      </div>
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

/**
 * Another stakeholder signs on this device with their own email and password, like the old app's
 * signing boxes. Their signature is saved as them, and the person signed in here stays signed in.
 */
function CoSignForm({ label: title, onSign }: { label: string; onSign: (email: string, password: string) => Promise<string> }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const name = await onSign(email, password);
      setEmail(''); setPassword('');
      toast.show(`Signed by ${name}.`);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      toast.show(code.includes('permission-denied')
        ? 'That person cannot sign this. They need petty cash signing ticked on their account, and cannot sign their own request or sign twice.'
        : code === 'auth/network-request-failed' ? 'Signing here needs a connection. Try again when online.' : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="petty-signer-form">
      <p className="small muted">{title}</p>
      <div className="petty-signer-row">
        <label className="field"><span>Stakeholder's email</span>
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" disabled={busy} />
        </label>
        <label className="field"><span>Their Insight-IQ password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Typed by them" disabled={busy} />
        </label>
        <button type="button" className="btn btn-primary" disabled={!email.trim() || !password || busy} onClick={() => void go()}>{busy ? 'Checking…' : '✓ Confirm'}</button>
      </div>
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
            {amount.trim() && (cents != null && cents > 0
              ? <small className="petty-amount-ok">{money(org, cents)} will be added to the budget once {FUND_SIGNATURES_NEEDED} stakeholders sign below.</small>
              : <small className="petty-amount-bad">Type the amount in numbers only, for example 500000 or 500,000.</small>)}
          </label>
        ))}
        {kind === 'reset' && <p className="petty-warn">Resetting sets the total budget and spending back to zero. Requests still waiting for a signature carry over.</p>}
        {!ready && !amount.trim() && <p className="petty-warn">Enter the top-up amount above before stakeholders can sign</p>}
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
                ) : open && n === signed.length ? (
                  <CoSignForm label="Another stakeholder signs here with their own email and password, or from their own account." onSign={(email, pw) => coSignFund(org.id, open, email, pw)} />
                ) : (
                  <p className="petty-signer-name muted">Waiting for the signature above</p>
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
            <span className="link-detail">{money(org, r.totalCents)} · {r.signatures && r.status === 'submitted' ? `${Object.keys(r.signatures).length} of ${REQUEST_SIGNATURES_NEEDED} signatures` : PETTY_CASH_STATUS_LABELS[r.status]} · {categoryLabel(r)}</span>
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
  const actor = { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove, canSign: p.canSign, isAccountant: p.isAccountant };
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
      <PettyNav org={org} />
      {p.seesAll && <Stats org={org} onReset={() => setShowReset(true)} />}
      {p.seesAll && (showReset || resetOpen) && <FundCard org={org} kind="reset" onClose={() => setShowReset(false)} />}
      {p.seesAll && <FundCard org={org} kind="topup" />}
      {p.canSign && (
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

interface Line { key: number; description: string; quantity: string; unitPrice: string }

/** A typed quantity ("2", "1.5"), or null when it is not a positive number. */
const parseQuantity = (text: string): number | null => {
  const n = Number(text.replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
};

export function NewRequisitionPage() {
  return <PettyGate title="New requisition">{(org) => <NewRequisition org={org} />}</PettyGate>;
}

function NewRequisition({ org }: { org: Organization }) {
  const p = usePettyCash(org);
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState<PettyCashCategory | ''>('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', quantity: '1', unitPrice: '' }]);
  const [copyFrom, setCopyFrom] = useState('');
  const parsed = lines.map((l) => {
    const quantity = parseQuantity(l.quantity);
    const unitPriceCents = parseAmountCents(l.unitPrice);
    return { description: l.description.trim(), quantity, unitPriceCents, amountCents: quantity != null && unitPriceCents != null ? lineAmountCents(quantity, unitPriceCents) : null };
  });
  const total = itemsTotalCents(parsed.map((i) => ({ amountCents: i.amountCents ?? 0 })));
  const previous = useMemo(() => p.requisitions.filter((r) => r.requesterId === p.uid || p.seesAll).slice(0, 30), [p.requisitions, p.uid, p.seesAll]);
  const cats = useMemo(() => categoryBudgets(pettyCashCategoriesFor(org.type), p.allocations, p.requisitions, p.periodStart, millis), [org.type, p.allocations, p.requisitions, p.periodStart]);
  if (!p.any) return <NoAccess />;

  const update = (key: number, field: 'description' | 'quantity' | 'unitPrice', value: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  function copy() {
    const r = previous.find((x) => x.id === copyFrom);
    if (!r) return;
    setCategory(r.category);
    setNote(r.categoryNote ?? '');
    setLines(r.items.map((i, n) => ({ key: n + 1, description: i.description, quantity: String(i.quantity ?? 1), unitPrice: String((i.unitPriceCents ?? i.amountCents) / 100) })));
    toast.show(`${label(r)} copied. Change anything, then submit it as a new request.`);
  }
  function submit() {
    if (!category) { toast.show('Choose a category.'); return; }
    if (category === 'Other' && !note.trim()) { toast.show('Say what "Other" is for.'); return; }
    if (parsed.some((i) => !i.description || i.quantity == null || i.unitPriceCents == null || !i.amountCents)) { toast.show('Fill in a description, quantity and unit price for every item.'); return; }
    const { id, saved } = submitRequisition(org.id, {
      requesterName: profile?.displayName ?? 'Staff', category, categoryNote: category === 'Other' ? note.trim().slice(0, 120) : null,
      items: parsed.map((i) => ({ description: i.description.slice(0, 200), quantity: i.quantity!, unitPriceCents: i.unitPriceCents!, amountCents: i.amountCents! })), month: p.month,
    });
    saved.catch((err) => toast.show(friendlyError(err)));
    toast.show(SUBMITTED_TEXT);
    navigate(`${pettyCashBase(org.type)}/${id}`);
  }
  const catRow = cats.find((c) => c.category === category);

  return (
    <div className="page narrow">
      <div className="page-head"><h1>New requisition</h1></div>
      <PettyNav org={org} />
      {p.seesAll && <BudgetHealth org={org} rows={cats} />}
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
        {category === 'Other' && (
          <label className="field"><span>What is "Other" for?</span><input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="For example: generator fuel" /></label>
        )}
        {p.seesAll && catRow && catRow.allocatedCents > 0 && (
          <p className={`small${catRow.spentCents + catRow.pendingCents + total > catRow.allocatedCents ? ' danger-text' : ' muted'}`}>
            {category}: {money(org, catRow.allocatedCents - catRow.spentCents - catRow.pendingCents)} left of {money(org, catRow.allocatedCents)} before this request.
          </p>
        )}
        <h3>Expense items</h3>
        <div className="petty-lines">
          {lines.map((l, n) => (
            <div key={l.key} className="petty-line">
              <label className="field petty-line-desc"><span>Item {n + 1}</span><input value={l.description} maxLength={200} onChange={(e) => update(l.key, 'description', e.target.value)} placeholder="What is it for?" /></label>
              <label className="field petty-line-qty"><span>Qty</span><input inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, 'quantity', e.target.value)} /></label>
              <label className="field petty-line-price"><span>Unit price (KES)</span><input inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, 'unitPrice', e.target.value)} placeholder="0.00" /></label>
              <div className="field petty-line-amount"><span>Amount</span><strong>{parsed[n]!.amountCents != null ? money(org, parsed[n]!.amountCents!) : '–'}</strong></div>
              <button type="button" className="btn btn-quiet danger-text petty-line-del" aria-label={`Delete item ${n + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Delete</button>
            </div>
          ))}
        </div>
        {lines.length < MAX_PETTY_CASH_ITEMS && (
          <button type="button" className="btn btn-quiet align-start" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, description: '', quantity: '1', unitPrice: '' }])}>Add another item</button>
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
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { receipts } = useReceipts(org, reqId);
  if (!p.any) return <NoAccess />;
  const r = p.requisitions.find((x) => x.id === reqId);
  if (!r) return <div className="page narrow"><h1>Requisition</h1><p className="muted">{p.loading ? 'Loading…' : 'This requisition was not found.'}</p><Link to={pettyCashBase(org.type)}>Back to petty cash</Link></div>;
  const step = nextStepFor(r, { uid: p.uid, canCheck: p.canCheck, canApprove: p.canApprove, canSign: p.canSign, isAccountant: p.isAccountant });
  const needsAccountant = waitingForAccountant(r);
  const name = profile?.displayName ?? 'Staff';
  const act = (write: Promise<unknown>, done: string) => { write.catch((err) => toast.show(friendlyError(err))); toast.show(done); };
  const sigs = signaturesOf(r);
  const signOffs = r.signatures
    ? Array.from({ length: REQUEST_SIGNATURES_NEEDED }, (_, n) => {
      const s = sigs[n];
      return { role: s ? s[1].role : `Signature ${n + 1}`, name: s ? s[1].name : null, when: s ? when(s[1].at) : null };
    })
    : [
      { role: 'Accountant', name: r.checked?.name ?? null, when: r.checked ? when(r.checked.at) : null },
      { role: 'Board member', name: r.approved?.name ?? null, when: r.approved ? when(r.approved.at) : null },
    ];

  async function sign() {
    if (!r || !password) return;
    setBusy(true);
    try {
      await confirmOwnPassword(password);
    } catch (err) {
      setBusy(false);
      toast.show(friendlyError(err));
      return;
    }
    const left = REQUEST_SIGNATURES_NEEDED - sigs.length - 1;
    act(signRequisition(org.id, r, name, p.signRole), left <= 0 ? `${label(r)} approved. ${REQUEST_SIGNATURES_NEEDED} stakeholders signed.` : `Signed. ${left} more signature${left === 1 ? '' : 's'} needed.`);
    setPassword('');
    setBusy(false);
  }
  async function pdf() {
    if (!r) return;
    try {
      const file = await requisitionPdf(org, {
        number: r.number, requesterName: r.requesterName, category: r.category, categoryNote: r.categoryNote, items: r.items,
        totalCents: r.totalCents, status: r.status, statusLabel: PETTY_CASH_STATUS_LABELS[r.status], date: when(r.createdAt),
      }, signOffs, receipts.length);
      downloadFile(file);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow petty-print">
      <div className="page-head">
        <h1>{label(r)}</h1>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={() => void pdf()}>{r.status === 'approved' ? 'Download approved PDF' : 'Download PDF'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <PettyNav org={org} />
      <section className="card stack">
        <ul className="petty-figures petty-details">
          <li><span>Requester</span><strong>{r.requesterName}</strong></li>
          <li><span>Category</span><strong>{categoryLabel(r)}</strong></li>
          <li><span>Date</span><strong>{when(r.createdAt)}</strong></li>
          <li><span>Status</span><strong>{r.signatures && r.status === 'submitted' ? `${sigs.length} of ${REQUEST_SIGNATURES_NEEDED} signatures` : PETTY_CASH_STATUS_LABELS[r.status]}</strong></li>
        </ul>
        <h2>Expense items</h2>
        <div className="exam-table-wrap">
          <table className="table petty-items-table">
            <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {r.items.map((i, n) => (
                <tr key={n}><td>{n + 1}</td><td>{i.description}</td><td className="num">{i.quantity ?? 1}</td><td className="num nowrap">{money(org, i.unitPriceCents ?? i.amountCents)}</td><td className="num nowrap">{money(org, i.amountCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="petty-total">Total <strong>{money(org, r.totalCents)}</strong></p>
      </section>
      <section className="card stack">
        <h2>{r.signatures ? 'Authorization' : 'Approval history'}</h2>
        {r.signatures && <p className="small muted">{REQUEST_SIGNATURES_NEEDED} signatories sign, each with their own password, and one of them must be the accountant. The requester cannot sign their own request, and nobody signs twice.</p>}
        {needsAccountant && <p className="notice">Waiting for the accountant's signature. It is the last one needed.</p>}
        <ol className="petty-steps">
          <li className="done"><strong>Requested by {r.requesterName}</strong><span className="small muted">{when(r.createdAt)}</span></li>
          {signOffs.map((s, n) => (
            <li key={n} className={s.name ? 'done' : ''}><strong>{s.name ? `${s.role}: ${s.name}` : r.signatures ? (needsAccountant ? 'Accountant' : `Signature ${n + 1}`) : n === 0 ? 'Checked by the accountant' : 'Final approval by a board member'}</strong><span className="small muted">{s.when ?? 'Not yet'}</span></li>
          ))}
        </ol>
        {r.rejection && <p className="notice">Rejected by {r.rejection.name} ({when(r.rejection.at)}): {r.rejection.reason}</p>}
      </section>
      {step && (
        <section className="card stack no-print">
          <h2>{step === 'sign' ? 'Sign this request' : step === 'check' ? 'Check this request' : 'Give final approval'}</h2>
          {rejecting ? (
            <div className="field-row">
              <label className="field"><span>Why is it rejected?</span><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
              <button type="button" className="btn btn-danger align-start" disabled={!reason.trim()} onClick={() => { act(rejectRequisition(org.id, r.id, name, reason.trim()), 'Request rejected'); setRejecting(false); }}>Reject</button>
              <button type="button" className="btn btn-quiet align-start" onClick={() => setRejecting(false)}>Cancel</button>
            </div>
          ) : step === 'sign' ? (
            <>
              <div className="field-row">
                <label className="field"><span>Signing as</span><input value={`${name} (${p.signRole})`} readOnly /></label>
                <label className="field"><span>Your Insight-IQ password</span>
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password is your signature" disabled={busy} />
                </label>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-primary" disabled={!password || busy} onClick={() => void sign()}>{busy ? 'Checking…' : 'Sign'}</button>
                <button type="button" className="btn btn-quiet danger-text" onClick={() => setRejecting(true)}>Reject</button>
              </div>
            </>
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
      {r.signatures && r.status === 'submitted' && sigs.length < REQUEST_SIGNATURES_NEEDED && (
        <section className="card stack no-print">
          <h2>Another stakeholder signs on this device</h2>
          <CoSignForm label={`Signature ${sigs.length + 1} of ${REQUEST_SIGNATURES_NEEDED}${needsAccountant ? ', the accountant' : ''}. The signatory types their own email and password. You stay signed in.`} onSign={(email, pw) => coSignRequisition(org.id, r, email, pw)} />
        </section>
      )}
      <ReceiptsBox org={org} req={r} receipts={receipts} />
    </div>
  );
}

/** A requisition's receipts: open, add (photos or PDFs) and remove. */
export function ReceiptsBox({ org, req, receipts }: { org: Organization; req: RequisitionRow; receipts: ReceiptRow[] }) {
  const p = usePettyCashAccess();
  const { profile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; type: string; data: string } | null>(null);
  const canAdd = req.status !== 'rejected' && (p.seesAll || req.requesterId === p.uid) && receipts.length < MAX_RECEIPTS_PER_REQUEST;

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, MAX_RECEIPTS_PER_REQUEST - receipts.length);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    let added = 0;
    for (const f of files) {
      try {
        // Saved on this device at once and sent when online.
        const saved = addReceipt(org.id, req.id, f, profile?.displayName ?? 'Staff');
        saved.catch((err) => toast.show(friendlyError(err)));
        await Promise.race([saved, new Promise((r) => setTimeout(r, 1500))]);
        added += 1;
      } catch (err) {
        toast.show(friendlyError(err));
      }
    }
    setBusy(false);
    if (added) toast.show(`${added} receipt${added === 1 ? '' : 's'} added`);
  }
  async function open(rc: ReceiptRow) {
    try {
      const data = await receiptData(org.id, rc.id);
      if (!data) { toast.show('That receipt has not reached this device yet. Try again when online.'); return; }
      setViewing({ name: rc.name, type: rc.type, data });
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }
  function save() {
    if (!viewing) return;
    const a = document.createElement('a');
    a.href = viewing.data;
    a.download = viewing.type === 'application/pdf' ? viewing.name.replace(/(\.pdf)?$/i, '.pdf') : viewing.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
    a.click();
  }

  return (
    <section className="card stack no-print">
      <div className="card-head">
        <h2>Receipts</h2>
        {canAdd && (
          <label className="btn btn-quiet">
            {busy ? 'Adding…' : 'Add receipts'}
            <input type="file" accept="image/*,application/pdf" multiple className="visually-hidden" onChange={(e) => void add(e)} disabled={busy} />
          </label>
        )}
      </div>
      {receipts.length === 0 ? <p className="muted small">No receipts yet. Add a photo or a PDF of each receipt once the money is spent.</p> : (
        <ul className="petty-receipts">
          {receipts.map((rc) => (
            <li key={rc.id}>
              <button type="button" className="petty-receipt" onClick={() => void open(rc)}>
                <span className="petty-receipt-kind">{rc.type === 'application/pdf' ? 'PDF' : 'Photo'}</span>
                <span className="petty-receipt-name">{rc.name}</span>
                <span className="small muted">{Math.max(1, Math.round(rc.size / 1024))} KB · {rc.uploadedByName} · {when(rc.createdAt)}</span>
              </button>
              {(rc.createdBy === p.uid || p.canAuthorize) && (
                <button type="button" className="btn btn-quiet danger-text" onClick={() => { removeReceipt(org.id, rc.id).catch((err) => toast.show(friendlyError(err))); toast.show('Receipt removed'); }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Photos are made smaller before saving. PDFs must be under 700 KB. Up to {MAX_RECEIPTS_PER_REQUEST} per requisition.</p>
      {viewing && createPortal(
        <div className="petty-viewer" role="dialog" aria-modal="true" aria-label={viewing.name} onClick={() => setViewing(null)}>
          <div className="petty-viewer-box" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><strong>{viewing.name}</strong><span className="row-actions"><button type="button" className="btn btn-quiet" onClick={save}>Download</button><button type="button" className="btn btn-primary" onClick={() => setViewing(null)}>Close</button></span></div>
            {viewing.type === 'application/pdf'
              ? <iframe title={viewing.name} src={viewing.data} className="petty-viewer-pdf" />
              : <img src={viewing.data} alt={viewing.name} className="petty-viewer-img" />}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
