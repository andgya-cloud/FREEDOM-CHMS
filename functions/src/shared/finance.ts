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
  /** The purpose pot ("PAINTING" from "#painting"); '' when a person said it belongs to no pot. Read from the description when missing. */ f?: string;
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
  ['in', /^(in|credit|credits|credit amount|cr amount|paid in|deposits?|money in|receipts?|lodgements?|credit \(kes\))$/i],
  ['out', /^(out|debit|debits|debit amount|dr amount|withdrawn|withdrawals?|paid out|money out|payments?|debit \(kes\))$/i],
  ['balance', /^(balance|total balance|running balance|book balance|ledger balance|closing balance|balance \(kes\)|available balance)$/i],
  ['amount', /^(amount|transaction amount|amount \(kes\))$/i],
  ['date', /^(date|trans\.? date|transacti ?on date|clearing date|transaction date|txn date|tran date|posting date|post date|completion time|book date|value date)$/i],
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

/** Column names in a row: three or more, one of them for money. */
function headerOf(cells: StatementCell[]): { col: Col; x0: number; x1: number }[] | null {
  const named = cells.map((c) => ({ c, col: HEADERS.find(([, re]) => re.test(tidy(c.text).replace(/[:*]/g, '').trim()))?.[0] ?? null }));
  if (named.filter((n) => n.col).length >= 3 && named.some((n) => n.col === 'balance' || n.col === 'in' || n.col === 'out' || n.col === 'amount')) {
    return named.filter((n) => n.col).map((n) => ({ col: n.col!, x0: n.c.x0, x1: n.c.x1 }));
  }
  return null;
}

/** Cells of the next row put into the cells above them (same place across the page), or added beside them. */
function mergeInto(into: StatementCell[], cells: StatementCell[]) {
  for (const c of cells) {
    const text = tidy(c.text);
    const isMoney = parseMoneyText(text) != null;
    const host = isMoney ? undefined : into.find((h) => parseMoneyText(h.text) == null && (Math.min(h.x1, c.x1) - Math.max(h.x0, c.x0) > 0 || Math.abs(h.x0 - c.x0) < 3));
    if (host) { host.text = /[-/]$/.test(host.text) ? host.text + text : `${host.text} ${text}`; host.x0 = Math.min(host.x0, c.x0); host.x1 = Math.max(host.x1, c.x1); }
    else into.push({ ...c, text });
  }
  into.sort((a, b) => a.x0 - b.x0);
}

/** A date with its year on the next line, as Family Bank prints it ("02-JAN-" then "2026"). */
const DATE_PART = /^(\d{1,2}[-/ .][A-Za-z]{3,9}[-/ .]?|\d{1,2}[-/.]\d{1,2}[-/.]?)$/;
const hasDate = (cells: StatementCell[]) => cells.slice(0, 3).some((c) => c.value instanceof Date || !!parseDateText(tidy(c.text)) || DATE_PART.test(tidy(c.text)));
const hasMoney = (cells: StatementCell[]) => cells.some((c) => typeof c.value === 'number' || parseMoneyText(tidy(c.text)) != null);

/**
 * Some banks print one transaction over several lines: the date's year, the rest of the description and even
 * the amount sit on the lines below (Family Bank, Andy's statement 2026-11-09). Such lines are joined into
 * one row, and a column header printed over two or three lines is joined too. An empty row is a new page.
 */
