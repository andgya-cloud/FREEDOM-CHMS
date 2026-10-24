import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { millis, usePettyCash, usePettyCashAccess, useReceipts, type FundRow, type ReceiptRow, type RequisitionRow } from '../../state/usePettyCash';
import { addReceipt, approveRequisition, cancelFund, checkRequisition, receiptData, rejectRequisition, submitRequisition } from '../../lib/pettyCashWrites';
import { requisitionPdf } from '../../lib/pettyPdf';
import { listPettyContacts, listPettySigners, raisePettyRequest, sendPettyEmail, setPinWithPassword, signWithPin, topUpWithPin, type PettySigner } from '../../lib/pettyPin';
import { PettySignBox } from './PettySignBox';
import { AskDeleteDialog, BinButton, BinNotice } from './PettyBin';
import { downloadFile } from '../../lib/givingPdf';
import {
  categoryBudgets, categoryLabel, checkPin, lineAmountCents, type CategoryBudgetRow,
  ADIA_TOPUP_NAMES, fundSignaturesNeeded, itemsTotalCents, waitingForAccountant, MAX_RECEIPTS_PER_REQUEST, REQUEST_SIGNATURES_NEEDED, MAX_PETTY_CASH_ITEMS, nextStepFor, parseAmountCents, RECEIPT_ACCEPT, receiptKindLabel,
  PETTY_CASH_ORG_TYPES, pettyCashBase, pettyCashCategoriesFor, PETTY_CASH_STATUS_LABELS, type PettyCashCategory, type PettyFundKind,
} from '../../../functions/src/shared/pettyCash';
import { money } from './common';
import { PettyInsights } from '../../components/PettyInsights';
import { useOrg } from '../../state/OrgContext';
import type { Organization } from '../../state/OrgContext';
import { PasswordInput } from '../../components/PasswordInput';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { Timestamp } from 'firebase/firestore';

