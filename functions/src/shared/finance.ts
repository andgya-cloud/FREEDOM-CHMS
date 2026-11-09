/**
 * Financial statements from bank statements (Andy, 2026-11-08, 1A-8A), the same in ADIA, Freedom Church
 * and Hope: read a Family Bank (or M-Pesa) statement, sort each line into a category (learning from the
 * corrections people make), and build the Income and Expenditure statement, Balance Sheet, Cash Flow,
 * Bank Reconciliation and Budget vs Actual for a month ("2026-10") or a year ("2026").
 *
 * Money is kept in cents. Dates are YYYY-MM-DD as printed on the statement.
 */

// ---- Categories -------------------------------------------------------------------

export type FinGroup = 'income' | 'expense' | 'capital' | 'loan' | 'transfer';
export interface FinCategory { id: string; label: string; group: FinGroup; dir: 'in' | 'out' | 'both' }

export const FIN_CATEGORIES: readonly FinCategory[] = [
  { id: 'tithes', label: 'Tithes', group: 'income', dir: 'in' },
  { id: 'offerings', label: 'Offerings', group: 'income', dir: 'in' },
  { id: 'giving', label: 'Other giving and donations', group: 'income', dir: 'in' },
  { id: 'fees', label: 'Fees (school and training)', group: 'income', dir: 'in' },
  { id: 'grants', label: 'Sponsorships and grants', group: 'income', dir: 'in' },
  { id: 'fundraising', label: 'Fundraising and events', group: 'income', dir: 'in' },
  { id: 'hire', label: 'Rent and hire received', group: 'income', dir: 'in' },
  { id: 'interest', label: 'Interest earned', group: 'income', dir: 'in' },
  { id: 'refund', label: 'Refunds received', group: 'income', dir: 'in' },
  { id: 'otherIncome', label: 'Other income', group: 'income', dir: 'in' },
  { id: 'salaries', label: 'Salaries and allowances', group: 'expense', dir: 'out' },
  { id: 'statutory', label: 'NSSF, SHIF, PAYE and housing levy', group: 'expense', dir: 'out' },
  { id: 'rent', label: 'Rent', group: 'expense', dir: 'out' },
  { id: 'utilities', label: 'Electricity and water', group: 'expense', dir: 'out' },
  { id: 'comms', label: 'Internet, phone and airtime', group: 'expense', dir: 'out' },
  { id: 'ministry', label: 'Ministry and events', group: 'expense', dir: 'out' },
  { id: 'outreach', label: 'Outreach and missions', group: 'expense', dir: 'out' },
  { id: 'welfare', label: 'Welfare and benevolence', group: 'expense', dir: 'out' },
  { id: 'food', label: 'Food and refreshments', group: 'expense', dir: 'out' },
  { id: 'transport', label: 'Transport and fuel', group: 'expense', dir: 'out' },
  { id: 'repairs', label: 'Repairs and maintenance', group: 'expense', dir: 'out' },
  { id: 'office', label: 'Office and stationery', group: 'expense', dir: 'out' },
  { id: 'learning', label: 'Teaching and learning materials', group: 'expense', dir: 'out' },
  { id: 'bankCharges', label: 'Bank and M-Pesa charges', group: 'expense', dir: 'out' },
  { id: 'professional', label: 'Audit, legal and professional fees', group: 'expense', dir: 'out' },
  { id: 'otherExpense', label: 'Other expenses', group: 'expense', dir: 'out' },
  { id: 'equipment', label: 'Equipment and furniture bought', group: 'capital', dir: 'out' },
  { id: 'building', label: 'Building and land', group: 'capital', dir: 'out' },
  { id: 'loanIn', label: 'Loan received', group: 'loan', dir: 'in' },
  { id: 'loanOut', label: 'Loan repayment', group: 'loan', dir: 'out' },
  { id: 'transfer', label: 'Moved between our own accounts', group: 'transfer', dir: 'both' },
  { id: 'toPetty', label: 'Moved to petty cash', group: 'transfer', dir: 'out' },
];

const BY_ID = new Map(FIN_CATEGORIES.map((c) => [c.id, c]));
export const finCategory = (id: string): FinCategory => BY_ID.get(id) ?? (BY_ID.get('otherExpense') as FinCategory);
export const finLabel = (id: string): string => BY_ID.get(id)?.label ?? id;
export const isFinCategory = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);
/** The categories a line can take: money in or money out. */
export function categoriesFor(dir: 'in' | 'out'): FinCategory[] {
  return FIN_CATEGORIES.filter((c) => c.dir === dir || c.dir === 'both');
}

// ---- Statement lines ----------------------------------------------------------------

/** One line of a statement, kept short because a year's statement holds thousands. */
export interface BankLine {
  /** Date, YYYY-MM-DD. */ d: string;
  /** Description as on the statement. */ t: string;
  /** Reference or cheque number. */ r: string;
  /** Money in, cents. */ i: number;
  /** Money out, cents. */ o: number;
  /** Balance after the line, cents. */ b: number;
  /** Category id. */ c: string;
  /** Sure: a person chose it, or a clear rule did. Lines that are not sure wait in "Needs you". */ s: boolean;
}

export interface BankStatement {
  id: string;
  account: string;
  accountKind: 'bank' | 'mpesa';
  fileName: string;
  from: string;
  to: string;
  openingCents: number;
  closingCents: number;
  lines: BankLine[];
}

export type OrgKind = 'church' | 'school' | 'hope';

// ---- Reading numbers and dates ------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
function validDate(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A date at the start of the text: 05/10/2026, 05-10-26, 2026-10-05, 05 Oct 2026, 05-OCT-26, 5th October 2026. Day first, as in Kenya. */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/.exec(s);
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?![\d])/.exec(s);
  if (m) return validDate(fullYear(+m[3]!), +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})(?![\d])/.exec(s);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3)];
    return mo ? validDate(fullYear(+m[3]!), mo, +m[1]!) : null;
  }
  m = /^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{4})(?![\d])/.exec(s);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
    return mo ? validDate(+m[3]!, mo, +m[2]!) : null;
  }
  return null;
}

/**
 * An amount of money: 1,234.50 · -1,234.50 · (1,234.50) · 1,234.50 CR · 1,234.50DR · KES 1,234.50.
 * Text needs two decimals so account and reference numbers are never taken for money.
 * Gives cents (negative for minus, brackets or DR) or null.
 */
