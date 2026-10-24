import type { RequisitionRow } from '../state/usePettyCash';

/** What a receipt is called in packs and file names: ADIA-00012-1. */
export const receiptCode = (number: string, n: number) => `${number}-${n}`;

/** Which expense item a receipt is for. */
export function itemLabel(items: { description: string }[], itemIndex: number | null | undefined) {
  if (itemIndex == null || !items[itemIndex]) return 'Whole requisition';
  return `Item ${itemIndex + 1}: ${items[itemIndex].description}`;
}

/** Andy, 2026-10-24: an approved requisition is complete only once a receipt is in; until then it says so. */
export const needsReceipt = (r: Pick<RequisitionRow, 'status'>, receipts: number) => r.status === 'approved' && receipts === 0;
export const receiptStatus = (r: Pick<RequisitionRow, 'status'>, receipts: number, base: string) =>
  r.status !== 'approved' ? base : receipts ? 'Complete' : 'Approved · receipt needed';
