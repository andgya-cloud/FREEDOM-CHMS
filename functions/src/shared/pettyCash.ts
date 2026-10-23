/**
 * ADIA petty cash: a requisition is submitted by the requester, then any two stakeholders sign it, each
 * from their own account with their own password; the third signature approves it. Nobody signs their own
 * request. Requests made before signatures were introduced keep the old steps (accountant checks, then a
 * board member approves). Any two may approve, nobody twice. Firestore rules enforce the same.
 */

import { ACCOUNTANT_TITLE } from './permissions.js';

/** ADIA Training Centre's categories (Andy asked for ones that fit the college, 2026-10-23). */
export const PETTY_CASH_CATEGORIES = ['Training materials', 'Office & supplies', 'Staff Payments', 'Transport', 'Repairs & maintenance', 'Utilities', 'Other'] as const;
/** Categories no longer offered that older requests may still carry (ADIA's old app had "Freedom Hope Center"). */
export const RETIRED_PETTY_CASH_CATEGORIES = ['Freedom Hope Center'] as const;
/** Freedom Hope Center's categories. */
export const HOPE_PETTY_CASH_CATEGORIES = ["Children's needs", 'Programmes & activities', 'Staff Payments', 'Office & supplies', 'Other'] as const;
/** Freedom Church's categories. */
export const CHURCH_PETTY_CASH_CATEGORIES = ['Ministry & programmes', 'Hospitality', 'Staff Payments', 'Office & supplies', 'Other'] as const;
export type PettyCashCategory = (typeof PETTY_CASH_CATEGORIES)[number] | (typeof HOPE_PETTY_CASH_CATEGORIES)[number]
  | (typeof CHURCH_PETTY_CASH_CATEGORIES)[number] | (typeof RETIRED_PETTY_CASH_CATEGORIES)[number];

/** Organizations that keep petty cash: ADIA (a college), Freedom Hope Center (a ministry) and Freedom Church campuses. */
export const PETTY_CASH_ORG_TYPES = ['college', 'ministry', 'church_campus'] as const;

/** The categories offered to an organization: each kind has its own. */
export function pettyCashCategoriesFor(orgType: string | undefined): readonly PettyCashCategory[] {
  return orgType === 'ministry' ? HOPE_PETTY_CASH_CATEGORIES : orgType === 'church_campus' ? CHURCH_PETTY_CASH_CATEGORIES : PETTY_CASH_CATEGORIES;
}

/** Where an organization's petty cash pages live. */
export function pettyCashBase(orgType: string | undefined) {
  return orgType === 'ministry' ? '/hope/petty-cash' : orgType === 'church_campus' ? '/petty-cash' : '/school/petty-cash';
}