export function parseMoneyText(text: string): number | null {
  let s = text.trim().replace(/^(KES|KSH|KSHS|Ksh\.?)\s*/i, '');
  let sign = 1;
  const tail = /\s*(CR|DR|Cr|Dr|C|D)$/.exec(s);
  if (tail) { if (/^d/i.test(tail[1]!)) sign = -1; s = s.slice(0, tail.index); }
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1); }
  if (/^[-−]/.test(s)) { sign = -sign; s = s.slice(1); } else if (/^\+/.test(s)) s = s.slice(1);
  if (/-$/.test(s)) { sign = -sign; s = s.slice(0, -1); }
  if (!/^(\d{1,3}(,\d{3})+|\d+)\.\d{2}$/.test(s)) return null;
  return sign * Math.round(Number(s.replace(/,/g, '')) * 100);
}

// ---- Reading a statement table --------------------------------------------------------

/** One cell of a statement row, with where it sits across the page (PDF points, or the column number for Excel). */
export interface StatementCell { text: string; x0: number; x1: number; value?: number | Date | null }
type Col = 'date' | 'desc' | 'ref' | 'in' | 'out' | 'amount' | 'balance';

const HEADERS: [Col, RegExp][] = [
  ['in', /^(credit|credits|credit amount|cr amount|paid in|deposits?|money in|receipts?|lodgements?|credit \(kes\))$/i],
  ['out', /^(debit|debits|debit amount|dr amount|withdrawn|withdrawals?|paid out|money out|payments?|debit \(kes\))$/i],
  ['balance', /^(balance|running balance|book balance|ledger balance|closing balance|balance \(kes\)|available balance)$/i],
  ['amount', /^(amount|transaction amount|amount \(kes\))$/i],
  ['date', /^(date|trans\.? date|transaction date|txn date|tran date|posting date|post date|completion time|book date|value date)$/i],
  ['desc', /^(description|details|narrative|narration|particulars|transaction details|remarks|transaction description|transaction type)$/i],
  ['ref', /^(reference|ref|ref\.? no\.?|reference no\.?|cheque|cheque no\.?|chq no\.?|receipt no\.?|transaction id|doc no\.?|instrument)$/i],
];
const OPENING = /(opening balance|balance b\/?f|brought forward|balance brought|bal b\/f|previous balance|start balance)/i;
const CLOSING = /(closing balance|balance c\/?f|carried forward|ending balance|bal c\/f)/i;
const SKIP = /^(total|totals|sub ?total|page \d|statement period|account (number|name)|printed|generated)/i;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const centre = (c: StatementCell) => (c.x0 + c.x1) / 2;

interface RawLine { d: string; t: string; r: string; amounts: { cents: number; col: Col | null }[] }

export interface ParsedStatement {
  lines: Omit<BankLine, 'c' | 's'>[];
  openingCents: number;
  closingCents: number;
  from: string;
  to: string;
  /** Lines where the printed balance does not follow from the one before (a missing or misread line). */
  balanceBreaks: number;
  problems: string[];
}

/** Reads statement rows (from a PDF or a spreadsheet) into lines with money in, money out and the balance. */
export function parseStatementRows(rows: StatementCell[][]): ParsedStatement {
  let header: { col: Col; x0: number; x1: number }[] | null = null;
  let opening: number | null = null;
  let closing: number | null = null;
  const raw: RawLine[] = [];
  const colFor = (c: StatementCell): Col | null => {
    if (!header) return null;
    // The header whose span overlaps the number most, otherwise the nearest by centre.
    let best: Col | null = null; let bestScore = -Infinity;
    for (const h of header) {
      const overlap = Math.min(c.x1, h.x1) - Math.max(c.x0, h.x0);
      const score = overlap > 0 ? overlap + 1000 : -Math.abs(centre(c) - (h.x0 + h.x1) / 2);
      if (score > bestScore) { bestScore = score; best = h.col; }
    }
    return best;
  };

  for (const row of rows) {
    const cells = row.map((c) => ({ ...c, text: tidy(c.text) })).filter((c) => c.text || c.value instanceof Date || typeof c.value === 'number');
    if (!cells.length) continue;
    const joined = cells.map((c) => c.text).join(' ');
    // A header row: three or more cells that name columns.
    const named = cells.map((c) => ({ c, col: HEADERS.find(([, re]) => re.test(c.text.replace(/[:*]/g, '').trim()))?.[0] ?? null }));
    if (named.filter((n) => n.col).length >= 3 && named.some((n) => n.col === 'balance' || n.col === 'in' || n.col === 'out' || n.col === 'amount')) {
      header = named.filter((n) => n.col).map((n) => ({ col: n.col!, x0: n.c.x0, x1: n.c.x1 }));
      // Two date columns (transaction and value date): the first is the date.
      continue;
    }
    const moneyCol = (c: StatementCell) => { const col = colFor(c); return !header || col === 'in' || col === 'out' || col === 'amount' || col === 'balance'; };
    const money = cells.map((c) => ({ c, cents: typeof c.value === 'number' ? Math.round(c.value * 100) : parseMoneyText(c.text) }))
      .filter((x) => x.cents != null && moneyCol(x.c)) as { c: StatementCell; cents: number }[];
    const dateCell = cells.slice(0, 3).find((c) => c.value instanceof Date || parseDateText(c.text));
    const date = dateCell ? (dateCell.value instanceof Date ? isoOf(dateCell.value) : parseDateText(dateCell.text)) : null;

    if (OPENING.test(joined) && money.length) { if (opening == null) opening = money[money.length - 1]!.cents; continue; }
    if (CLOSING.test(joined) && money.length) { closing = money[money.length - 1]!.cents; continue; }
    if (SKIP.test(joined)) continue;

    if (date && money.length) {
      const words: string[] = []; const refs: string[] = [];
      for (const c of cells) {
        if (c === dateCell || money.some((x) => x.c === c)) continue;
        if (c.value instanceof Date || (parseDateText(c.text) && c.text.length <= 20 && words.length === 0)) continue; // a value date
        if (colFor(c) === 'ref') refs.push(c.text); else words.push(c.text);
      }
      raw.push({ d: date, t: tidy(words.join(' ')), r: tidy(refs.join(' ')), amounts: money.map((x) => ({ cents: x.cents, col: colFor(x.c) })) });
    } else if (!date && !money.length && raw.length && cells.every((c) => !HEADERS.some(([, re]) => re.test(c.text)))) {
      // A description that runs onto the next line.
      const last = raw[raw.length - 1]!;
      const more = cells.filter((c) => colFor(c) !== 'ref').map((c) => c.text).join(' ');
      if (more.length <= 120 && last.t.length < 300) last.t = tidy(`${last.t} ${more}`);
    }
  }

  // Newest first (as M-Pesa prints them): turn round so the balance runs forward.
  if (raw.length > 1 && raw[0]!.d > raw[raw.length - 1]!.d) raw.reverse();

  const lines: Omit<BankLine, 'c' | 's'>[] = [];
  const problems: string[] = [];
  let prev: number | null = opening;
  let breaks = 0;
  for (const l of raw) {
    let i = 0, o = 0; let b: number | null = null;
    const byCol = (col: Col) => l.amounts.find((a) => a.col === col);
    const inA = byCol('in'), outA = byCol('out'), balA = byCol('balance'), amtA = byCol('amount');
    if (header && (inA || outA || balA || amtA)) {
      if (inA) i = Math.abs(inA.cents);
      if (outA) o = Math.abs(outA.cents);
      if (!inA && !outA && amtA) { if (amtA.cents < 0) o = -amtA.cents; else i = amtA.cents; }
      // M-Pesa prints money out as a minus in the "Withdrawn" column; a minus in the in column is money out too.
      if (inA && inA.cents < 0 && !outA) { o = -inA.cents; i = 0; }
      if (balA) b = balA.cents;
    } else {
      // No header: the last number is the balance and the one before it is the amount.
      const nums = l.amounts.map((a) => a.cents);
      if (nums.length >= 2) {
        b = nums[nums.length - 1]!;
        const amt = nums[nums.length - 2]!;
        if (amt < 0) o = -amt;
        else if (prev != null && Math.abs(b - (prev - amt)) < Math.abs(b - (prev + amt))) o = amt;
        else i = amt;
      } else { const amt = nums[0]!; if (amt < 0) o = -amt; else i = amt; }
    }
    // Where the balance shows the money went the other way, follow the balance.
    if (b != null && prev != null && (i || o)) {
      const amt = i || o;
      if (i && b === prev - amt) { o = amt; i = 0; } else if (o && b === prev + amt) { i = amt; o = 0; }
    }
    if (prev == null && b != null) prev = b - i + o;
    if (opening == null && b != null) opening = b - i + o;
    const expected = (prev ?? 0) + i - o;
    if (b == null) b = expected; else if (b !== expected) breaks += 1;
    if (!i && !o) continue;
    lines.push({ d: l.d, t: l.t || '(no description)', r: l.r, i, o, b });
    prev = b;
  }
  if (!lines.length) problems.push('No lines with a date and an amount were found in this file.');
  const openingCents = opening ?? 0;
  const closingCents = lines.length ? lines[lines.length - 1]!.b : openingCents;
  if (closing != null && lines.length && closing !== closingCents) problems.push(`The statement's closing balance (${(closing / 100).toFixed(2)}) is not what the lines add up to (${(closingCents / 100).toFixed(2)}).`);
  return {
    lines, openingCents, closingCents, from: lines[0]?.d ?? '', to: lines[lines.length - 1]?.d ?? '', balanceBreaks: breaks, problems,
  };
}

