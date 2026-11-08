/**
 * Past petty cash (Andy, 2026-11-08): months before the app was used are added from an Excel sheet. Each
 * requisition comes in already approved, marked as a past record, with the two people who approved it
 * on paper; money that came in is added as top-ups. The sheet's numbers come first, so requisitions
 * made in the app move up after them. Shared by the upload page and the importPastPetty function.
 */
import { DIRECTOR_LIMIT_CENTS, MAX_PETTY_CASH_ITEMS, lineAmountCents, type PettyCashItem } from './pettyCash.js';

/** The sheets the upload reads, by name. Other sheets (such as Summary) are left alone. */
export const PAST_SHEET = 'Upload';
export const PAST_MONEY_SHEET = 'Money in';
export const PAST_COLUMNS = ['Voucher no.', 'Date', 'Requester', 'Category', 'Category note', 'Item', 'Qty', 'Unit price (KES)', 'Amount (KES)',
  'Paid to', 'M-Pesa code', 'Family Bank ref. no.', 'Approver 1', 'Approver 2'] as const;
export const PAST_MONEY_COLUMNS = ['Date', 'Amount (KES)', 'Note'] as const;
/** At most this many requisitions in one upload (a year of weekly and monthly payments fits easily). */
export const MAX_PAST_REQUISITIONS = 400;
export const MAX_PAST_MONEY = 200;

export interface PastRequisition {
  number: string;
  /** YYYY-MM-DD, the day it was paid. */
  date: string;
  requesterName: string;
  category: string;
  categoryNote: string | null;
  items: PettyCashItem[];
  payee: string | null;
  mpesaCode: string | null;
  refNo: string | null;
  approvers: [string, string];
}
export interface PastMoneyIn { date: string; amountCents: number; note: string | null }
export interface PastUpload { requisitions: PastRequisition[]; moneyIn: PastMoneyIn[]; problems: string[] }

