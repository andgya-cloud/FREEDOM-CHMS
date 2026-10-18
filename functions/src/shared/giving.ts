/**
 * Giving rules shared by the app and Cloud Functions: money, funds, receipt
 * numbers, reading a Paybill statement and matching payments to people.
 * Amounts are stored as whole cents (KES 1,500.50 = 150050) so totals add up
 * exactly.
 */
import { normalizePhone } from './phone.js';

export const PAYBILL_NUMBER = '222118';

export const GIFT_METHODS = ['mpesa', 'cash', 'bank', 'cheque'] as const;
export type GiftMethod = (typeof GIFT_METHODS)[number];
export const GIFT_METHOD_LABELS: Record<GiftMethod, string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  bank: 'Bank',
  cheque: 'Cheque',
};

export const GIFT_STATUSES = ['confirmed', 'unassigned', 'void'] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];

/** Why a payment is waiting in the Unassigned queue. */
export type UnassignedReason = 'person' | 'fund' | 'both';

/** The funds named in the Paybill account references (FCC#Tithes, FCC#Offerings). */
export const STANDARD_FUNDS = [
  { id: 'tithes', name: 'Tithes' },
  { id: 'offerings', name: 'Offerings' },
] as const;

export interface FundLike {
  id: string;
  name: string;
  aliases?: string[];
  active?: boolean;
}

// ---- Money ------------------------------------------------------------------

