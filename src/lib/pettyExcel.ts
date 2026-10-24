import writeXlsxFile from 'write-excel-file';
import { categoryLabel, PETTY_CASH_STATUS_LABELS, type LedgerLine } from '../../functions/src/shared/pettyCash';
import type { ReceiptRow, RequisitionRow } from '../state/usePettyCash';
import { millis } from '../state/usePettyCash';
import { receiptStatus } from './receiptNames';
import { POWERED_BY } from '../../functions/src/shared/poweredBy';

/**
 * The accountant's Excel workbook (Andy, 2026-10-24): every requisition, every expense line and the
 * cash book for a month ("2026-10") or a year ("2026"), with amounts as numbers so they add up in Excel.
 */
type Cell = { value: string | number | Date | null; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold'; wrap?: boolean } | null;
const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' as const }));
const kes = (cents: number): Cell => ({ value: cents / 100, type: Number, format: '#,##0.00' });
const date = (ms: number | null): Cell => (ms ? { value: new Date(ms), type: Date, format: 'dd mmm yyyy' } : null);
const text = (value: string | null | undefined): Cell => ({ value: value ?? '', type: String });

export async function pettyWorkbook(orgName: string, period: string, requisitions: RequisitionRow[], receipts: ReceiptRow[], ledger: LedgerLine[]): Promise<File> {
  const inPeriod = requisitions.filter((r) => r.month.startsWith(period) && r.status !== 'rejected')
    .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''));
  const count = (id: string) => receipts.filter((x) => x.reqId === id).length;
  const signers = (r: RequisitionRow) => Object.values(r.signatures ?? {}).map((s) => s.name).join('; ');
  const title: Cell[] = [{ value: `${orgName} · Petty cash · ${period}`, fontWeight: 'bold' }];
  const foot: Cell[] = [text(POWERED_BY)];

  const reqSheet: Cell[][] = [title, [],
    head(['Number', 'Date', 'Month', 'Requester', 'Category', 'Items', 'Amount (KES)', 'Status', 'Signed by', 'Paid to', 'M-Pesa code', 'Receipts']),
    ...inPeriod.map((r) => [text(r.number ?? 'New'), date(millis(r.createdAt)), text(r.month), text(r.requesterName), text(categoryLabel(r)),
      text(r.items.map((i) => i.description).join('; ')), kes(r.totalCents), text(receiptStatus(r, count(r.id), PETTY_CASH_STATUS_LABELS[r.status])),
      text(signers(r)), text(r.payee), text(r.mpesaCode), { value: count(r.id), type: Number }]),
    [null, null, null, null, null, { value: 'Total approved', fontWeight: 'bold' }, { ...kes(inPeriod.filter((r) => r.status === 'approved').reduce((n, r) => n + r.totalCents, 0))!, fontWeight: 'bold' }],
    [], foot,
  ];
  const itemSheet: Cell[][] = [title, [],
    head(['Number', 'Date', 'Category', 'Item', 'Description', 'Quantity', 'Unit price (KES)', 'Amount (KES)', 'Paid to', 'M-Pesa code', 'Status']),
    ...inPeriod.flatMap((r) => r.items.map((i, n) => [text(r.number ?? 'New'), date(millis(r.createdAt)), text(categoryLabel(r)), { value: n + 1, type: Number },
      text(i.description), { value: i.quantity ?? 1, type: Number }, kes(i.unitPriceCents ?? i.amountCents), kes(i.amountCents), text(r.payee), text(r.mpesaCode),
      text(PETTY_CASH_STATUS_LABELS[r.status])] as Cell[])),
    [], foot,
  ];
  const monthOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const book = ledger.filter((l) => monthOf(l.at).startsWith(period));
  const cashSheet: Cell[][] = [title, [],
    head(['Date', 'Description', 'Money in (KES)', 'Money out (KES)', 'Balance (KES)']),
    ...book.map((l) => [date(l.at), text(l.description), l.creditCents ? kes(l.creditCents) : null, l.debitCents ? kes(l.debitCents) : null, kes(l.balanceCents)]),
    [null, { value: 'Totals', fontWeight: 'bold' }, kes(book.reduce((n, l) => n + l.creditCents, 0)), kes(book.reduce((n, l) => n + l.debitCents, 0))],
    [], foot,
  ];
  const blob = await writeXlsxFile([reqSheet, itemSheet, cashSheet] as never, {
    sheets: ['Requisitions', 'Expense lines', 'Cash book'],
    columns: [
      [14, 12, 9, 22, 20, 40, 14, 22, 30, 22, 14, 9].map((width) => ({ width })),
      [14, 12, 20, 6, 40, 9, 15, 14, 22, 14, 12].map((width) => ({ width })),
      [12, 50, 15, 15, 15].map((width) => ({ width })),
    ],
  } as never) as unknown as Blob;
  return new File([blob], `${orgName.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-${period}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