export function joinWrappedRows(rows: StatementCell[][]): StatementCell[][] {
  const out: StatementCell[][] = [];
  let cur: StatementCell[] | null = null;
  const clean = (row: StatementCell[]) => row.filter((c) => tidy(c.text) || c.value instanceof Date || typeof c.value === 'number');
  const headerAt = (n: number): { k: number; cells: StatementCell[]; cols: { col: Col }[] } | null => {
    let best: { k: number; cells: StatementCell[]; cols: { col: Col }[] } | null = null;
    for (let k = 1; k <= 3; k++) {
      const parts = rows.slice(n, n + k).map(clean);
      if (parts.length < k || parts.some((p) => !p.length || hasDate(p) || hasMoney(p))) break;
      const merged = parts[0]!.map((c) => ({ ...c, text: tidy(c.text) }));
      for (const p of parts.slice(1)) mergeInto(merged, p);
      const cols = headerOf(merged);
      if (cols && (!best || cols.length >= best.cols.length)) best = { k, cells: merged, cols };
    }
    return best;
  };
  for (let n = 0; n < rows.length; n++) {
    const cells = clean(rows[n]!);
    if (!cells.length) { cur = null; out.push([]); continue; }
    // A header over up to three lines, none with a date or money. If the header read from the next line
    // names more columns, this line is not part of it.
    const here = headerAt(n);
    if (here && !((headerAt(n + 1)?.cols.length ?? 0) > here.cols.length)) { out.push(here.cells); cur = null; n += here.k - 1; continue; }
    const joined = cells.map((c) => tidy(c.text)).join(' ');
    if (hasDate(cells)) { cur = cells.map((c) => ({ ...c, text: tidy(c.text) })); out.push(cur); continue; }
    if (cur && !headerOf(cells) && !OPENING.test(joined) && !CLOSING.test(joined) && !SKIP.test(joined)) { mergeInto(cur, cells); continue; }
    cur = null;
    out.push(cells);
  }
  return out;
}

/** Family Bank's own account number and name at the end of every description, and its Paybill wording, made short. */
export function tidyBankText(t: string): { t: string; r: string } {
  let text = t.replace(/\b\d{9,14}\s+FREEDOM\s+(IN\s+CHRIST\s+CHURCH|HOPE\s+CENT(ER|RE)|CHURCH)\b/gi, '').replace(/\s+/g, ' ').trim();
  const m = /^Paybill Credit From Paybill:\s*(\d+),\s*Ref\s*:\s*([A-Z0-9]+),\s*Sender:\s*(.*?)\s*,\s*Narration:\s*(.*)$/i.exec(text);
  if (m) return { t: `${m[4]!.trim() || 'Paybill'} · ${m[3]!.trim()} · Paybill ${m[1]}`, r: m[2]! };
  text = text.replace(/\s+,/g, ',');
  return { t: text, r: '' };
}