export type PettyCashStatus = 'submitted' | 'checked' | 'approved' | 'rejected';
export const PETTY_CASH_STATUS_LABELS: Record<PettyCashStatus, string> = {
  submitted: 'Waiting for signatures',
  checked: 'Waiting for final approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const MAX_PETTY_CASH_ITEMS = 30;

/** One line: what it is, how many and the price of one. `amountCents` is always quantity × unit price. */
export interface PettyCashItem { description: string; amountCents: number; quantity?: number; unitPriceCents?: number }

/** The amount of a line: quantity × unit price, rounded to the cent. */
export function lineAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/** "Other: Fuel for the generator" when the requester said what Other means. */
export function categoryLabel(r: { category: string; categoryNote?: string | null }): string {
  return r.category === 'Other' && r.categoryNote ? `Other: ${r.categoryNote}` : r.category;
}
/** Who checked (accountant) or gave final approval (board member), and when. */
export interface PettyCashSignOff { uid: string; name: string; role: string; at?: unknown }
export interface PettyCashRequisition {
  id: string;
  number: string | null;
  requesterId: string;
  requesterName: string;
  category: PettyCashCategory;
  /** What "Other" refers to; null for every other category. */
  categoryNote?: string | null;
  items: PettyCashItem[];
  totalCents: number;
  /** The month it counts against, "2026-10". */
  month: string;
  status: PettyCashStatus;
  checked: PettyCashSignOff | null;
  approved: PettyCashSignOff | null;
  rejection: { uid: string; name: string; reason: string; at?: unknown } | null;
  /** Stakeholders who signed, keyed by their account. Absent on requests made before signatures. */
  signatures?: Record<string, PettyCashSignature>;
}

/** A stakeholder's signature on a requisition. */
export interface PettyCashSignature { name: string; role: string; at?: unknown }

/** Signatures that approve a requisition. */
export const REQUEST_SIGNATURES_NEEDED = 2;

/** The requisition number the server gives the 15th request: "ADIA-00015". */
export function pettyCashNumber(prefix: string, sequence: number): string {
  return `${prefix || 'PC'}-${String(sequence).padStart(5, '0')}`;
}

export function itemsTotalCents(items: readonly { amountCents: number }[]): number {
  return items.reduce((sum, i) => sum + (Number.isFinite(i.amountCents) ? i.amountCents : 0), 0);
}

export interface PettyCashActor { uid: string; canCheck: boolean; canApprove: boolean; canSign?: boolean; isAccountant?: boolean }


/**
 * Whether the accountant must be one of the signatures. Andy asked for it on 2026-10-22, then for
 * "Any three to approve" and later "any two" on 2026-10-23, so it is off; turning it back on also needs the check in firestore.rules.
 */
export const ACCOUNTANT_REQUIRED = false;

/** True when only the accountant's signature can complete this request: two others have signed and the accountant has not. */
export function waitingForAccountant(r: Pick<PettyCashRequisition, 'status' | 'signatures'>): boolean {
  if (!ACCOUNTANT_REQUIRED || r.status !== 'submitted' || !r.signatures) return false;
  const sigs = Object.values(r.signatures);
  return sigs.length >= REQUEST_SIGNATURES_NEEDED - 1 && !sigs.some((s) => s.role === ACCOUNTANT_TITLE);
}

/** What this person may do with a requisition right now: "sign", or on an older request "check" or "approve". */
export function nextStepFor(r: Pick<PettyCashRequisition, 'status' | 'requesterId' | 'checked' | 'signatures'>, actor: PettyCashActor): 'sign' | 'check' | 'approve' | null {
  if (r.requesterId === actor.uid) return null;
  if (r.signatures) {
    if (r.status !== 'submitted' || !actor.canSign || actor.uid in r.signatures) return null;
    // The accountant must be one of the signatures, so the last place is kept for them.
    return waitingForAccountant(r) && !actor.isAccountant ? null : 'sign';
  }
  if (r.status === 'submitted' && actor.canCheck) return 'check';
  if (r.status === 'checked' && actor.canApprove && r.checked?.uid !== actor.uid) return 'approve';
  return null;
}

/** Signatures needed before money is added to petty cash, or the budget is reset. */
export const FUND_SIGNATURES_NEEDED = 2;
export type PettyFundKind = 'topup' | 'reset';
export type PettyFundStatus = 'collecting' | 'done' | 'cancelled';
export interface PettyFundSignature { name: string; at?: unknown }
/** A top-up (money added) or a reset (the budget starts again from zero), signed by two stakeholders. */
export interface PettyFund {
  id: string;
  kind: PettyFundKind;
  /** Zero for a reset. */
  amountCents: number;
  /** Keyed by the signer's account. */
  signatures: Record<string, PettyFundSignature>;
  status: PettyFundStatus;
  doneAt?: unknown;
}

/** The status a fund record takes once it has this many signatures. */
export function fundStatusAfter(signatureCount: number): PettyFundStatus {
  return signatureCount >= FUND_SIGNATURES_NEEDED ? 'done' : 'collecting';
}

export interface FundSummary {
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  /** Requests still waiting for a signature. */
  pendingCents: number;
}

/**
 * Budget, spending and what is left since the last reset. Only completed top-ups count, and only approved
 * requests are spent. `millis` reads a stored time; a time still being saved (null) counts as now.
 */
export function fundSummary(
  funds: readonly Pick<PettyFund, 'kind' | 'amountCents' | 'status' | 'doneAt'>[],
  requisitions: readonly Pick<PettyCashRequisition, 'status' | 'totalCents' | 'approved'>[],
  millis: (t: unknown) => number | null,
  now = Date.now(),
): FundSummary {
  const at = (t: unknown) => millis(t) ?? now;
  let periodStart = -Infinity;
  for (const f of funds) if (f.kind === 'reset' && f.status === 'done') periodStart = Math.max(periodStart, at(f.doneAt));
  let budgetCents = 0;
  for (const f of funds) if (f.kind === 'topup' && f.status === 'done' && at(f.doneAt) > periodStart) budgetCents += f.amountCents;
  let spentCents = 0;
  let pendingCents = 0;
  for (const r of requisitions) {
    if (r.status === 'approved' && at(r.approved?.at) > periodStart) spentCents += r.totalCents;
    else if (r.status === 'submitted' || r.status === 'checked') pendingCents += r.totalCents;
  }
  return { budgetCents, spentCents, remainingCents: budgetCents - spentCents, pendingCents };
}

/** Shillings typed in a box ("1,250.50") as cents, or null when it is not a valid amount. */
export function parseAmountCents(text: string): number | null {
  // Accepts what people type: "500,000", "KES 500000", "Ksh 500 000/=".
  const clean = text.replace(/^\s*(kes|kshs?|sh)\.?/i, '').replace(/(\/=|\/-)\s*$/, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** A line of the petty cash balance sheet: money in (a signed top-up) or out (an approved request). */
export interface LedgerLine {
  id: string;
  /** Milliseconds, for ordering. */
  at: number;
  kind: 'topup' | 'reset' | 'request';
  description: string;
  creditCents: number;
  debitCents: number;
  /** What is left after this line, within the budget period it belongs to. */
  balanceCents: number;
}

/**
 * The balance sheet, oldest first: every completed top-up adds to the balance, every approved request
 * takes from it, and a completed reset starts the balance again from zero.
 */
export function pettyLedger(
  funds: readonly Pick<PettyFund, 'id' | 'kind' | 'amountCents' | 'status' | 'doneAt'>[],
  requisitions: readonly (Pick<PettyCashRequisition, 'id' | 'number' | 'status' | 'totalCents' | 'approved' | 'requesterName' | 'category'> & { categoryNote?: string | null })[],
  millis: (t: unknown) => number | null,
  now = Date.now(),
): LedgerLine[] {
  const at = (t: unknown) => millis(t) ?? now;
  const lines: Omit<LedgerLine, 'balanceCents'>[] = [];
  for (const f of funds) {
    if (f.status !== 'done') continue;
    lines.push(f.kind === 'topup'
      ? { id: f.id, at: at(f.doneAt), kind: 'topup', description: 'Top-up signed by 3 stakeholders', creditCents: f.amountCents, debitCents: 0 }
      : { id: f.id, at: at(f.doneAt), kind: 'reset', description: 'Budget reset to zero, signed by 3 stakeholders', creditCents: 0, debitCents: 0 });
  }
  for (const r of requisitions) {
    if (r.status !== 'approved') continue;
    lines.push({ id: r.id, at: at(r.approved?.at), kind: 'request', description: `${r.number ?? 'Request'} · ${categoryLabel(r)} · ${r.requesterName}`, creditCents: 0, debitCents: r.totalCents });
  }
  lines.sort((a, b) => a.at - b.at || (a.kind === 'request' ? 1 : 0) - (b.kind === 'request' ? 1 : 0));
  let balance = 0;
  return lines.map((l) => {
    balance = l.kind === 'reset' ? 0 : balance + l.creditCents - l.debitCents;
    return { ...l, balanceCents: balance };
  });
}

/** Each category's allowance next to what was approved and what is waiting, since the last reset. */
export interface CategoryBudgetRow { category: string; allocatedCents: number; spentCents: number; pendingCents: number }

export function categoryBudgets(
  categories: readonly string[],
  allocations: Readonly<Record<string, number>>,
  requisitions: readonly Pick<PettyCashRequisition, 'status' | 'totalCents' | 'approved' | 'category'>[],
  periodStart: number,
  millis: (t: unknown) => number | null,
  now = Date.now(),
): CategoryBudgetRow[] {
  return categories.map((category) => {
    let spentCents = 0;
    let pendingCents = 0;
    for (const r of requisitions) {
      if (r.category !== category) continue;
      if (r.status === 'approved' && (millis(r.approved?.at) ?? now) > periodStart) spentCents += r.totalCents;
      else if (r.status === 'submitted' || r.status === 'checked') pendingCents += r.totalCents;
    }
    return { category, allocatedCents: allocations[category] ?? 0, spentCents, pendingCents };
  });
}

/** When the current budget period began: the last completed reset, or the beginning of time. */
export function periodStartOf(funds: readonly Pick<PettyFund, 'kind' | 'status' | 'doneAt'>[], millis: (t: unknown) => number | null, now = Date.now()): number {
  let start = -Infinity;
  for (const f of funds) if (f.kind === 'reset' && f.status === 'done') start = Math.max(start, millis(f.doneAt) ?? now);
  return start;
}

/**
 * Receipt files are kept in the database in parts of up to RECEIPT_PART_CHARS characters each, so a
 * file of up to 10 MB fits (Andy, 2026-10-23). Big photos are still made smaller before saving.
 */
export const MAX_RECEIPT_BYTES = 10_000_000;
export const RECEIPT_PART_CHARS = 900_000;
export const MAX_RECEIPT_PARTS = 16;
export const MAX_RECEIPTS_PER_REQUEST = 10;
/** Photos above this size are made smaller (as JPEG); smaller ones keep their own format. */
export const SHRINK_PHOTOS_OVER_BYTES = 1_500_000;

/** The receipt formats accepted, by file extension, and the type each is saved as. */
export const RECEIPT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain', rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES).map((x) => `.${x}`).join(',') + ',image/*,application/pdf';

/** The saved type of a receipt file, from its extension or the type the device reports; null when not accepted. */
export function receiptTypeOf(name: string, reported: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (RECEIPT_TYPES[ext]) return RECEIPT_TYPES[ext];
  const known = Object.values(RECEIPT_TYPES);
  return known.includes(reported) ? reported : null;
}

/** A short word for a receipt's kind, shown on its card. */
export function receiptKindLabel(type: string): string {
  if (type === 'application/pdf') return 'PDF';
  if (type.startsWith('image/')) return 'Photo';
  if (type.includes('word') || type.includes('opendocument.text') || type === 'application/rtf') return 'Word';
  if (type.includes('excel') || type.includes('spreadsheet')) return 'Excel';
  if (type === 'text/csv') return 'CSV';
  return 'File';
}

/** Splits a file's data URL into the parts saved in the database. */
export function splitReceiptData(data: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += RECEIPT_PART_CHARS) parts.push(data.slice(i, i + RECEIPT_PART_CHARS));
  return parts;
}

/*
 * The bin (Andy, 2026-10-23): deleting any petty cash entry, putting it back, or deleting it forever
 * each needs two stakeholders. The one who asks signs first. Every step is kept as a record.
 */
export type BinKind = 'request' | 'fund' | 'receipt';
export type BinAction = 'delete' | 'restore' | 'purge';
export type BinState = 'live' | 'in-bin' | 'purged';
export const BIN_SIGNATURES_NEEDED = 2;
export const BIN_ACTION_LABELS: Record<BinAction, string> = { delete: 'Move to bin', restore: 'Put back', purge: 'Delete forever' };
export const BIN_DONE_LABELS: Record<BinAction, string> = { delete: 'Moved to bin', restore: 'Put back', purge: 'Deleted forever' };
export interface BinSignature { uid: string; name: string; title: string; at: unknown }
export interface BinMotion { action: BinAction; reason: string; startedBy: string; signatures: BinSignature[] }
export interface BinHistoryEntry { action: BinAction; reason: string; signatures: BinSignature[]; doneAt: unknown }
export interface BinEntry {
  orgId: string; kind: BinKind; targetId: string; label: string; amountCents: number | null; reqId: string | null;
  state: BinState; motion: BinMotion | null; history: BinHistoryEntry[];
}

/** Which actions an entry in this state may be asked for. */
export function binActionsFor(state: BinState): BinAction[] {
  return state === 'live' ? ['delete'] : state === 'in-bin' ? ['restore', 'purge'] : [];
}

/** The entry's state once an action is complete. */
export function binStateAfter(action: BinAction): BinState {
  return action === 'delete' ? 'in-bin' : action === 'restore' ? 'live' : 'purged';
}

/** Wrong PIN tries before a stakeholder's signing PIN locks, and for how long. */
export const PIN_MAX_TRIES = 5;
export const PIN_LOCK_MINUTES = 15;

/** A signing PIN: 4 to 6 digits, not all the same digit. Returns the PIN, or null when it will not do. */
export function checkPin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pin = value.trim();
  if (!/^\d{4,6}$/.test(pin) || /^(\d)\1+$/.test(pin)) return null;
  return pin;
}
