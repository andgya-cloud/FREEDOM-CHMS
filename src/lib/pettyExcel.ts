import writeXlsxFile from 'write-excel-file';
import { POWERED_BY } from '../../functions/src/shared/poweredBy';

/**
 * The accountant's Excel workbook (Andy, 2026-10-24): every requisition, every expense line and the
 * cash book for a month ("2026-10") or a year ("2026"), with amounts as numbers so they add up in Excel.
 */
type Cell = { value: string | number | Date | null; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold'; wrap?: boolean } | null;
const head = (labels: string[]): Cell[] => labels.map((value) => ({ value, fontWeight: 'bold' as const }));
const kes = (cents: number): Cell => ({ value: cents / 100, type: Number, format: '#,##0.00' });
const text = (value: string | null | undefined): Cell => ({ value: value ?? '', type: String });

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