/** Reads statement rows (from a PDF or a spreadsheet) into lines with money in, money out and the balance. */
export function parseStatementRows(input: StatementCell[][]): ParsedStatement {
  const rows = joinWrappedRows(input);
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

  // A description may run onto the next line, but never across a page.
  let open = false;
  for (const row of rows) {
    const cells = row.map((c) => ({ ...c, text: tidy(c.text) })).filter((c) => c.text || c.value instanceof Date || typeof c.value === 'number');
    if (!cells.length) { open = false; continue; }
    const joined = cells.map((c) => c.text).join(' ');
    // A header row: three or more cells that name columns. (Two date columns: the first is the date.)
    const h = headerOf(cells);
    if (h) { header = h; continue; }
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
      // Anything printed to the right of the balance (Family Bank's branch code "034") is not description.
      const balEnd = header?.find((x) => x.col === 'balance')?.x1 ?? Infinity;
      for (const c of cells) {
        if (c === dateCell || money.some((x) => x.c === c)) continue;
        if (c.x0 > balEnd + 2) continue;
        if (c.value instanceof Date || (parseDateText(c.text) && c.text.length <= 20 && words.length === 0)) continue; // a value date
        if (colFor(c) === 'ref') refs.push(c.text); else words.push(c.text);
      }
      const neat = tidyBankText(tidy(words.join(' ')));
      raw.push({ d: date, t: neat.t, r: tidy([...refs, neat.r].join(' ')), amounts: money.map((x) => ({ cents: x.cents, col: colFor(x.c) })) });
      open = true;
    } else if (open && !date && !money.length && raw.length && cells.every((c) => !HEADERS.some(([, re]) => re.test(c.text)))) {
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
  // "FCC TITHE · JOHN KAMAU · Paybill 222118": only the part before the sender counts.
  const words = text.split(' · ')[0]!.toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !['TO', 'FROM', 'THE', 'AND', 'OF', 'FOR', 'REF', 'KES', 'KSH', 'NO'].includes(w));
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

/** Petty cash categories, as the main category each one counts in (one budget, Andy 2026-11-09, 2A). */
export const PETTY_TO_FIN: Readonly<Record<string, string>> = {
  'Training materials': 'learning', 'Office & supplies': 'office', 'Staff Payments': 'salaries', Transport: 'transport',
  'Repairs & maintenance': 'repairs', Utilities: 'utilities', Other: 'otherExpense', "Children's needs": 'welfare',
  'Programmes & activities': 'ministry', 'Ministry & programmes': 'ministry', Hospitality: 'food', 'Freedom Hope Center': 'otherExpense',
};
export const pettyToFin = (category: string): string => PETTY_TO_FIN[category] ?? 'otherExpense';

/** Words after "#" that are ordinary giving, not a purpose pot. */
const NOT_A_POT = new Set(['TITHE', 'TITHES', 'OFFERING', 'OFFERINGS', 'SADAKA', 'GENERAL', 'FEES', 'FEE', 'SCHOOLFEES', 'GIVING', 'DONATION']);
/**
 * Money given for a set purpose carries a code after "#" (FCC#PAINTING, "#Building"): each code is its
 * own pot (Andy, 2026-11-09, 4A). Gives the pot's name in capitals, or ''.
 */
export function potOf(text: string): string {
  const m = /#\s?([A-Za-z][A-Za-z0-9_-]{1,29})/.exec(text);
  const name = m ? m[1]!.toUpperCase().replace(/[_-]+/g, ' ').trim() : '';
  return name && !NOT_A_POT.has(name.replace(/ /g, '')) ? name : '';
}
/** A line's pot: what a person chose, otherwise what the description says. */
export const potFor = (l: Pick<BankLine, 't' | 'r' | 'f'>): string => (l.f !== undefined ? l.f : potOf(`${l.t} ${l.r}`));
export const potLabel = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();
/** Every pot's balance over all the statements: given with its code, less what was spent from it. */
export function potBalances(statements: readonly BankStatement[]): { name: string; cents: number }[] {
  const m = new Map<string, number>();
  for (const s of statements) for (const l of s.lines) {
    const name = potFor(l);
    if (name && finCategory(l.c).group !== 'transfer') m.set(name, (m.get(name) ?? 0) + l.i - l.o);
  }
  return [...m].map(([name, cents]) => ({ name, cents })).sort((a, b) => a.name.localeCompare(b.name));
}
/** The pots people have used so far, for the dropdown. */
export const potNames = (statements: readonly BankStatement[]): string[] => potBalances(statements).map((p) => p.name);

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
  balanceSheet: { assets: { label: string; cents: number; indent?: boolean }[]; liabilities: { label: string; cents: number; indent?: boolean }[]; totalAssets: number; totalLiabilities: number; netAssets: number;
    /** Net assets split: held for set purposes, and the general fund. */ restrictedCents: number; generalCents: number };
  budget: { id: string; label: string; budgetCents: number; actualCents: number; diffCents: number; used: number }[];
  /** Month by month (a year), or the last six months up to this one (a month), for the chart. */
  trend: { period: string; label: string; inCents: number; outCents: number }[];
  checks: { text: string; ok: boolean }[];
  /** The daily records against the statement, when any were kept. */
  match: DailyMatch | null;
  /** Money held for a set purpose, pot by pot. */
  pots: { name: string; openingCents: number; inCents: number; outCents: number; closingCents: number }[];
  /** Petty cash spending in the period, already inside the categories above. */
  pettyOutCents: number;
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

  // One budget (Andy, 2026-11-09, 2A): petty cash spending counts in the main category it belongs to.
  const sumBy = (p: string, petty: PettyFigures | null | undefined) => {
    const m = new Map<string, number>();
    for (const l of all) if (inP(l.d, p)) { const g = finCategory(l.c).group; if (g !== 'transfer') m.set(l.c, (m.get(l.c) ?? 0) + l.i - l.o); }
    let pettyOut = 0;
    for (const c of petty?.categories ?? []) { const id = pettyToFin(c.category); m.set(id, (m.get(id) ?? 0) - c.cents); pettyOut += c.cents; }
    const pettyOther = petty ? petty.outCents - pettyOut : 0;
    if (pettyOther > 0) { m.set('otherExpense', (m.get('otherExpense') ?? 0) - pettyOther); pettyOut += pettyOther; }
    return { m, pettyOut };
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
  const expenses = rowsFor('expense', -1);
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

  // Purpose pots (4A): money given with a "#code", less what was spent from that pot.
  const potNames = [...new Set(all.map((l) => potFor(l)).filter(Boolean))].sort();
  const pots = potNames.map((name) => {
    const ls = all.filter((l) => potFor(l) === name && finCategory(l.c).group !== 'transfer');
    const op = ls.filter((l) => l.d < start).reduce((n, l) => n + l.i - l.o, 0);
    const mine = ls.filter((l) => l.d >= start && l.d <= end);
    const inC = mine.reduce((n, l) => n + l.i, 0); const outC = mine.reduce((n, l) => n + l.o, 0);
    return { name, openingCents: op, inCents: inC, outCents: outC, closingCents: op + inC - outC };
  }).filter((x) => x.openingCents || x.inCents || x.outCents);
  const restrictedCents = pots.reduce((n, x) => n + Math.max(0, x.closingCents), 0);

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
  // Budget warnings at 80% and 100% (7A).
  for (const b of budget) {
    if (finCategory(b.id).group === 'income' || !b.budgetCents) continue;
    if (b.used >= 1) checks.push({ text: `Over budget: ${b.label} used ${Math.round(b.used * 100)}% (${money(b.actualCents)} of ${money(b.budgetCents)}).`, ok: false });
    else if (b.used >= 0.8) checks.push({ text: `Near the budget: ${b.label} has used ${Math.round(b.used * 100)}% (${money(b.actualCents)} of ${money(b.budgetCents)}).`, ok: false });
  }
  for (const x of pots) if (x.closingCents < 0) checks.push({ text: `The ${potLabel(x.name)} pot has spent ${money(-x.closingCents)} more than was given for it.`, ok: false });
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
  if (now.pettyOut) summary.push(`Running costs include ${money(now.pettyOut)} paid from petty cash.`);
  if (pots.length) summary.push(`Held for set purposes at the end: ${pots.filter((x) => x.closingCents > 0).map((x) => `${potLabel(x.name)} ${money(x.closingCents)}`).join(', ') || 'nothing'}.`);
  const over = budget.filter((b) => finCategory(b.id).group !== 'income' && b.actualCents > b.budgetCents);
  if (over.length) summary.push(`Over budget: ${over.map((b) => b.label.toLowerCase()).join(', ')}.`);

  return {
    period, name: nm, beforeName: finPeriodName(before), lastYearName: finPeriodName(ly), year,
    income, expenses, capital, totalIncome, totalExpenses, surplus, accounts, petty, cash, cashFlow,
    balanceSheet: { assets, liabilities, totalAssets, totalLiabilities, netAssets: totalAssets - totalLiabilities, restrictedCents, generalCents: totalAssets - totalLiabilities - restrictedCents },
    pots, pettyOutCents: now.pettyOut,
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

// ---- Free to spend (Andy, 2026-11-09, 3A) -----------------------------------------------------------

export interface FreeToSpend {
  /** Each account's balance now: the last statement balance, plus bank money typed since. */
  accounts: { account: string; cents: number; asOf: string }[];
  bankCents: number; pettyCents: number; cashCents: number;
  heldCents: number; waitingCents: number; freeCents: number;
  /** Average giving a week over the last eight weeks of statements, and what the rest of the month should bring. */
  weeklyGivingCents: number; weeksLeft: number; expectedCents: number;
  /** This month's budget still to spend (running costs). */
  budgetLeftCents: number;
  afterMonthCents: number;
}

/**
 * What is free to spend now: cash and bank (latest statement balances plus bank money typed since, and
 * petty cash), less money held for set purposes and requests waiting for signatures. Then, because people
 * give every week, the giving still expected this month is added and the rest of the month's budget taken off.
 */
export function freeToSpend(x: {
  statements: readonly BankStatement[]; entries: readonly DailyBankEntry[]; pettyNowCents: number; waitingCents: number; heldCents: number;
  budget: Readonly<Record<string, number>>; spentThisMonth: Readonly<Record<string, number>>; today: string;
}): FreeToSpend {
  const names = [...new Set(x.statements.map((s) => s.account))];
  const accounts = names.map((account) => {
    const ls = x.statements.filter((s) => s.account === account).flatMap((s) => s.lines.map((l, n) => ({ ...l, from: s.from, n })))
      .sort((a, b) => a.d.localeCompare(b.d) || a.from.localeCompare(b.from) || a.n - b.n);
    const last = ls[ls.length - 1];
    const asOf = last?.d ?? '';
    const typed = x.entries.filter((e) => e.account === account && e.date > asOf && e.date <= x.today).reduce((n, e) => n + (e.dir === 'in' ? e.cents : -e.cents), 0);
    return { account, cents: (last?.b ?? 0) + typed, asOf };
  });
  const bankCents = accounts.reduce((n, a) => n + a.cents, 0);
  const cashCents = bankCents + x.pettyNowCents;
  const freeCents = cashCents - x.heldCents - x.waitingCents;
  const lastDay = accounts.reduce((m, a) => (a.asOf > m ? a.asOf : m), '');
  const from = lastDay ? new Date(Date.parse(`${lastDay}T00:00:00Z`) - 55 * 86_400_000).toISOString().slice(0, 10) : '';
  const given = x.statements.flatMap((s) => s.lines).filter((l) => lastDay && l.d >= from && l.d <= lastDay && finCategory(l.c).group === 'income' && !potFor(l))
    .reduce((n, l) => n + l.i - l.o, 0);
  const weeklyGivingCents = Math.round(given / 8);
  const end = periodEnd(x.today.slice(0, 7));
  const weeksLeft = Math.max(0, dayGap(end, x.today)) / 7;
  const expectedCents = Math.round(weeklyGivingCents * weeksLeft);
  const budgetLeftCents = Object.entries(x.budget).filter(([id, c]) => c > 0 && finCategory(id).group === 'expense')
    .reduce((n, [id, c]) => n + Math.max(0, c - (x.spentThisMonth[id] ?? 0)), 0);
  return { accounts, bankCents, pettyCents: x.pettyNowCents, cashCents, heldCents: x.heldCents, waitingCents: x.waitingCents, freeCents, weeklyGivingCents, weeksLeft, expectedCents, budgetLeftCents,
    afterMonthCents: freeCents + expectedCents - budgetLeftCents };
}

/** This month's running costs per category so far: statement lines, bank money typed, and petty cash paid. */
export function spentInMonth(month: string, statements: readonly BankStatement[], entries: readonly DailyBankEntry[], petty: readonly { category: string; cents: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (id: string, c: number) => { if (finCategory(id).group === 'expense') out[id] = (out[id] ?? 0) + c; };
  const lines = statements.flatMap((s) => s.lines).filter((l) => l.d.startsWith(month));
  const lastLine = lines.reduce((m, l) => (l.d > m ? l.d : m), '');
  for (const l of lines) add(l.c, l.o - l.i);
  // Typed money counts only after the statement's last day, so nothing is counted twice.
  for (const e of entries) if (e.dir === 'out' && e.date.startsWith(month) && e.date > lastLine) add(e.category, e.cents);
  for (const p of petty) add(pettyToFin(p.category), p.cents);
  return out;
}

/** The 80% and 100% warning for one category this month (7A), or null. */
export function budgetWarning(category: string, monthlyCents: number, spentCents: number, addingCents: number, money: (c: number) => string): { level: 'near' | 'over'; text: string } | null {
  if (!monthlyCents) return null;
  const after = spentCents + addingCents;
  const pct = Math.round((after / monthlyCents) * 100);
  if (after > monthlyCents) return { level: 'over', text: `This takes ${finLabel(category).toLowerCase()} over this month's budget: ${money(after)} of ${money(monthlyCents)} (${pct}%).` };
  if (after >= monthlyCents * 0.8) return { level: 'near', text: `${finLabel(category)} will have used ${pct}% of this month's budget (${money(after)} of ${money(monthlyCents)}).` };
  return null;
}

export const FIN_ACCOUNT_SUGGESTIONS = ['Family Bank main account', 'M-Pesa Paybill'];