type Cell = string | number | boolean | Date | null | undefined;
const text = (v: Cell) => (v == null ? '' : v instanceof Date ? dayOf(v) : String(v)).trim();
const plain = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
/** A date cell (a real date, an Excel day number, or "2026-01-04" / "4/1/2026") as YYYY-MM-DD. */
export function dayOf(v: Cell): string {
  if (v instanceof Date) return new Date(v.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const s = text(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : '';
}
/** Shillings in a cell (a number, or "21,700") as cents, or null. */
function cents(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  const s = text(v).replace(/^(kes|kshs?)\.?/i, '').replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Math.round(Number(s) * 100) : null;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const headerIndex = (row: Cell[], names: readonly string[]) => names.map((n) => row.findIndex((c) => norm(text(c)) === norm(n)));

/**
 * Reads the Upload and Money in sheets (each a list of rows, header first) into requisitions and
 * top-ups. Rows with the same voucher number are one requisition. Problems are listed, not thrown.
 */
export function readPastSheets(upload: Cell[][], money: Cell[][], categories: readonly string[], prefix: string): PastUpload {
  const problems: string[] = [];
  const head = upload.findIndex((r) => r.some((c) => plain(text(c)) === plain('Voucher no.')));
  if (head < 0) return { requisitions: [], moneyIn: [], problems: [`The ${PAST_SHEET} sheet needs a header row starting with "Voucher no.".`] };
  const at = headerIndex(upload[head]!, PAST_COLUMNS);
  const col = (r: Cell[], name: (typeof PAST_COLUMNS)[number]) => { const i = at[PAST_COLUMNS.indexOf(name)]!; return i < 0 ? null : r[i]; };
  const byNumber = new Map<string, PastRequisition>();
  const numberRe = new RegExp(`^${prefix}-\\d{5}$`);
  upload.slice(head + 1).forEach((r, k) => {
    const rowNo = head + k + 2;
    const number = text(col(r, 'Voucher no.')).toUpperCase();
    const item = text(col(r, 'Item'));
    if (!number && !item) return;
    if (!numberRe.test(number)) { problems.push(`Row ${rowNo}: the voucher number should look like ${prefix}-00001.`); return; }
    const qty = typeof col(r, 'Qty') === 'number' ? (col(r, 'Qty') as number) : Number(text(col(r, 'Qty')) || 1);
    const unit = cents(col(r, 'Unit price (KES)')) ?? cents(col(r, 'Amount (KES)'));
    if (!item || !(qty > 0) || unit == null) { problems.push(`Row ${rowNo} (${number}): check the item, quantity and price.`); return; }
    const line: PettyCashItem = { description: item.slice(0, 200), quantity: qty, unitPriceCents: unit, amountCents: lineAmountCents(qty, unit) };
    const seen = byNumber.get(number);
    if (seen) {
      if (seen.items.length >= MAX_PETTY_CASH_ITEMS) problems.push(`${number}: at most ${MAX_PETTY_CASH_ITEMS} items.`);
      else seen.items.push(line);
      return;
    }
    const date = dayOf(col(r, 'Date') as Cell);
    const category = categories.find((c) => plain(c) === plain(text(col(r, 'Category'))));
    const a1 = text(col(r, 'Approver 1')); const a2 = text(col(r, 'Approver 2'));
    const requesterName = text(col(r, 'Requester'));
    if (!date) problems.push(`Row ${rowNo} (${number}): the date is missing or not a date.`);
    if (!category) problems.push(`Row ${rowNo} (${number}): the category must be one of ${categories.join(', ')}.`);
    if (!requesterName) problems.push(`Row ${rowNo} (${number}): the requester is missing.`);
    if (!a1 || !a2 || plain(a1) === plain(a2)) problems.push(`Row ${rowNo} (${number}): two different approvers are needed.`);
    else if ([a1, a2].some((a) => plain(a) === plain(requesterName))) problems.push(`Row ${rowNo} (${number}): the requester cannot approve their own requisition.`);
    const note = text(col(r, 'Category note')).slice(0, 120);
    if (category === 'Other' && !note) problems.push(`Row ${rowNo} (${number}): say what "Other" is for in Category note.`);
    const code = text(col(r, 'M-Pesa code')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code && !/^[A-Z0-9]{10}$/.test(code)) problems.push(`Row ${rowNo} (${number}): an M-Pesa code has 10 letters and numbers.`);
    byNumber.set(number, {
      number, date, requesterName: requesterName.slice(0, 120), category: category ?? '', categoryNote: category === 'Other' ? note : null, items: [line],
      payee: text(col(r, 'Paid to')).slice(0, 120) || null, mpesaCode: code || null, refNo: text(col(r, 'Family Bank ref. no.')).toUpperCase().slice(0, 40) || null,
      approvers: [a1.slice(0, 120), a2.slice(0, 120)],
    });
  });
  const requisitions = [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
  for (const r of requisitions) {
    const total = r.items.reduce((n, i) => n + i.amountCents, 0);
    if (total > DIRECTOR_LIMIT_CENTS && !r.approvers.some((a) => plain(a) === 'andrewguya')) {
      problems.push(`${r.number}: over KES ${(DIRECTOR_LIMIT_CENTS / 100).toLocaleString('en-US')}, so Andrew Guya must be one of the approvers.`);
    }
  }
  if (requisitions.length > MAX_PAST_REQUISITIONS) problems.push(`At most ${MAX_PAST_REQUISITIONS} requisitions in one upload.`);

  const moneyIn: PastMoneyIn[] = [];
  const mHead = money.findIndex((r) => r.some((c) => plain(text(c)) === 'date'));
  if (mHead >= 0) {
    const mAt = headerIndex(money[mHead]!, PAST_MONEY_COLUMNS);
    money.slice(mHead + 1).forEach((r, k) => {
      const d = mAt[0]! >= 0 ? r[mAt[0]!] : null; const a = mAt[1]! >= 0 ? r[mAt[1]!] : null;
      if (d == null && a == null) return;
      const date = dayOf(d as Cell); const amountCents = cents(a as Cell);
      if (!date || amountCents == null) { problems.push(`${PAST_MONEY_SHEET} row ${mHead + k + 2}: check the date and amount.`); return; }
      moneyIn.push({ date, amountCents, note: (mAt[2]! >= 0 ? text(r[mAt[2]!] as Cell) : '').slice(0, 120) || null });
    });
  }
  if (moneyIn.length > MAX_PAST_MONEY) problems.push(`At most ${MAX_PAST_MONEY} money-in rows in one upload.`);
  return { requisitions, moneyIn, problems };
}

/** The sequence in a number such as FCN-00074. */
export const sequenceOf = (number: string | null | undefined) => Number(/-(\d+)$/.exec(number ?? '')?.[1] ?? 0);

/**
 * How far requisitions made in the app must move up so the past ones come first (Andy 5B): none when
 * the lowest app number is already above the highest past number (as on a second upload).
 */
export function renumberShift(pastNumbers: readonly string[], appNumbers: readonly string[]): number {
  const maxPast = Math.max(0, ...pastNumbers.map(sequenceOf));
  const app = appNumbers.map(sequenceOf).filter((n) => n > 0);
  if (!app.length) return 0;
  const minApp = Math.min(...app);
  return minApp > maxPast ? 0 : maxPast - minApp + 1;
}

/** The moment a Nairobi day starts plus the given hours, for dating past records in order. */
export const nairobiMoment = (day: string, hour = 12) => Date.parse(`${day}T00:00:00Z`) - 3 * 3_600_000 + hour * 3_600_000;