const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Turns spreadsheet rows (Excel or CSV) into cells; a column's place is its number. */
export function sheetCells(rows: (string | number | Date | null | undefined)[][]): StatementCell[][] {
  return rows.map((r) => r.map((v, n) => ({
    text: v instanceof Date ? isoOf(v) : v == null ? '' : String(v),
    x0: n * 100, x1: n * 100 + 90,
    value: v instanceof Date || typeof v === 'number' ? v : null,
  })));
}

/** A piece of text on a PDF page: where its baseline starts and how wide it is, in points. */
export interface PdfTextItem { text: string; x: number; y: number; w: number }

/** One page's text pieces as rows (baselines within 3 points, top first) of cells (pieces closer than 4 points join). */
export function pdfItemsToRows(items: readonly PdfTextItem[]): StatementCell[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0]!.y - it.y) <= 3);
    if (line) line.push(it); else lines.push([it]);
  }
  lines.sort((a, b) => b[0]!.y - a[0]!.y);
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const cells: StatementCell[] = [];
    for (const it of line) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.x1 < 4) { last.text += (it.x - last.x1 > 1 && !last.text.endsWith(' ') ? ' ' : '') + it.text; last.x1 = it.x + it.w; }
      else cells.push({ text: it.text, x0: it.x, x1: it.x + it.w });
    }
    return cells;
  });
}

// ---- Sorting lines into categories ------------------------------------------------------

/** The words of a description that stay the same from month to month, for remembering choices. */
export function learnKey(text: string, dir: 'in' | 'out'): string {
  const words = text.toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !['TO', 'FROM', 'THE', 'AND', 'OF', 'FOR', 'REF', 'KES', 'KSH', 'NO'].includes(w));
  return `${dir}:${words.slice(0, 5).join(' ')}`.slice(0, 80);
}

