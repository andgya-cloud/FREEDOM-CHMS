/**
 * ADIA petty cash: a requisition is submitted by the requester, checked by the accountant, then given
 * final approval by a board member. Nobody acts on their own request, and the final approver must be a
 * different person from the one who checked it. Firestore rules enforce the same steps.
 */

export const PETTY_CASH_CATEGORIES = ['Freedom Hope Center', 'Staff Payments', 'Other'] as const;
export type PettyCashCategory = (typeof PETTY_CASH_CATEGORIES)[number];

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

export interface BudgetSummary {
  budgetCents: number | null;
  approvedCents: number;
  pendingCents: number;
  /** Budget less what is approved and what is still waiting; negative when over. */
  balanceCents: number | null;
  usedPercent: number;
  state: 'healthy' | 'warning' | 'over' | 'none';
}

/** This month's budget against the requisitions counted in it. Rejected ones do not count. */
export function budgetSummary(budgetCents: number | null, month: string, requisitions: readonly Pick<PettyCashRequisition, 'month' | 'status' | 'totalCents'>[], extraCents = 0): BudgetSummary {
  let approvedCents = 0;
  let pendingCents = extraCents;
  for (const r of requisitions) {
    if (r.month !== month) continue;
    if (r.status === 'approved') approvedCents += r.totalCents;
    else if (r.status === 'submitted' || r.status === 'checked') pendingCents += r.totalCents;
  }
  if (budgetCents == null) return { budgetCents, approvedCents, pendingCents, balanceCents: null, usedPercent: 0, state: 'none' };
  const used = approvedCents + pendingCents;
  const balanceCents = budgetCents - used;
  const usedPercent = budgetCents > 0 ? (used / budgetCents) * 100 : used > 0 ? 100 : 0;
  return { budgetCents, approvedCents, pendingCents, balanceCents, usedPercent, state: balanceCents < 0 ? 'over' : usedPercent > 90 ? 'warning' : 'healthy' };
}

/** Shillings typed in a box ("1,250.50") as cents, or null when it is not a valid amount. */
export function parseAmountCents(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
