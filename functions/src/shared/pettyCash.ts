/**
 * ADIA petty cash: a requisition is submitted by the requester, checked by the accountant, then given
 * final approval by a board member. Nobody acts on their own request, and the final approver must be a
 * different person from the one who checked it. Firestore rules enforce the same steps.
 */

/** ADIA Training Centre's categories, from its old petty cash app. */
export const PETTY_CASH_CATEGORIES = ['Freedom Hope Center', 'Staff Payments', 'Other'] as const;
/** Freedom Hope Center's categories. */
export const HOPE_PETTY_CASH_CATEGORIES = ["Children's needs", 'Programmes & activities', 'Staff Payments', 'Office & supplies', 'Other'] as const;
/** Freedom Church's categories. */
export const CHURCH_PETTY_CASH_CATEGORIES = ['Ministry & programmes', 'Hospitality', 'Staff Payments', 'Office & supplies', 'Other'] as const;
export type PettyCashCategory = (typeof PETTY_CASH_CATEGORIES)[number] | (typeof HOPE_PETTY_CASH_CATEGORIES)[number]
  | (typeof CHURCH_PETTY_CASH_CATEGORIES)[number];

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
  submitted: 'Waiting for the accountant',
  checked: 'Waiting for final approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const MAX_PETTY_CASH_ITEMS = 30;

export interface PettyCashItem { description: string; amountCents: number }
/** Who checked (accountant) or gave final approval (board member), and when. */
export interface PettyCashSignOff { uid: string; name: string; role: string; at?: unknown }
export interface PettyCashRequisition {
  id: string;
  number: string | null;
  requesterId: string;
  requesterName: string;
  category: PettyCashCategory;
  items: PettyCashItem[];
  totalCents: number;
  /** The month it counts against, "2026-10". */
  month: string;
  status: PettyCashStatus;
  checked: PettyCashSignOff | null;
  approved: PettyCashSignOff | null;
  rejection: { uid: string; name: string; reason: string; at?: unknown } | null;
}

/** The requisition number the server gives the 15th request: "ADIA-00015". */
export function pettyCashNumber(prefix: string, sequence: number): string {
  return `${prefix || 'PC'}-${String(sequence).padStart(5, '0')}`;
}

export function itemsTotalCents(items: readonly { amountCents: number }[]): number {
  return items.reduce((sum, i) => sum + (Number.isFinite(i.amountCents) ? i.amountCents : 0), 0);
}

export interface PettyCashActor { uid: string; canCheck: boolean; canApprove: boolean }

/** What this person may do with a requisition right now: "check", "approve" or nothing. */
export function nextStepFor(r: Pick<PettyCashRequisition, 'status' | 'requesterId' | 'checked'>, actor: PettyCashActor): 'check' | 'approve' | null {
  if (r.requesterId === actor.uid) return null;
  if (r.status === 'submitted' && actor.canCheck) return 'check';
  if (r.status === 'checked' && actor.canApprove && r.checked?.uid !== actor.uid) return 'approve';
  return null;
}

/** Signatures needed before money is added to petty cash, or the budget is reset. */
export const FUND_SIGNATURES_NEEDED = 3;
export type PettyFundKind = 'topup' | 'reset';
export type PettyFundStatus = 'collecting' | 'done' | 'cancelled';
export interface PettyFundSignature { name: string; at?: unknown }
/** A top-up (money added) or a reset (the budget starts again from zero), signed by three stakeholders. */
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
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