const RULES: [RegExp, 'in' | 'out', string][] = [
  [/\bPETTY\b/, 'out', 'toPetty'],
  [/\b(EXCISE|LEDGER FEES?|CHARGES?|CHG|COMMISSION|SMS ALERTS?|SMS BANKING|STAMP DUTY|TRANSACTION COST|SERVICE FEES?|MAINTENANCE FEES?|ACCOUNT FEES?|MGMT FEE|COMMITMENT FEE|WITHHOLDING TAX)\b/, 'out', 'bankCharges'],
  [/\bINTEREST\b/, 'in', 'interest'],
  [/\b(KPLC|KENYA POWER|PREPAID TOKENS?|POWER TOKENS?|NAIROBI WATER|NCWSC|WATER BILL|WATER COMPANY)\b/, 'out', 'utilities'],
  [/\b(SAFARICOM HOME|HOME FIBRE|SAFARICOM FIBRE|ZUKU|FAIBA|TELKOM|AIRTIME|BUNDLES?|POSTPAY|AIRTEL MONEY|WIFI|INTERNET)\b/, 'out', 'comms'],
  [/\b(NSSF|NHIF|SHIF|SOCIAL HEALTH|SHA|KRA|PAYE|HOUSING LEVY|AHL|ITAX)\b/, 'out', 'statutory'],
  [/(SALAR|PAYROLL|WAGES|STIPEND|ALLOWANCE|HONORARIUM)/, 'out', 'salaries'],
  [/\bLOAN\b/, 'in', 'loanIn'],
  [/\bLOAN\b/, 'out', 'loanOut'],
  [/\bRENT\b/, 'out', 'rent'],
  [/\b(RENT|HIRE)\b/, 'in', 'hire'],
  [/\bTITHES?\b/, 'in', 'tithes'],
  [/\b(OFFERINGS?|SADAKA)\b/, 'in', 'offerings'],
  [/\b(SCHOOL FEES?|TUITION|FEES?|ADMISSION)\b/, 'in', 'fees'],
  [/\b(SPONSOR|SPONSORSHIP|GRANT|COMPASSION)\b/, 'in', 'grants'],
  [/\b(BUILDING|HARAMBEE|FUNDRAIS\w*|PLEDGE)\b/, 'in', 'fundraising'],
  [/\b(REFUND|REVERSAL|REVERSED)\b/, 'in', 'refund'],
  [/\b(FUEL|PETROL|DIESEL|RUBIS|TOTALENERGIES|SHELL|UBER|BOLT|LITTLE CAB|FARE|SACCO)\b/, 'out', 'transport'],
  [/\b(AUDIT|AUDITORS?|ADVOCATES?|LEGAL)\b/, 'out', 'professional'],
  [/\b(WELFARE|BENEVOLEN\w*|HOSPITAL|MEDICAL|FUNERAL)\b/, 'out', 'welfare'],
  [/\b(NAIVAS|QUICKMART|CARREFOUR|CHANDARANA|SUPERMARKET|CATERING|HOTEL|RESTAURANT)\b/, 'out', 'food'],
  [/\b(STATIONERY|PRINTING|TEXT BOOK|TEXTBOOKS)\b/, 'out', 'office'],
  [/\b(HARDWARE|PLUMB\w*|REPAIRS?|MAINTENANCE)\b/, 'out', 'repairs'],
];

/** What the app guesses for a line with no clear rule: giving in a church, fees in ADIA, sponsorship at Hope. */
const FALLBACK_IN: Record<OrgKind, string> = { church: 'giving', school: 'fees', hope: 'grants' };

/**
 * The category for a line: a choice someone made before for the same kind of line, otherwise a clear
 * rule from its description, otherwise a guess that waits for a person to confirm.
 */
export function autoCategory(line: Pick<BankLine, 't' | 'r' | 'i' | 'o'>, learned: Readonly<Record<string, string>>, kind: OrgKind): { c: string; s: boolean } {
  const dir = line.i > 0 ? 'in' : 'out';
  const known = learned[learnKey(line.t, dir)];
  if (known && isFinCategory(known)) return { c: known, s: true };
  const text = ` ${line.t} ${line.r} `.toUpperCase();
  for (const [re, d, c] of RULES) if (d === dir && re.test(text)) return { c, s: true };
  return { c: dir === 'in' ? FALLBACK_IN[kind] : 'otherExpense', s: false };
}

/** The same line in two uploads: same day, same amounts and the same balance after it. */
export const lineKey = (account: string, l: Pick<BankLine, 'd' | 'i' | 'o' | 'b'>) => `${account}|${l.d}|${l.i}|${l.o}|${l.b}`;

// ---- What we own and owe, and the budget --------------------------------------------------

export const OWN_KINDS = ['Land and buildings', 'Vehicles', 'Equipment and furniture', 'Money owed to us', 'Savings and investments', 'Other things we own'] as const;
export const OWE_KINDS = ['Loans', 'Unpaid bills', 'Money held for others', 'Other money we owe'] as const;
export interface OwnedItem { id: string; side: 'own' | 'owe'; kind: string; name: string; cents: number; asOf: string }

// ---- The report ------------------------------------------------------------------------------