/** "1,500", "KES 1500.50", "1 500" -> cents. Null when it isn't a positive amount. */
export function parseAmount(text: string | number | null | undefined): number | null {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.round(text * 100) : null;
  const cleaned = text.replace(/kes|ksh|sh/gi, '').replace(/[\s,]/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : null;
}

/** 150050 -> "KES 1,500.50"; whole amounts drop the cents: "KES 1,500". */
export function formatMoney(cents: number, currency = 'KES'): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = abs % 100;
  return `${negative ? '-' : ''}${currency} ${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

// ---- Funds ------------------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "tithes" and "tithe" are the same fund. */
const stem = (s: string) => {
  const q = squash(s);
  return q.length > 3 && q.endsWith('s') ? q.slice(0, -1) : q;
};

/** "Building Fund" -> "building_fund" */
export function fundIdFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

/** The text after the last # in an account reference: "FCC#Tithes" -> "Tithes". */
export function fundTextFromReference(reference: string | null | undefined): string {
  if (!reference) return '';
  const at = reference.lastIndexOf('#');
  return (at >= 0 ? reference.slice(at + 1) : reference).trim();
}

/** Finds the fund an account reference names, by name, id or alias, ignoring case, spaces and plurals. */
export function fundFromReference(reference: string | null | undefined, funds: readonly FundLike[]): FundLike | null {
  const text = fundTextFromReference(reference);
  if (!text || !reference?.includes('#')) return null;
  const want = stem(text);
  if (!want) return null;
  const live = funds.filter((f) => f.active !== false);
  return live.find((f) => [f.name, f.id, ...(f.aliases ?? [])].some((n) => stem(n) === want)) ?? null;
}

// ---- M-Pesa codes and receipt numbers ----------------------------------------

/** M-Pesa transaction codes are 10 letters and digits, for example QJK3ABCD12. */
export function normalizeMpesaCode(code: string | null | undefined): string | null {
  const c = (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8,12}$/.test(c) && /[A-Z]/.test(c) ? c : null;
}

/** FCN, 2026, 123 -> "FCN-2026-000123" */
export function formatReceiptNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

export function parseReceiptNumber(number: string): { prefix: string; year: number; sequence: number } | null {
  const m = /^([A-Z]{2,6})-(\d{4})-(\d{6,})$/.exec(number);
  return m ? { prefix: m[1]!, year: Number(m[2]), sequence: Number(m[3]) } : null;
}

/** Shown on a receipt saved offline until the server gives it its number. */
export function provisionalReceiptNumber(prefix: string, giftId: string): string {
  return `${prefix}-PROVISIONAL-${giftId.slice(0, 6).toUpperCase()}`;
}

// ---- Fund ledger --------------------------------------------------------------

export interface GiftForLedger {
  date: string;
  amountCents: number;
  fundId: string | null;
  method: GiftMethod;
  status: GiftStatus;
  deletedAt?: unknown;
}

export interface LedgerEntry {
  month: string;
  fund: string;
  method: GiftMethod;
  cents: number;
  count: number;
}

/**
 * What a change to one gift does to the monthly fund ledger. Only confirmed
 * gifts count; voiding a gift takes it back out. With `status: 'unassigned'`
 * it gives the same for payments waiting in the Unassigned queue, which the
 * ledger keeps separately so the month still reconciles to the statement.
 */
export function ledgerChanges(
  before: GiftForLedger | null | undefined,
  after: GiftForLedger | null | undefined,
  status: 'confirmed' | 'unassigned' = 'confirmed',
): LedgerEntry[] {
  const counts = (g: GiftForLedger | undefined | null): g is GiftForLedger => !!g && g.status === status && !g.deletedAt;
  const out: LedgerEntry[] = [];
  const add = (g: GiftForLedger, sign: 1 | -1) => out.push({
    month: g.date.slice(0, 7),
    fund: g.fundId ?? 'none',
    method: g.method,
    cents: sign * g.amountCents,
    count: sign,
  });
  const b = counts(before) ? before : null;
  const a = counts(after) ? after : null;
  if (b && a && b.date.slice(0, 7) === a.date.slice(0, 7) && b.fundId === a.fundId && b.method === a.method && b.amountCents === a.amountCents) return out;
  if (b) add(b, -1);
  if (a) add(a, 1);
  return out;
}

// ---- Reading a Paybill statement ------------------------------------------------

/** Splits CSV text into rows, honouring quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface StatementPayment {
  /** Row number in the file, counting from 1, for messages. */
  line: number;
  code: string;
  /** YYYY-MM-DD */
  date: string;
  time: string;
  amountCents: number;
  accountRef: string;
  /** Digits, possibly masked with *, as the statement shows it. */
  phone: string;
  name: string;
}

export interface StatementSkip {
  line: number;
  reason: string;
}

export interface ParsedStatement {
  payments: StatementPayment[];
  skipped: StatementSkip[];
  /** Sum of every completed payment in the file, before checking for duplicates. */
  totalCents: number;
  firstDate: string | null;
  lastDate: string | null;
}

type Cell = string | number | Date | null | undefined;

const COLUMNS = {
  code: /receipt\s*no|transaction\s*(id|code)|^receipt$/i,
  time: /completion\s*time|transaction\s*date|^date|trans.*time|initiation\s*time/i,
  details: /details|description/i,
  status: /transaction\s*status|^status/i,
  paidIn: /paid\s*in|amount\s*in|^credit|^amount$/i,
  party: /other\s*party|sender|customer/i,
  account: /a\/c\s*no|account\s*(no|number|ref)|bill\s*ref|^account$/i,
};

function cellText(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** "11/10/2026 10:15:22", "2026-10-11 10:15", an Excel date -> { date: 2026-10-11, time: 10:15 }. Days come first, as in Kenya. */
export function parseStatementDate(v: Cell): { date: string; time: string } | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const iso = v.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400000));
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  const s = cellText(v);
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { date: `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '' };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { date: `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '' };
  }
  return null;
}

/** "254712***678 - JANE WANJIKU" -> phone and name. */
export function splitOtherParty(text: string): { phone: string; name: string } {
  const t = text.trim();
  const m = /^\+?([0-9*]{6,15})\s*[-–]?\s*(.*)$/.exec(t);
  if (m) return { phone: m[1]!, name: m[2]!.trim() };
  return { phone: '', name: t };
}

/** Pulls payer and reference out of a Details cell such as "Pay Bill from 2547***678 - JANE DOE Acc. FCC#Tithes". */
function fromDetails(details: string): { phone: string; name: string; accountRef: string } {
  const acc = /\bAcc(?:ount)?\.?\s*(?:No\.?)?\s*([^\s].*)$/i.exec(details);
  const from = /\bfrom\s+(.+?)(?:\s+Acc(?:ount)?\.|$)/i.exec(details);
  const party = from ? splitOtherParty(from[1]!) : { phone: '', name: '' };
  return { ...party, accountRef: acc ? acc[1]!.trim() : '' };
}

/**
 * Reads a Paybill statement downloaded from the M-Pesa portal (CSV or Excel
 * rows). Finds the header row, keeps completed money paid in, and explains
 * every row it leaves out.
 */
export function parseStatement(rows: Cell[][]): ParsedStatement {
  const headerIndex = rows.findIndex((r) => r.some((c) => COLUMNS.code.test(cellText(c))) && r.some((c) => COLUMNS.paidIn.test(cellText(c))));
  if (headerIndex < 0) {
    return { payments: [], skipped: [{ line: 0, reason: 'This file has no "Receipt No." and "Paid In" columns, so it does not look like a Paybill statement.' }], totalCents: 0, firstDate: null, lastDate: null };
  }
  const header = rows[headerIndex]!.map(cellText);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const idx = {
    code: col(COLUMNS.code),
    time: col(COLUMNS.time),
    details: col(COLUMNS.details),
    status: col(COLUMNS.status),
    paidIn: col(COLUMNS.paidIn),
    party: col(COLUMNS.party),
    account: col(COLUMNS.account),
  };

  const payments: StatementPayment[] = [];
  const skipped: StatementSkip[] = [];
  const seen = new Set<string>();
  let totalCents = 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const line = i + 1;
    const get = (j: number) => (j >= 0 ? r[j] : null);
    if (r.every((c) => cellText(c) === '')) continue;
    const paid = get(idx.paidIn);
    const amountCents = typeof paid === 'number' ? (paid > 0 ? Math.round(paid * 100) : null) : parseAmount(cellText(paid));
    if (!amountCents) continue; // withdrawals, charges and empty lines are not gifts
    const status = cellText(get(idx.status));
    if (status && !/complete/i.test(status)) { skipped.push({ line, reason: `Not completed (${status}).` }); continue; }
    const code = normalizeMpesaCode(cellText(get(idx.code)));
    if (!code) { skipped.push({ line, reason: 'No M-Pesa code on this line.' }); continue; }
    if (seen.has(code)) { skipped.push({ line, reason: `${code} appears twice in this file.` }); continue; }
    const when = parseStatementDate(get(idx.time) ?? null);
    if (!when) { skipped.push({ line, reason: `${code} has no date I can read.` }); continue; }
    seen.add(code);
    totalCents += amountCents;
    const details = fromDetails(cellText(get(idx.details)));
    const party = idx.party >= 0 && cellText(get(idx.party)) ? splitOtherParty(cellText(get(idx.party))) : { phone: details.phone, name: details.name };
    payments.push({
      line,
      code,
      date: when.date,
      time: when.time,
      amountCents,
      accountRef: cellText(get(idx.account)) || details.accountRef,
      phone: party.phone,
      name: party.name,
    });
  }
  const dates = payments.map((p) => p.date).sort();
  return { payments, skipped, totalCents, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null };
}

// ---- Matching a payment to a person ------------------------------------------------

export interface PersonLike {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp?: string | null;
}

export interface MatchCandidate {
  personId: string;
  score: number;
  reason: string;
}

const nameTokens = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);

/** Share of the shorter name's words found in the other name (0 to 1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hits = short.filter((t) => long.includes(t)).length;
  return hits / short.length;
}

/** Statement phone (maybe masked, maybe 07...) -> a test against +2547... numbers. */
export function phoneMatcher(statementPhone: string): ((e164: string | null | undefined) => boolean) | null {
  const raw = statementPhone.replace(/[^0-9*]/g, '');
  if (raw.replace(/\*/g, '').length < 4) return null;
  if (!raw.includes('*')) {
    const full = normalizePhone(raw);
    return full ? (p) => p === full : null;
  }
  const intl = raw.startsWith('0') ? `254${raw.slice(1)}` : raw;
  const pattern = new RegExp(`^\\+${intl.replace(/\*+/g, (s) => `[0-9]{${s.length}}`)}$`);
  return (p) => !!p && pattern.test(p);
}

/**
 * Suggests who made a payment, best first. A full phone number is certain;
 * a masked number or a name alone is a suggestion for staff to confirm.
 */
export function matchPayment(payment: { phone: string; name: string }, people: readonly PersonLike[]): MatchCandidate[] {
  const phoneTest = phoneMatcher(payment.phone);
  const masked = payment.phone.includes('*');
  const out: MatchCandidate[] = [];
  for (const p of people) {
    const phoneHit = !!phoneTest && (phoneTest(p.phone) || phoneTest(p.whatsapp ?? null));
    const sim = payment.name ? nameSimilarity(payment.name, p.fullName) : 0;
    let score = 0;
    let reason = '';
    if (phoneHit && !masked) { score = 100; reason = 'Same phone number'; }
    else if (phoneHit && sim === 1) { score = 90; reason = 'Phone and name match'; }
    else if (phoneHit && sim >= 0.5) { score = 60; reason = 'Phone digits and part of the name match'; }
    else if (phoneHit) { score = 50; reason = 'Phone digits match'; }
    else if (sim === 1) { score = 70; reason = 'Same name'; }
    else if (sim >= 0.5) { score = 40; reason = 'Similar name'; }
    if (score) out.push({ personId: p.id, score, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The match to fill in for staff: confident and clearly ahead of the next one. */
export function suggestedMatch(candidates: readonly MatchCandidate[]): MatchCandidate | null {
  const [top, next] = candidates;
  if (!top || top.score < 70) return null;
  if (next && next.score >= top.score - 10) return null;
  return top;
}

/** "JANE WANJIKU" -> "Jane Wanjiku", for names from a statement. */
export function titleCaseName(name: string): string {
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase()).trim();
}
