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
    head(['Number', 'Date', 'Month', 'Requester', 'Category', 'Items', 'Amount (KES)', 'Status', 'Signed by', 'Paid to', 'M-Pesa code', 'Family Bank ref. no.', 'Receipts']),
    ...inPeriod.map((r) => [text(r.number ?? 'New'), date(millis(r.createdAt)), text(r.month), text(r.requesterName), text(categoryLabel(r)),
      text(r.items.map((i) => i.description).join('; ')), kes(r.totalCents), text(receiptStatus(r, count(r.id), PETTY_CASH_STATUS_LABELS[r.status])),
      text(signers(r)), text(r.payee), text(r.mpesaCode), text(r.refNo), { value: count(r.id), type: Number }]),
    [null, null, null, null, null, { value: 'Total approved', fontWeight: 'bold' }, { ...kes(inPeriod.filter((r) => r.status === 'approved').reduce((n, r) => n + r.totalCents, 0))!, fontWeight: 'bold' }],
    [], foot,
  ];
  const itemSheet: Cell[][] = [title, [],
    head(['Number', 'Date', 'Category', 'Item', 'Description', 'Quantity', 'Unit price (KES)', 'Amount (KES)', 'Paid to', 'M-Pesa code', 'Family Bank ref. no.', 'Status']),
    ...inPeriod.flatMap((r) => r.items.map((i, n) => [text(r.number ?? 'New'), date(millis(r.createdAt)), text(categoryLabel(r)), { value: n + 1, type: Number },
      text(i.description), { value: i.quantity ?? 1, type: Number }, kes(i.unitPriceCents ?? i.amountCents), kes(i.amountCents), text(r.payee), text(r.mpesaCode), text(r.refNo),
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

/** The professional report as Excel (Andy, 2026-11-08): Summary, Categories, Months (a year), Vouchers, Money in. */
export async function pettyReportWorkbook(orgName: string, rep: import('../../functions/src/shared/pettyReport').PettyReport, approvedBy: string): Promise<File> {
  const { changeLabel, REPORT_PREPARED_BY } = await import('../../functions/src/shared/pettyReport');
  const day = (d: string): Cell => ({ value: new Date(`${d}T12:00:00Z`), type: Date, format: 'dd mmm yyyy' });
  const bold = (value: string): Cell => ({ value, fontWeight: 'bold' });
  const title: Cell[] = [{ value: `${orgName} · Petty cash report · ${rep.name}`, fontWeight: 'bold' }];
  const foot: Cell[] = [text(POWERED_BY)];
  const summary: Cell[][] = [title, [],
    [bold('Opening balance (KES)'), kes(rep.openingCents)],
    [bold('Money in (KES)'), kes(rep.inCents)],
    [bold('Money out (KES)'), kes(rep.outCents)],
    [bold('Closing balance (KES)'), kes(rep.closingCents)],
    [], [bold('Vouchers paid'), { value: rep.vouchers.length, type: Number }],
    [bold(`Money out in ${rep.beforeName} (KES)`), kes(rep.beforeOutCents)],
    [bold('Change'), text(changeLabel(rep.outCents, rep.beforeOutCents))],
    [bold('Requests waiting'), text(`${rep.waiting.count} (KES ${(rep.waiting.cents / 100).toLocaleString('en-US')})`)],
    [bold('Vouchers without a receipt'), { value: rep.missingReceipts, type: Number }],
    [bold('Past records'), { value: rep.pastRecords, type: Number }],
    [], [bold('Prepared by'), text(`${REPORT_PREPARED_BY.name} (${REPORT_PREPARED_BY.role})`), text('Signature:'), text('Date:')],
    [bold('Approved by'), text(approvedBy), text('Signature:'), text('Date:')],
    [], foot,
  ];
  const cats: Cell[][] = [title, [], head(['Category', 'Vouchers', 'Share', `${rep.beforeName} (KES)`, 'Change', 'Amount (KES)']),
    ...rep.categories.map((c) => [text(c.category), { value: c.count, type: Number }, { value: c.share, type: Number, format: '0%' }, kes(c.beforeCents), text(changeLabel(c.cents, c.beforeCents)), kes(c.cents)] as Cell[]),
    [bold('Total'), { value: rep.vouchers.length, type: Number }, null, kes(rep.beforeOutCents), text(changeLabel(rep.outCents, rep.beforeOutCents)), { ...kes(rep.outCents)!, fontWeight: 'bold' }],
    [], foot];
  const months: Cell[][] = [title, [], head(['Month', 'Vouchers', 'Opening (KES)', 'Money in (KES)', 'Money out (KES)', 'Closing (KES)']),
    ...rep.months.map((r) => [text(r.name), { value: r.vouchers, type: Number }, kes(r.openingCents), kes(r.inCents), kes(r.outCents), kes(r.closingCents)] as Cell[]), [], foot];
  const vouchers: Cell[][] = [title, [], head(['Voucher', 'Date', 'Requester', 'Paid to', 'Category', 'M-Pesa code', 'Family Bank ref. no.', 'Approved by', 'Receipts', 'Past record', 'Amount (KES)']),
    ...rep.vouchers.map((v) => [text(v.number), day(v.date), text(v.requester), text(v.payee), text(v.category), text(v.mpesaCode), text(v.refNo), text(v.approvedBy),
      { value: v.receipts, type: Number }, text(v.past ? 'Yes' : ''), kes(v.cents)] as Cell[]),
    [bold('Total'), null, null, null, null, null, null, null, null, null, { ...kes(rep.outCents)!, fontWeight: 'bold' }], [], foot];
  const moneyIn: Cell[][] = [title, [], head(['Date', 'Added by', 'Note', 'Amount (KES)']),
    ...rep.moneyIn.map((f) => [day(f.date), text(f.by), text(f.note), kes(f.cents)] as Cell[]),
    [bold('Total'), null, null, { ...kes(rep.inCents)!, fontWeight: 'bold' }], [], foot];
  const year = rep.period.length === 4;
  const data = year ? [summary, cats, months, vouchers, moneyIn] : [summary, cats, vouchers, moneyIn];
  const blob = await writeXlsxFile(data as never, {
    sheets: year ? ['Summary', 'Categories', 'Months', 'Vouchers', 'Money in'] : ['Summary', 'Categories', 'Vouchers', 'Money in'],
    columns: [
      [32, 30, 18, 18].map((width) => ({ width })),
      [28, 10, 9, 22, 10, 16].map((width) => ({ width })),
      ...(year ? [[20, 10, 16, 16, 16, 16].map((width) => ({ width }))] : []),
      [13, 13, 18, 26, 22, 14, 18, 30, 9, 11, 15].map((width) => ({ width })),
      [13, 26, 40, 15].map((width) => ({ width })),
    ],
  } as never) as unknown as Blob;
  return new File([blob], `${orgName.replace(/[^A-Za-z0-9]+/g, '-')}-petty-cash-report-${rep.period}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