const prevPeriod = (period: string): string => {
  if (period.length === 4) return String(Number(period) - 1);
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};
const lastYear = (period: string): string => (period.length === 4 ? String(Number(period) - 1) : `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`);
export const finPeriodName = (period: string): string => (period.length === 4 ? `January to December ${period}`
  : new Date(`${period}-01T12:00:00Z`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
const shortName = (period: string): string => (period.length === 4 ? period
  : new Date(`${period}-01T12:00:00Z`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' }));
export const periodStart = (p: string) => (p.length === 4 ? `${p}-01-01` : `${p}-01`);
export function periodEnd(p: string): string {
  if (p.length === 4) return `${p}-12-31`;
  const [y, m] = p.split('-').map(Number) as [number, number];
  return `${p}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
const monthsIn = (p: string): string[] => (p.length === 4 ? Array.from({ length: 12 }, (_, n) => `${p}-${pad(n + 1)}`) : [p]);

/** Petty cash for a period, as the petty cash report gives it. */
export interface PettyFigures { openingCents: number; inCents: number; outCents: number; closingCents: number; categories: { category: string; cents: number }[] }

export interface FinRow { id: string; label: string; cents: number; beforeCents: number; lastYearCents: number; indent?: boolean }
export interface AccountFigures {
  account: string; kind: 'bank' | 'mpesa'; openingCents: number; inCents: number; outCents: number; closingCents: number;
  /** The statement's own balance at the end of the period. */ statementCents: number; lines: number; breaks: number; missingMonths: string[];
}
export interface FinReport {
  period: string; name: string; beforeName: string; lastYearName: string; year: boolean;
  income: FinRow[]; expenses: FinRow[]; capital: FinRow[];
  totalIncome: FinTotals; totalExpenses: FinTotals; surplus: FinTotals;
  accounts: AccountFigures[]; petty: PettyFigures | null;
  cash: { openingCents: number; closingCents: number };
  cashFlow: { label: string; cents: number; strong?: boolean; indent?: boolean }[];
  balanceSheet: { assets: { label: string; cents: number; indent?: boolean }[]; liabilities: { label: string; cents: number; indent?: boolean }[]; totalAssets: number; totalLiabilities: number; netAssets: number };
  budget: { id: string; label: string; budgetCents: number; actualCents: number; diffCents: number; used: number }[];
  /** Month by month (a year), or the last six months up to this one (a month), for the chart. */
  trend: { period: string; label: string; inCents: number; outCents: number }[];
  checks: { text: string; ok: boolean }[];
  /** The daily records against the statement, when any were kept. */
  match: DailyMatch | null;
  summary: string[];
  needsYou: number;
  lines: (BankLine & { account: string })[];
}
export interface FinTotals { cents: number; beforeCents: number; lastYearCents: number }

export interface FinInput {
  statements: readonly BankStatement[];
  owned: readonly OwnedItem[];
  /** Monthly budget per category, cents. */
  budget: Readonly<Record<string, number>>;
  /** Petty cash for this period, the period before and the same period last year. */
  petty?: { now: PettyFigures; before: PettyFigures; lastYear: PettyFigures } | null;
  /** Giving recorded in the app for the period (church), to check against the bank. */
  givingRecordedCents?: number | null;
  /** Petty cash paid out in each month (YYYY-MM), for the chart. */
  pettyOutByMonth?: Readonly<Record<string, number>>;
  /** Today, YYYY-MM-DD, so a year in progress budgets only the months so far. */
  today?: string;
  /** Bank money typed day by day and petty cash top-ups, checked against the statement (Andy, 2026-11-09, 3A). */
  daily?: { entries: readonly DailyBankEntry[]; topups: readonly { date: string; cents: number }[] } | null;
}

export function financialReport(period: string, input: FinInput, money: (cents: number) => string = (c) => (c / 100).toFixed(2)): FinReport {
  const year = period.length === 4;
  const before = prevPeriod(period);
  const ly = lastYear(period);
  const all = input.statements.flatMap((s) => s.lines.map((l, n) => ({ ...l, account: s.account, kind: s.accountKind, order: n, from: s.from })));
  all.sort((a, b) => a.d.localeCompare(b.d) || a.from.localeCompare(b.from) || a.order - b.order);
  const inP = (d: string, p: string) => d.startsWith(p);

  const sumBy = (p: string, petty: PettyFigures | null | undefined) => {
    const m = new Map<string, number>();
    for (const l of all) if (inP(l.d, p)) { const g = finCategory(l.c).group; if (g !== 'transfer') m.set(l.c, (m.get(l.c) ?? 0) + l.i - l.o); }
    const pc = new Map<string, number>();
    for (const c of petty?.categories ?? []) pc.set(c.category, (pc.get(c.category) ?? 0) + c.cents);
    const pettyOther = petty ? petty.outCents - (petty.categories ?? []).reduce((n, c) => n + c.cents, 0) : 0;
    if (pettyOther > 0) pc.set('Other petty cash', (pc.get('Other petty cash') ?? 0) + pettyOther);
    return { m, pc };
  };
  // A period with no statement lines is not compared (its petty cash alone would mislead).
  const hasBefore = all.some((l) => inP(l.d, before));
  const hasLastYear = all.some((l) => inP(l.d, ly));
  const now = sumBy(period, input.petty?.now);
  const bef = sumBy(before, hasBefore ? input.petty?.before : null);
  const lyr = sumBy(ly, hasLastYear ? input.petty?.lastYear : null);
  const rowsFor = (group: FinGroup, sign: 1 | -1): FinRow[] => FIN_CATEGORIES.filter((c) => c.group === group)
    .map((c) => ({ id: c.id, label: c.label, cents: sign * (now.m.get(c.id) ?? 0), beforeCents: sign * (bef.m.get(c.id) ?? 0), lastYearCents: sign * (lyr.m.get(c.id) ?? 0) }))
    .filter((r) => r.cents || r.beforeCents || r.lastYearCents);
  const income = rowsFor('income', 1);
  const bankExpenses = rowsFor('expense', -1);
  const pettyNames = [...new Set([...now.pc.keys(), ...bef.pc.keys(), ...lyr.pc.keys()])];
  const pettyRows: FinRow[] = pettyNames.map((name) => ({ id: `petty:${name}`, label: name, cents: now.pc.get(name) ?? 0, beforeCents: bef.pc.get(name) ?? 0, lastYearCents: lyr.pc.get(name) ?? 0, indent: true }))
    .filter((r) => r.cents || r.beforeCents || r.lastYearCents).sort((a, b) => b.cents - a.cents);
  const expenses: FinRow[] = [...bankExpenses];
  if (pettyRows.length) {
    const tot = (k: 'cents' | 'beforeCents' | 'lastYearCents') => pettyRows.reduce((n, r) => n + r[k], 0);
    expenses.push({ id: 'petty', label: 'Petty cash spending', cents: tot('cents'), beforeCents: tot('beforeCents'), lastYearCents: tot('lastYearCents') }, ...pettyRows);
  }
  const capital = rowsFor('capital', -1);
  const total = (rows: FinRow[]): FinTotals => {
    const top = rows.filter((r) => !r.indent);
    return { cents: top.reduce((n, r) => n + r.cents, 0), beforeCents: top.reduce((n, r) => n + r.beforeCents, 0), lastYearCents: top.reduce((n, r) => n + r.lastYearCents, 0) };
  };
  const totalIncome = total(income);
  const totalExpenses = total(expenses);
  const surplus = { cents: totalIncome.cents - totalExpenses.cents, beforeCents: totalIncome.beforeCents - totalExpenses.beforeCents, lastYearCents: totalIncome.lastYearCents - totalExpenses.lastYearCents };

  // Each account: opening, money in and out, closing, against the statement.
  const start = periodStart(period); const end = periodEnd(period);
  const names = [...new Set(input.statements.map((s) => s.account))];
  const accounts: AccountFigures[] = names.map((account) => {
    const stmts = input.statements.filter((s) => s.account === account);
    const ls = all.filter((l) => l.account === account);
    const beforeLs = ls.filter((l) => l.d < start);
    const mine = ls.filter((l) => l.d >= start && l.d <= end);
    const firstStmt = [...stmts].sort((a, b) => a.from.localeCompare(b.from))[0];
    const openingCents = beforeLs.length ? beforeLs[beforeLs.length - 1]!.b : (firstStmt && firstStmt.from <= end ? firstStmt.openingCents : 0);
    const inCents = mine.reduce((n, l) => n + l.i, 0);
    const outCents = mine.reduce((n, l) => n + l.o, 0);
    const statementCents = mine.length ? mine[mine.length - 1]!.b : openingCents;
    let breaks = 0; let prev = openingCents;
    for (const l of mine) { if (l.b !== prev + l.i - l.o) breaks += 1; prev = l.b; }
    const covered = (m: string) => stmts.some((s) => s.from <= periodEnd(m) && s.to >= periodStart(m)) || ls.some((l) => l.d.startsWith(m));
    const firstMonth = firstStmt?.from.slice(0, 7) ?? '';
    const lastMonth = [...stmts].sort((a, b) => b.to.localeCompare(a.to))[0]?.to.slice(0, 7) ?? '';
    const today = (input.today ?? '9999-12-31').slice(0, 7);
    const missingMonths = monthsIn(period).filter((m) => m >= firstMonth && m <= today && (m <= lastMonth || m < today) && !covered(m));
    return { account, kind: stmts[0]!.accountKind, openingCents, inCents, outCents, closingCents: openingCents + inCents - outCents, statementCents, lines: mine.length, breaks, missingMonths };
  }).filter((a) => a.lines || a.openingCents);
  const petty = input.petty?.now ?? null;
  const cash = {
    openingCents: accounts.reduce((n, a) => n + a.openingCents, 0) + (petty?.openingCents ?? 0),
    closingCents: accounts.reduce((n, a) => n + a.statementCents, 0) + (petty?.closingCents ?? 0),
  };

  // Cash flow.
  const g = (id: string) => now.m.get(id) ?? 0;
  const transfersNet = all.filter((l) => inP(l.d, period) && finCategory(l.c).group === 'transfer').reduce((n, l) => n + l.i - l.o, 0) + (petty?.inCents ?? 0);
  const capitalOut = -capital.reduce((n, r) => n + r.cents, 0);
  const loanIn = g('loanIn'); const loanOut = -g('loanOut');
  const operating = totalIncome.cents - totalExpenses.cents;
  const net = operating + capitalOut + loanIn - loanOut + transfersNet;
  const cashFlow: FinReport['cashFlow'] = [
    { label: 'Cash at the start', cents: cash.openingCents, strong: true },
    { label: 'Money received (income)', cents: totalIncome.cents, indent: true },
    { label: 'Running costs paid', cents: -totalExpenses.cents, indent: true },
    { label: 'From day-to-day work', cents: operating, strong: true },
    { label: 'Equipment, building and land', cents: capitalOut, indent: true },
    { label: 'From investing', cents: capitalOut, strong: true },
    { label: 'Loans received', cents: loanIn, indent: true },
    { label: 'Loans repaid', cents: -loanOut, indent: true },
    { label: 'From loans', cents: loanIn - loanOut, strong: true },
    ...(transfersNet ? [{ label: 'Moves between accounts not yet matched', cents: transfersNet, indent: true }] : []),
    { label: 'Change in cash', cents: net, strong: true },
    { label: 'Cash at the end', cents: cash.openingCents + net, strong: true },
  ];

  // Balance sheet at the end of the period.
  const asOf = (i: OwnedItem) => !i.asOf || i.asOf <= end;
  const latest = (side: 'own' | 'owe') => {
    const items = input.owned.filter((i) => i.side === side && asOf(i));
    const kinds = side === 'own' ? OWN_KINDS : OWE_KINDS;
    const out: { label: string; cents: number; indent?: boolean }[] = [];
    for (const k of [...kinds, ...new Set(items.map((i) => i.kind).filter((k) => !(kinds as readonly string[]).includes(k)))]) {
      const its = items.filter((i) => i.kind === k);
      if (!its.length) continue;
      out.push({ label: k, cents: its.reduce((n, i) => n + i.cents, 0) });
      if (its.length > 1) for (const i of its) out.push({ label: i.name, cents: i.cents, indent: true });
    }
    return out;
  };
  const cashRows = [...accounts.map((a) => ({ label: a.account, cents: a.statementCents, indent: true })), ...(petty ? [{ label: 'Petty cash', cents: petty.closingCents, indent: true }] : [])];
  const assets = [{ label: 'Cash and bank', cents: cash.closingCents }, ...cashRows, ...latest('own')];
  const liabilities = latest('owe');
  const totalAssets = assets.filter((a) => !a.indent).reduce((n, a) => n + a.cents, 0);
  const totalLiabilities = liabilities.filter((a) => !a.indent).reduce((n, a) => n + a.cents, 0);

  // Budget against actual.
  const today = input.today ?? '9999-12-31';
  const monthsSoFar = year ? Math.max(1, monthsIn(period).filter((m) => m <= today.slice(0, 7)).length) : 1;
  const budget = Object.entries(input.budget).filter(([id, c]) => c > 0 && isFinCategory(id)).map(([id, monthly]) => {
    const cat = finCategory(id);
    const actual = Math.abs(now.m.get(id) ?? 0);
    const b = monthly * monthsSoFar;
    return { id, label: cat.label, budgetCents: b, actualCents: actual, diffCents: cat.group === 'income' ? actual - b : b - actual, used: b ? actual / b : 0 };
  }).sort((a, b) => FIN_CATEGORIES.findIndex((c) => c.id === a.id) - FIN_CATEGORIES.findIndex((c) => c.id === b.id));

  // Trend for the chart.
  const trendPeriods = year ? monthsIn(period) : Array.from({ length: 6 }, (_, n) => { let p = period; for (let k = 0; k < 5 - n; k++) p = prevPeriod(p); return p; });
  let trend = trendPeriods.map((p) => {
    let i = 0, o = 0;
    for (const l of all) if (inP(l.d, p)) { const grp = finCategory(l.c).group; if (grp === 'income') i += l.i - l.o; if (grp === 'expense') o += l.o - l.i; }
    o += input.pettyOutByMonth?.[p] ?? 0;
    return { period: p, label: year ? shortName(p).slice(0, 3) : shortName(p), inCents: i, outCents: o };
  });
  if (year) { const last = trend.map((t) => !!(t.inCents || t.outCents)).lastIndexOf(true); trend = trend.slice(0, Math.max(1, last + 1)); }

  // Checks.
  const periodLines = all.filter((l) => inP(l.d, period));
  const needsYou = periodLines.filter((l) => !l.s).length;
  const checks: FinReport['checks'] = [];
  checks.push(needsYou ? { text: `${needsYou} line${needsYou === 1 ? ' still needs' : 's still need'} a category confirmed.`, ok: false } : { text: 'Every line has a confirmed category.', ok: true });
  for (const a of accounts) {
    checks.push(a.breaks
      ? { text: `${a.account}: ${a.breaks} place${a.breaks === 1 ? '' : 's'} where the balance does not follow on. A line may be missing or misread.`, ok: false }
      : { text: `${a.account} reconciles: ${money(a.openingCents)} + ${money(a.inCents)} in - ${money(a.outCents)} out = ${money(a.statementCents)}, the statement's balance.`, ok: true });
    if (a.missingMonths.length) checks.push({ text: `${a.account}: no statement uploaded for ${a.missingMonths.map(finPeriodName).join(', ')}.`, ok: false });
  }
  if (input.givingRecordedCents) {
    const found = (now.m.get('tithes') ?? 0) + (now.m.get('offerings') ?? 0) + (now.m.get('giving') ?? 0) + (now.m.get('fundraising') ?? 0);
    const diff = found - input.givingRecordedCents;
    checks.push(Math.abs(diff) < 100
      ? { text: `Giving recorded in the app (${money(input.givingRecordedCents)}) matches giving found in the statements.`, ok: true }
      : { text: `Giving recorded in the app is ${money(input.givingRecordedCents)}; the statements show ${money(found)} (${diff > 0 ? `${money(diff)} more in the bank` : `${money(-diff)} not yet in the bank`}).`, ok: false });
  }
  const unmatched = transfersNet;
  if (unmatched) checks.push({ text: `${money(Math.abs(unmatched))} moved between accounts has no matching line on the other side. Upload the other account's statement, or change the category.`, ok: false });
  if (!accounts.length) checks.push({ text: 'No bank or M-Pesa statement covers this period yet.', ok: false });
  let match: DailyMatch | null = null;
  if (input.daily && (input.daily.entries.some((e) => inP(e.date, period)) || input.daily.topups.some((t) => inP(t.date, period)))) {
    match = matchDaily(period, input.statements, input.daily.entries, input.daily.topups);
    const typed = match.matched.length + match.typedMissing.length;
    if (typed) checks.push(match.typedMissing.length
      ? { text: `${match.typedMissing.length} of ${typed} bank amounts typed during the period ${match.typedMissing.length === 1 ? 'is' : 'are'} not on the statement: ${match.typedMissing.slice(0, 5).map((e) => `${e.date.split('-').reverse().join('/')} ${e.text || finLabel(e.category)} ${money(e.cents)}`).join('; ')}${match.typedMissing.length > 5 ? '…' : ''}.`, ok: false }
      : { text: `All ${typed} bank amounts typed during the period are on the statement.`, ok: true });
    const tops = match.topupsMatched + match.topupsMissing.length;
    if (tops) checks.push(match.topupsMissing.length
      ? { text: `${match.topupsMissing.length} of ${tops} petty cash top-ups could not be found leaving the bank: ${match.topupsMissing.slice(0, 5).map((t) => `${t.date.split('-').reverse().join('/')} ${money(t.cents)}`).join('; ')}.`, ok: false }
      : { text: `All ${tops} petty cash top-ups are found leaving the bank.`, ok: true });
  }

  // A short summary in plain words.
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
  const summary: string[] = [];
  const nm = finPeriodName(period);
  const inPct = hasBefore ? pct(totalIncome.cents, totalIncome.beforeCents) : null;
  const outPct = hasBefore ? pct(totalExpenses.cents, totalExpenses.beforeCents) : null;
  const cmp = (p: number | null, word: string) => (p == null ? '' : p === 0 ? `, the same as ${word}` : `, ${p > 0 ? 'up' : 'down'} ${Math.abs(p)}% on ${word}`);
  const word = year ? 'last year' : 'last month';
  summary.push(`In ${nm} we received ${money(totalIncome.cents)}${cmp(inPct, word)}, and spent ${money(totalExpenses.cents)} on running costs${cmp(outPct, word)}.`);
  summary.push(surplus.cents >= 0 ? `That leaves a surplus of ${money(surplus.cents)}.` : `That is a deficit of ${money(-surplus.cents)}: we spent more than we received.`);
  const topOut = [...expenses.filter((r) => !r.indent)].sort((a, b) => b.cents - a.cents)[0];
  if (topOut && totalExpenses.cents > 0) summary.push(`The biggest cost was ${topOut.label.toLowerCase()} (${Math.round((topOut.cents / totalExpenses.cents) * 100)}% of spending).`);
  const topIn = [...income].sort((a, b) => b.cents - a.cents)[0];
  if (topIn && totalIncome.cents > 0) summary.push(`Most income came from ${topIn.label.toLowerCase()} (${Math.round((topIn.cents / totalIncome.cents) * 100)}%).`);
  if (!year && hasLastYear && totalIncome.lastYearCents) { const p = pct(totalIncome.cents, totalIncome.lastYearCents); if (p != null) summary.push(`Compared with ${finPeriodName(ly)}, income is ${p === 0 ? 'the same' : `${p > 0 ? 'up' : 'down'} ${Math.abs(p)}%`}.`); }
  if (capitalOut) summary.push(`${money(-capitalOut)} went on equipment, building or land; this is in the Cash Flow and not counted as a running cost.`);
  summary.push(`Cash and bank at the end: ${money(cash.closingCents)}${cash.openingCents ? ` (${cash.closingCents >= cash.openingCents ? 'up' : 'down'} ${money(Math.abs(cash.closingCents - cash.openingCents))} from the start)` : ''}.`);
  const over = budget.filter((b) => finCategory(b.id).group !== 'income' && b.actualCents > b.budgetCents);
  if (over.length) summary.push(`Over budget: ${over.map((b) => b.label.toLowerCase()).join(', ')}.`);

  return {
    period, name: nm, beforeName: finPeriodName(before), lastYearName: finPeriodName(ly), year,
    income, expenses, capital, totalIncome, totalExpenses, surplus, accounts, petty, cash, cashFlow,
    balanceSheet: { assets, liabilities, totalAssets, totalLiabilities, netAssets: totalAssets - totalLiabilities },
    budget, trend, checks, match, summary, needsYou,
    lines: periodLines.map(({ order: _o, from: _f, kind: _k, ...l }) => l),
  };
}

/** The periods with lines: each month, newest first, then its year. */
export function finPeriods(statements: readonly BankStatement[]): string[] {
  const months = [...new Set(statements.flatMap((s) => s.lines.map((l) => l.d.slice(0, 7))))].sort().reverse();
  return [...new Set(months.map((m) => m.slice(0, 4)))].flatMap((y) => [...months.filter((m) => m.startsWith(y)), y]);
}

/** "+12%" / "-5%" / "new" / "same" against another period. */
export function finChange(now: number, before: number): string {
  if (!before) return now ? 'new' : '–';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return pct === 0 ? 'same' : `${pct > 0 ? '+' : '-'}${Math.abs(pct)}%`;
}

// ---- Daily accounts (Andy, 2026-11-09, 1C 2B 3A 7A) ------------------------------------------------

/** Bank money typed on the day (a Sunday offering banked, a cheque paid), before the statement comes. */
export interface DailyBankEntry { id: string; date: string; dir: 'in' | 'out'; cents: number; account: string; text: string; category: string }
/** The cash in the petty cash box, counted on a day. */
export interface CashCount { date: string; countedCents: number; name: string }

export interface DayRow {
  date: string;
  openingCents: number; inCents: number; outCents: number; closingCents: number;
  vouchers: number; topups: number;
  bankInCents: number; bankOutCents: number; bankEntries: number;
  countedCents: number | null; diffCents: number | null; countedBy: string;
}

/**
 * The daily cash book: each day's petty cash opening, money in, money out and closing (from the
 * approved vouchers and top-ups), the bank money typed that day, and the cash count with any
 * difference. Days close by themselves (2B); only days with something in them are listed, plus today.
 */
export function dailyBook(
  petty: readonly { day: string; creditCents: number; debitCents: number; balanceCents: number; kind: string }[],
  entries: readonly DailyBankEntry[], counts: readonly CashCount[], today: string,
): DayRow[] {
  const days = new Set<string>([today, ...petty.map((l) => l.day), ...entries.map((e) => e.date), ...counts.map((c) => c.date)]);
  const sorted = [...days].filter((d) => d <= today).sort();
  const rows: DayRow[] = [];
  let balance = 0; let n = 0;
  for (const day of sorted) {
    const opening = balance;
    let inC = 0, outC = 0, vouchers = 0, topups = 0;
    while (n < petty.length && petty[n]!.day <= day) {
      const l = petty[n]!;
      if (l.day === day) { inC += l.creditCents; outC += l.debitCents; if (l.kind === 'request') vouchers += 1; if (l.kind === 'topup') topups += 1; }
      balance = l.balanceCents; n += 1;
    }
    const es = entries.filter((e) => e.date === day);
    const count = counts.find((c) => c.date === day);
    rows.push({
      date: day, openingCents: opening, inCents: inC, outCents: outC, closingCents: balance, vouchers, topups,
      bankInCents: es.filter((e) => e.dir === 'in').reduce((t, e) => t + e.cents, 0), bankOutCents: es.filter((e) => e.dir === 'out').reduce((t, e) => t + e.cents, 0), bankEntries: es.length,
      countedCents: count ? count.countedCents : null, diffCents: count ? count.countedCents - balance : null, countedBy: count?.name ?? '',
    });
  }
  return rows.reverse();
}

const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export interface DailyMatch {
  matched: { entry: DailyBankEntry; line: BankLine & { account: string } }[];
  typedMissing: DailyBankEntry[];
  topupsMatched: number;
  topupsMissing: { date: string; cents: number }[];
  /** Statement lines nobody typed: how many and how much. */
  untyped: { count: number; inCents: number; outCents: number };
}

/**
 * Month end (3A): each typed bank amount is found on the statement (same direction and amount, within
 * three days, the same account first), and each petty cash top-up is found leaving the bank (within
 * five days, a "Moved to petty cash" line first). Each statement line matches once.
 */
export function matchDaily(period: string, statements: readonly BankStatement[], entries: readonly DailyBankEntry[], topups: readonly { date: string; cents: number }[]): DailyMatch {
  const lines = statements.flatMap((s) => s.lines.map((l) => ({ ...l, account: s.account }))).filter((l) => l.d.startsWith(period) || entries.some((e) => e.date.startsWith(period) && dayGap(e.date, l.d) <= 5));
  const used = new Set<number>();
  const pick = (ok: (l: (typeof lines)[number]) => boolean, date: string, days: number, prefer: (l: (typeof lines)[number]) => boolean) => {
    let best = -1; let bestScore = Infinity;
    lines.forEach((l, n) => {
      if (used.has(n) || !ok(l)) return;
      const gap = dayGap(l.d, date);
      if (gap > days) return;
      const score = gap + (prefer(l) ? 0 : 10);
      if (score < bestScore) { bestScore = score; best = n; }
    });
    if (best >= 0) used.add(best);
    return best;
  };
  const matched: DailyMatch['matched'] = []; const typedMissing: DailyBankEntry[] = [];
  for (const e of [...entries].filter((x) => x.date.startsWith(period)).sort((a, b) => a.date.localeCompare(b.date))) {
    const n = pick((l) => (e.dir === 'in' ? l.i : l.o) === e.cents, e.date, 3, (l) => l.account === e.account);
    if (n >= 0) matched.push({ entry: e, line: lines[n]! }); else typedMissing.push(e);
  }
  let topupsMatched = 0; const topupsMissing: { date: string; cents: number }[] = [];
  for (const t of topups.filter((x) => x.date.startsWith(period))) {
    const n = pick((l) => l.o === t.cents, t.date, 5, (l) => l.c === 'toPetty');
    if (n >= 0) topupsMatched += 1; else topupsMissing.push(t);
  }
  const rest = lines.filter((l, n) => !used.has(n) && l.d.startsWith(period));
  return { matched, typedMissing, topupsMatched, topupsMissing, untyped: { count: rest.length, inCents: rest.reduce((t, l) => t + l.i, 0), outCents: rest.reduce((t, l) => t + l.o, 0) } };
}

/** A typed amount that matches a statement line gives the line its category (and the line counts as sorted). */
export function typedCategory(line: Pick<BankLine, 'd' | 'i' | 'o'>, account: string, entries: readonly DailyBankEntry[], taken: Set<string>): string | null {
  const dir = line.i > 0 ? 'in' : 'out'; const cents = line.i || line.o;
  const cands = entries.filter((e) => !taken.has(e.id) && e.dir === dir && e.cents === cents && dayGap(e.date, line.d) <= 3 && isFinCategory(e.category))
    .sort((a, b) => (a.account === account ? 0 : 1) - (b.account === account ? 0 : 1) || dayGap(a.date, line.d) - dayGap(b.date, line.d));
  const e = cands[0];
  if (!e) return null;
  taken.add(e.id);
  return e.category;
}

/** The month whose statement to offer as ready: the latest month with lines that has ended, or reaches its last days. */
export function readyMonth(statements: readonly BankStatement[], today: string): string | null {
  const months = [...new Set(statements.flatMap((s) => s.lines.map((l) => l.d.slice(0, 7))))].sort().reverse();
  for (const m of months) {
    const last = statements.flatMap((s) => s.lines).filter((l) => l.d.startsWith(m)).reduce((x, l) => (l.d > x ? l.d : x), '');
    if (m < today.slice(0, 7) || last >= periodEnd(m).slice(0, 8) + '28') return m;
  }
  return null;
}

export const FIN_ACCOUNT_SUGGESTIONS = ['Family Bank main account', 'M-Pesa Paybill'];