const when = (t: unknown) => (t && typeof (t as Timestamp).toDate === 'function'
  ? (t as Timestamp).toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now');
const label = (r: RequisitionRow) => r.number ?? 'New request';
/** What the stakeholders were emailed about this request, by whom and when. */
function noticeLine(n: NonNullable<RequisitionRow['notice']>) {
  const parts = [];
  if (n.askEmailAt) parts.push(`Approval request emailed to ${n.askEmailed ?? 0} by ${n.askEmailBy ?? 'the requester'}, ${when(n.askEmailAt)}.`);
  else if (n.askedAt && n.askEmailed) parts.push(`Asked to approve by email ${when(n.askedAt)}.`);
  if (n.approvedEmailAt) parts.push(`Signed voucher emailed to ${n.approvedEmailed ?? 0} by ${n.approvedEmailBy ?? 'the requester'}, ${when(n.approvedEmailAt)}.`);
  return parts.join(' ');
}

/** The WhatsApp message the requester sends from their own phone. */
function waText(org: Organization, r: RequisitionRow, approvedBy: string[]) {
  const link = `${location.origin}${pettyCashBase(org.type)}/${r.id}`;
  const head = `${label(r)} for ${money(org, r.totalCents)} (${categoryLabel(r)}), raised by ${r.requesterName}`;
  return r.status === 'approved'
    ? `*${org.name}: petty cash approved*\nRequisition ${head}, has been approved by ${approvedBy.join(' and ')}.\nThe signed payment voucher is attached.\n${link}`
    : `*${org.name}: petty cash approval needed*\nRequisition ${head}.\nItems: ${r.items.map((i) => i.description).join('; ')}\nAny ${REQUEST_SIGNATURES_NEEDED} stakeholders please review and sign here:\n${link}`;
}
const waLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
/** Phones share the PDF straight into WhatsApp; computers save it and open WhatsApp. */
function canSharePdf() {
  try {
    return window.matchMedia('(pointer: coarse)').matches && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File([''], 'voucher.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

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
    [`${base}/balance-sheet`, 'Balance sheet', p.seesAll], [`${base}/budget`, 'Budget tracker', p.seesAll], [`${base}/bin`, 'Bin', p.seesAll],
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
  // An older top-up still waiting for a signature is shown, but only counts once it is finished.
  const pending = p.funds.find((f) => f.kind === 'topup' && f.status === 'collecting');
  const pendingLeft = pending ? Math.max(1, fundSignaturesNeeded('topup') - Object.keys(pending.signatures).length) : 0;
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
        <small>2-SIG AUTH</small>
      </button>
    </div>
  );
}


const FUND_TEXT: Record<PettyFundKind, { title: string; sub: string; done: string }> = {
  topup: { title: 'Top-Up', sub: 'Any one stakeholder tops up with their own PIN.', done: 'Top-up complete. The money is now in the budget.' },
  reset: { title: 'Reset Budget Authorization', sub: 'Any two stakeholders approve the reset: each picks their name and types their PIN.', done: 'Budget reset. It now starts again from zero.' },
};

/**
 * A top-up (one stakeholder's PIN, Andy 2026-10-24) or a reset collecting its two signatures. An older
 * top-up still waiting for a second signature is finished by the next PIN.
 */
function FundCard({ org, kind, onClose }: { org: Organization; kind: PettyFundKind; onClose?: () => void }) {
  const p = usePettyCash(org);
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const amountBox = useRef<HTMLInputElement>(null);
  const [askDelete, setAskDelete] = useState(false);
  const open: FundRow | undefined = p.funds.find((f) => f.kind === kind && f.status === 'collecting');
  const signed = open ? Object.entries(open.signatures).sort(([, a], [, b]) => ((a.at as Timestamp)?.toMillis?.() ?? Date.now()) - ((b.at as Timestamp)?.toMillis?.() ?? Date.now())) : [];
  const cents = kind === 'topup' ? (open ? open.amountCents : parseAmountCents(amount)) : 0;
  const ready = kind === 'reset' || (cents != null && cents > 0);
  const text = FUND_TEXT[kind];
  const needed = fundSignaturesNeeded(kind);
  const slots = Math.max(needed, signed.length + (open ? 1 : 0));
  const quickTopUp = kind === 'topup' && !open;
  // "Add KES … to the budget?" before any money moves, to catch a mistyped amount.
  const [confirming, setConfirming] = useState<((yes: boolean) => void) | null>(null);
  const askConfirm = () => new Promise<boolean>((resolve) => setConfirming(() => resolve));
  const answer = (yes: boolean) => { confirming?.(yes); setConfirming(null); };
  const topUpWho = org.type === 'college' ? `Any one of ${ADIA_TOPUP_NAMES.join(', ').replace(/, ([^,]*)$/, ' or $1')} tops up with their own PIN.` : text.sub;

  return (
    <section className={`petty-auth petty-auth-${kind}`} aria-label={text.title}>
      <div className="petty-auth-head">
        <div className="petty-auth-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d={kind === 'topup' ? 'M9 3h6l-1.5 3h-3zM6 10c0-2 2.7-4 6-4s6 2 6 4l1 8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM12 10v7M10 12.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-1 1-2 1.3-2 .6-2 1.4.9 1.3 2 1.3 2-.6 2-1.3' : 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4'} /></svg>
        </div>
        <div className="petty-auth-title"><h2>{text.title}</h2><p>{kind === 'topup' ? topUpWho : text.sub}</p></div>
        {!quickTopUp && <span className="petty-auth-count">{signed.length}/{slots}</span>}
      </div>
      <div className="petty-auth-body">
        {kind === 'topup' && (open ? (
          <p className="petty-auth-amount">Top-up of <strong>{money(org, open.amountCents)}</strong>, started by {signed[0]?.[1].name ?? 'a stakeholder'}</p>
        ) : (
          <label className="field"><span className="petty-caps">Top-up amount (KES)</span>
            <input ref={amountBox} inputMode="decimal" className={ready ? '' : 'petty-amount-empty'} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Type the amount here, e.g. 500000" disabled={!p.canAuthorize} />
            {amount.trim() && (cents != null && cents > 0
              ? <small className="petty-amount-ok">{money(org, cents)} will be added to the budget as soon as you confirm below.</small>
              : <small className="petty-amount-bad">Type the amount in numbers only, for example 500000 or 500,000.</small>)}
          </label>
        ))}
        {kind === 'reset' && <p className="petty-warn">Resetting sets the total budget and spending back to zero. Requests still waiting for a signature carry over.</p>}
        {!ready && !amount.trim() && <p className="petty-warn">Step 1: type the top-up amount in the box above. Step 2: choose your name, type your PIN or password and press Top up.</p>}
        {quickTopUp ? (
          <PettySignBox label="Choose your name and type your PIN or password." orgId={org.id} topUpOnly directorMode ready={ready} exclude={[]} confirmLabel="✓ Top up"
            sign={async (uid, pin) => {
              if (!(await askConfirm())) return 'Top-up cancelled. Nothing was added.';
              const who = await topUpWithPin(org.id, cents ?? 0, uid, pin);
              setAmount('');
              return `Top-up of ${money(org, cents ?? 0)} by ${who} is done. The money is now in the budget.`;
            }} />
        ) : (
        <ol className="petty-signers">
          {Array.from({ length: slots }, (_, n) => {
            const s = signed[n];
            return (
              <li key={n} className={s ? 'signed' : ''}>
                <div className="petty-signer-head"><span className="petty-signer-no">{s ? '✓' : n + 1}</span><h3>Authorizer {n + 1}</h3>{s && <span className="petty-signer-when">{when(s[1].at)}</span>}</div>
                {s ? (
                  <p className="petty-signer-name">Signed by {s[1].name}</p>
                ) : n === signed.length && (open || p.canAuthorize) ? (
                  <PettySignBox label="Choose your name and type your PIN or password." orgId={org.id} fundOnly directorMode exclude={open ? Object.keys(open.signatures) : []}
                    sign={async (uid, pin) => {
                      if (!open) return `Signed by ${await topUpWithPin(org.id, 0, uid, pin, kind)}. ${needed - 1} more signature${needed - 1 === 1 ? '' : 's'} needed.`;
                      const who = await signWithPin(org.id, 'fund', open.id, uid, pin);
                      const last = signed.length + 1 >= needed;
                      if (last && kind === 'reset') onClose?.();
                      return last ? `Signed by ${who}. ${text.done}` : `Signed by ${who}.`;
                    }} />
                ) : (
                  <p className="petty-signer-name muted">Waiting for the signature above</p>
                )}
              </li>
            );
          })}
        </ol>
        )}
        <div className="row-actions">
          {open && open.createdBy !== p.uid && p.canSign && <button type="button" className="btn btn-quiet danger-text" onClick={() => setAskDelete(true)}>Delete this {kind === 'topup' ? 'top-up' : 'reset'}</button>}
          {open && open.createdBy === p.uid && <button type="button" className="btn btn-quiet danger-text" onClick={() => { cancelFund(org.id, open.id).catch((err) => toast.show(friendlyError(err))); toast.show('Cancelled'); }}>Cancel this {kind === 'topup' ? 'top-up' : 'reset'}</button>}
          {onClose && !open && <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>}
        </div>
        <ConfirmDialog open={!!confirming} title={`Add ${money(org, cents ?? 0)} to the budget?`} body={`The ${org.name} petty cash budget goes up by ${money(org, cents ?? 0)} straight away.`}
          confirmLabel="Confirm" onConfirm={() => answer(true)} onCancel={() => answer(false)} />
        {open && <AskDeleteDialog org={org} kind="fund" targetId={open.id} open={askDelete} onClose={() => setAskDelete(false)}
          title={`Delete this ${kind === 'topup' ? 'top-up' : 'reset'}?`} body={kind === 'topup' ? `Top-up of ${money(org, open.amountCents)}.` : 'Budget reset.'} />}
      </div>
    </section>
  );
}

function RequisitionList({ org, rows, empty }: { org: Organization; rows: RequisitionRow[]; empty: string }) {
  const p = usePettyCashAccess();
  const [deleting, setDeleting] = useState<RequisitionRow | null>(null);
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <>
      <ul className="link-list">
        {rows.map((r) => (
          <li key={r.id} className="petty-row">
            <Link to={`${pettyCashBase(org.type)}/${r.id}`}>
              <span className="link-title">{label(r)} · {r.requesterName}</span>
              <span className="link-detail">{money(org, r.totalCents)} · {r.signatures && r.status === 'submitted' ? `${Object.keys(r.signatures).length} of ${REQUEST_SIGNATURES_NEEDED} signatures` : PETTY_CASH_STATUS_LABELS[r.status]} · {categoryLabel(r)}</span>
            </Link>
            {(p.canSign || r.requesterId === p.uid) && <BinButton label={`Delete ${label(r)}`} onClick={() => setDeleting(r)} />}
          </li>
        ))}
      </ul>
      <AskDeleteDialog org={org} kind="request" targetId={deleting?.id ?? ''} open={!!deleting} onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${label(deleting)}?` : ''} body={deleting ? `${money(org, deleting.totalCents)} · ${categoryLabel(deleting)} · ${deleting.requesterName}.` : ''} />
    </>
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
      {p.seesAll && <Stats org={org} onReset={() => {
        setShowReset(true);
        // Bring the reset card into view and put the cursor in its password box, so the press clearly does something.
        setTimeout(() => {
          const card = document.querySelector<HTMLElement>('.petty-auth-reset');
          card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card?.querySelector<HTMLInputElement>('input[type="password"]')?.focus({ preventScroll: true });
        }, 50);
      }} />}
      {p.seesAll && (showReset || resetOpen) && <FundCard org={org} kind="reset" onClose={() => setShowReset(false)} />}
      {p.seesAll && <FundCard org={org} kind="topup" />}
      {p.canSign && <BinNotice org={org} />}
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
  // ADIA (Andy, 2026-10-23): the requester is picked from the stakeholders; anyone but the person signed in types their PIN.
  const isAdia = org.type === 'college';
  const [signers, setSigners] = useState<PettySigner[] | null>(null);
  const [requester, setRequester] = useState('');
  const [pin, setPin] = useState('');
  const [settingPin, setSettingPin] = useState(false);
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isAdia) return;
    let live = true;
    listPettySigners(org.id).then((list) => { if (live) setSigners(list); }).catch(() => { if (live) setSigners([]); });
    return () => { live = false; };
  }, [org.id, isAdia]);
  const others = (signers ?? []).filter((x) => x.uid !== p.uid);
  const chosen = others.find((x) => x.uid === requester);
  const needsPinSetup = !!chosen && (!chosen.hasPin || settingPin);
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
  /** What is still missing, or null when the request is ready. */
  function missing() {
    if (!category) return 'Choose a category.';
    if (category === 'Other' && !note.trim()) return 'Say what "Other" is for.';
    if (parsed.some((i) => !i.description || i.quantity == null || i.unitPriceCents == null || !i.amountCents)) return 'Fill in a description, quantity and unit price for every item.';
    return null;
  }
  const input = () => ({
    category: category as PettyCashCategory, categoryNote: category === 'Other' ? note.trim().slice(0, 120) : null,
    items: parsed.map((i) => ({ description: i.description.slice(0, 200), quantity: i.quantity!, unitPriceCents: i.unitPriceCents!, amountCents: i.amountCents! })), month: p.month,
  });
  /** ADIA: the chosen stakeholder raises it as theirs on this device, with their PIN. */
  async function raiseForChosen() {
    if (!chosen) return;
    if (needsPinSetup) {
      if (!checkPin(newPin)) { toast.show('Choose a PIN of 4 to 6 digits, not all the same digit.'); return; }
      if (newPin !== newPin2) { toast.show('The two PINs are not the same.'); return; }
      if (!password) { toast.show(`${chosen.name} types their Insight-IQ password once to set a PIN.`); return; }
    } else if (pin.length < 4) { toast.show(`${chosen.name} types their signing PIN.`); return; }
    setBusy(true);
    try {
      if (needsPinSetup) await setPinWithPassword(chosen.email, password, newPin);
      const res = await raisePettyRequest({ orgId: org.id, requesterUid: chosen.uid, pin: needsPinSetup ? newPin : pin, ...input() });
      toast.show(`Request raised for ${res.name}. It now needs ${REQUEST_SIGNATURES_NEEDED} stakeholder signatures.`);
      navigate(`${pettyCashBase(org.type)}/${res.id}`);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const code = e?.code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') toast.show(`That password is not right for ${chosen.name}.`);
      else if (code.startsWith('functions/') && e.message) toast.show(e.message.replace(/\s*\[\d+\]$/, ''));
      else toast.show(code === 'auth/network-request-failed' || code.includes('unavailable') ? 'Raising a request for someone else needs a connection.' : friendlyError(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    const problem = missing();
    if (problem) { toast.show(problem); return; }
    if (chosen) { void raiseForChosen(); return; }
    const { id, saved } = submitRequisition(org.id, { requesterName: profile?.displayName ?? 'Staff', ...input() });
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
          {isAdia ? (
            <label className="field"><span>Requester</span>
              <select value={chosen ? chosen.uid : ''} disabled={busy} onChange={(e) => { setRequester(e.target.value); setPin(''); setSettingPin(false); setPassword(''); setNewPin(''); setNewPin2(''); }}>
                <option value="">{profile?.displayName ?? 'Me'} (me)</option>
                {others.map((x) => <option key={x.uid} value={x.uid}>{x.name}{x.title ? ` (${x.title})` : ''}</option>)}
              </select>
            </label>
          ) : <label className="field"><span>Requester</span><input value={profile?.displayName ?? ''} readOnly /></label>}
          <label className="field"><span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as PettyCashCategory)}>
              <option value="">Choose a category…</option>
              {pettyCashCategoriesFor(org.type).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {chosen && !needsPinSetup && (
          <div className="petty-signer-row">
            <label className="field"><span>{chosen.name}'s signing PIN</span>
              <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 to 6 digits" disabled={busy} />
            </label>
            <button type="button" className="btn btn-quiet petty-pin-link align-start" onClick={() => setSettingPin(true)}>Forgot the PIN? Set a new one</button>
          </div>
        )}
        {needsPinSetup && (
          <div className="petty-pin-setup">
            <p className="small">{chosen!.hasPin ? `${chosen!.name}, set a new PIN.` : `${chosen!.name} has no PIN yet. Set one now; next time only the PIN is needed.`} Type your Insight-IQ password once to prove it is you.</p>
            <div className="petty-signer-row">
              <label className="field"><span>{chosen!.name}'s Insight-IQ password</span>
                <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </label>
              <label className="field"><span>New PIN (4 to 6 digits)</span>
                <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} disabled={busy} />
              </label>
              <label className="field"><span>Type the PIN again</span>
                <PasswordInput inputMode="numeric" autoComplete="off" maxLength={6} value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} disabled={busy} />
              </label>
            </div>
            {chosen!.hasPin && <button type="button" className="btn btn-quiet petty-pin-link" onClick={() => setSettingPin(false)}>Back to PIN</button>}
          </div>
        )}
        {chosen && <p className="small muted">This is saved as {chosen.name}'s request, so {chosen.name} cannot sign it.</p>}
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
      <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : chosen ? `Submit requisition for ${chosen.name}` : 'Submit requisition'}</button>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [waPeople, setWaPeople] = useState<{ name: string; phone: string }[] | null>(null);
  const [waOpen, setWaOpen] = useState(false);
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

  const makePdf = () => requisitionPdf(org, {
    number: r.number, requesterName: r.requesterName, category: r.category, categoryNote: r.categoryNote, items: r.items,
    totalCents: r.totalCents, status: r.status, statusLabel: PETTY_CASH_STATUS_LABELS[r.status], date: when(r.createdAt),
  }, signOffs, receipts.length);
  async function pdf() {
    try {
      downloadFile(await makePdf());
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }
  // Send Email / Send WhatsApp (Andy, 2026-10-23): nothing goes out on its own; the requester sends it.
  // Shown at the top for anyone with petty cash access, straight after a requisition is raised (Andy, 2026-10-24).
  const canSend = !!r.signatures && (r.status === 'submitted' || r.status === 'approved') && p.any;
  const numbered = !!r.number;
  async function sendEmail() {
    setSending(true);
    try {
      const res = await sendPettyEmail(org.id, r!.id);
      const who = res.names?.length ? `: ${res.names.join(', ')}` : '';
      toast.show(`${r!.status === 'approved' ? 'Signed voucher' : 'Approval request'} emailed to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}${who}.`);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      toast.show(e?.code?.startsWith('functions/') && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : friendlyError(err));
    } finally {
      setSending(false);
    }
  }
  // Send WhatsApp to one stakeholder at a time, straight to their number (Andy, 2026-10-24).
  function openWhatsapp() {
    setWaOpen((o) => !o);
    if (!waPeople) listPettyContacts(org.id).then(setWaPeople).catch((err) => { setWaPeople([]); toast.show(friendlyError(err)); });
  }
  async function whatsappTo(phone: string) {
    const link = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(waText(org, r!, sigs.map(([, s]) => `${s.name} (${s.role})`)))}`;
    if (r!.status !== 'approved') { window.open(link, '_blank', 'noopener'); return; }
    const w = window.open('about:blank', '_blank');
    try {
      downloadFile(await makePdf());
      if (w) w.location.href = link; else window.location.href = link;
      toast.show('The signed voucher PDF was saved to this device. Attach it in WhatsApp.');
    } catch (err) {
      w?.close();
      toast.show(friendlyError(err));
    }
  }
  async function sendWhatsapp() {
    const text = waText(org, r!, sigs.map(([, s]) => `${s.name} (${s.role})`));
    if (r!.status !== 'approved') { window.open(waLink(text), '_blank', 'noopener'); return; }
    if (canSharePdf()) {
      try {
        await navigator.share({ files: [await makePdf()], text, title: `${label(r!)} approved` });
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') toast.show(friendlyError(err));
      }
      return;
    }
    // A computer: open WhatsApp now (before the PDF is made, so the browser allows it), then save the voucher to attach.
    const w = window.open('about:blank', '_blank');
    try {
      downloadFile(await makePdf());
      if (w) w.location.href = waLink(text); else window.location.href = waLink(text);
      toast.show('The signed voucher PDF was saved to your Downloads. Attach it in WhatsApp.');
    } catch (err) {
      w?.close();
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
      {canSend && (
        <section className="card stack no-print">
          <h2>{r.status === 'approved' ? 'Send the signed voucher' : 'Ask the stakeholders to approve'}</h2>
          <p className="small muted">{r.status === 'approved'
            ? `The petty cash voucher with its details and the ${REQUEST_SIGNATURES_NEEDED} signatures, to every stakeholder and ${r.requesterName}.`
            : `Tells the stakeholders that any ${REQUEST_SIGNATURES_NEEDED} of them must sign, with a link to this request. ${r.requesterName} cannot sign it.`}</p>
          {!numbered && <p className="small muted">Giving this requisition its number… The buttons work in a moment{navigator.onLine ? '' : ', once this device is online'}.</p>}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={sending || !numbered} onClick={() => void sendEmail()}>{sending ? 'Sending…' : 'Send Email'}</button>
            <button type="button" className="btn btn-whatsapp" disabled={!numbered} onClick={openWhatsapp}>Send WhatsApp</button>
          </div>
          {waOpen && (
            <div className="stack">
              <p className="small muted">Tap a name. WhatsApp opens their chat with the message ready{r.status === 'approved' ? ', and the voucher PDF is saved for you to attach' : ''}. Press send there, then come back for the next person.</p>
              <div className="row-actions">
                {waPeople === null ? <span className="small muted">Loading…</span> : waPeople.map((c) => (
                  <button key={c.phone} type="button" className="btn btn-whatsapp" onClick={() => void whatsappTo(c.phone)}>{c.name}</button>
                ))}
                <button type="button" className="btn btn-quiet" onClick={() => void sendWhatsapp()}>A group or someone else</button>
              </div>
            </div>
          )}
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
        {r.signatures && <p className="small muted">Any two to approve. A stakeholder cannot approve twice, and the requester cannot approve their own request. Each signs from their own account or with their name and PIN.</p>}
        {r.notice && <p className="small muted petty-notice-line">{noticeLine(r.notice)}</p>}
        {needsAccountant && <p className="notice">Waiting for the accountant's signature. It is the last one needed.</p>}
        <ol className="petty-steps">
          <li className="done"><strong>Requested by {r.requesterName}</strong><span className="small muted">{when(r.createdAt)}</span></li>
          {signOffs.map((s, n) => (
            <li key={n} className={s.name ? 'done' : ''}><strong>{s.name ? `${s.role}: ${s.name}` : r.signatures ? (needsAccountant ? 'Accountant' : `Signature ${n + 1}`) : n === 0 ? 'Checked by the accountant' : 'Final approval by a board member'}</strong><span className="small muted">{s.when ?? 'Not yet'}</span></li>
          ))}
        </ol>
        {r.rejection && <p className="notice">Rejected by {r.rejection.name} ({when(r.rejection.at)}): {r.rejection.reason}</p>}
      </section>
        </section>
      )}
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
              <PettySignBox label={`Signature ${sigs.length + 1} of ${REQUEST_SIGNATURES_NEEDED}${needsAccountant ? ', the accountant' : ''}. Choose your name and type your own signing PIN.`} orgId={org.id} exclude={[r.requesterId, ...Object.keys(r.signatures ?? {})]}
                sign={async (uid, pin) => `Signed by ${await signWithPin(org.id, 'request', r.id, uid, pin)}.`} />
              <div className="row-actions">
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
      {step !== 'sign' && r.signatures && r.status === 'submitted' && sigs.length < REQUEST_SIGNATURES_NEEDED && (
        <section className="card stack no-print">
          <h2>Another stakeholder signs on this device</h2>
          <PettySignBox label={`Signature ${sigs.length + 1} of ${REQUEST_SIGNATURES_NEEDED}${needsAccountant ? ', the accountant' : ''}. The signatory picks their name and types their own PIN. You stay signed in.`} orgId={org.id} exclude={[r.requesterId, ...Object.keys(r.signatures)]}
            sign={async (uid, pin) => `Signed by ${await signWithPin(org.id, 'request', r.id, uid, pin)}.`} />
        </section>
      )}
      <ReceiptsBox org={org} req={r} receipts={receipts} />
      {(p.canSign || r.requesterId === p.uid) && (
        <section className="card stack no-print">
          <h2>Delete this request</h2>
          <p className="small muted">{p.isPastor ? 'You can delete it on your own.' : 'Any two stakeholders must approve.'} It then moves to the Bin, out of every list and the budget figures, and can be put back from there.</p>
          <div className="row-actions"><button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete request</button></div>
        </section>
      )}
      <AskDeleteDialog org={org} kind="request" targetId={r.id} open={confirmDelete} onClose={() => setConfirmDelete(false)}
        title={`Delete ${label(r)}?`} body={`${money(org, r.totalCents)} · ${categoryLabel(r)}.`} />
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
  const [removing, setRemoving] = useState<ReceiptRow | null>(null);
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
    a.download = /\.[a-z0-9]+$/i.test(viewing.name) && !(viewing.type === 'image/jpeg' && !/\.jpe?g$/i.test(viewing.name)) ? viewing.name : viewing.name.replace(/\.[a-z0-9]+$/i, '') + (viewing.type === 'image/jpeg' ? '.jpg' : '');
    a.click();
  }

  return (
    <section className="card stack no-print">
      <div className="card-head">
        <h2>Receipts</h2>
        {canAdd && (
          <label className="btn btn-quiet">
            {busy ? 'Adding…' : 'Add receipts'}
            <input type="file" accept={RECEIPT_ACCEPT} multiple className="visually-hidden" onChange={(e) => void add(e)} disabled={busy} />
          </label>
        )}
      </div>
      {receipts.length === 0 ? <p className="muted small">No receipts yet. Add a photo or a PDF of each receipt once the money is spent.</p> : (
        <ul className="petty-receipts">
          {receipts.map((rc) => (
            <li key={rc.id}>
              <button type="button" className="petty-receipt" onClick={() => void open(rc)}>
                <span className="petty-receipt-kind">{receiptKindLabel(rc.type)}</span>
                <span className="petty-receipt-name">{rc.name}</span>
                <span className="small muted">{Math.max(1, Math.round(rc.size / 1024))} KB · {rc.uploadedByName} · {when(rc.createdAt)}</span>
              </button>
              {(rc.createdBy === p.uid || p.canSign) && <BinButton label={`Remove ${rc.name}`} onClick={() => setRemoving(rc)} />}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Photos (JPG, PNG, HEIC and more), PDF, Word, Excel or CSV, up to 10 MB each and {MAX_RECEIPTS_PER_REQUEST} per requisition. Big photos are made smaller. {p.isPastor ? 'You can remove a receipt on your own; others need two stakeholders.' : 'Removing a receipt needs two stakeholders.'}</p>
      <AskDeleteDialog org={org} kind="receipt" targetId={removing?.id ?? ''} open={!!removing} onClose={() => setRemoving(null)}
        title="Remove this receipt?" body={removing ? `${removing.name}, added by ${removing.uploadedByName}.` : ''} />
      {viewing && createPortal(
        <div className="petty-viewer" role="dialog" aria-modal="true" aria-label={viewing.name} onClick={() => setViewing(null)}>
          <div className="petty-viewer-box" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><strong>{viewing.name}</strong><span className="row-actions"><button type="button" className="btn btn-quiet" onClick={save}>Download</button><button type="button" className="btn btn-primary" onClick={() => setViewing(null)}>Close</button></span></div>
            {viewing.type === 'application/pdf'
              ? <iframe title={viewing.name} src={viewing.data} className="petty-viewer-pdf" />
              : ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'].includes(viewing.type)
                ? <img src={viewing.data} alt={viewing.name} className="petty-viewer-img" />
                : <p className="petty-viewer-file">This {receiptKindLabel(viewing.type)} file cannot be shown here. Use Download to open it on this device.</p>}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
