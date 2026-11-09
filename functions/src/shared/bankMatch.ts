/**
 * Matching bank payments to petty cash requisitions that have no payment code (Andy, 2026-11-09, 1B 2A 3B 4A 5A 6A).
 * The person uploads the payments to one payee (an Excel or PDF list: date, bank reference, amount).
 * Each payment is paired with one requisition to the same payee, paid within a week of its date; the
 * nearest date wins. A payment with no requisition is left out (3B). The bank amount is what was paid, so
 * on confirming, the requisition takes the bank amount (2A) and the bank line stands as its receipt (4A).
 * Shared by the upload card and the matchBankPayments function.
 */

export interface BankPayment { day: string; cents: number; ref: string }
export interface MatchCandidate { id: string; day: string; cents: number }
/** The bank lines that paid one requisition: usually one, or several paid the same day that add up to it. */
export interface BankMatch { reqId: string; reqDay: string; reqCents: number; day: string; cents: number; ref: string; lines: BankPayment[] }

/** A payment may come up to 2 days before the requisition date, or up to 7 days after it. */
export const MATCH_DAYS_BEFORE = 2;
export const MATCH_DAYS_AFTER = 7;
export const MAX_MATCHES = 300;
/**
 * Monthly vouchers paid as several lines on one day (the caretakers: 15,000 and 4,000 on one voucher;
 * Andy, 2026-11-09): the lines must add up exactly to the voucher, and may come a week before it or up to
 * two weeks after it.
 */
export const GROUP_DAYS_BEFORE = 7;
export const GROUP_DAYS_AFTER = 14;
export const MAX_GROUP_LINES = 4;

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** A payment far off the amount asked (a small extra, say) is not this requisition's payment. */
export const closeEnough = (paid: number, asked: number) => paid * 2 >= asked && paid <= asked * 2;

/**
 * Pairs payments and requisitions one to one: closest dates first (a payment before the date counts as
 * twice as far, since payment usually follows), then the nearest amount.
 */
export function matchPayments(payments: readonly BankPayment[], reqs: readonly MatchCandidate[]): BankMatch[] {
  const usedP = new Set<number>();
  const usedR = new Set<number>();
  const out: BankMatch[] = [];
  const combine = (req: MatchCandidate, idx: number[]): BankMatch => {
    const lines = idx.map((i) => payments[i]!);
    return { reqId: req.id, reqDay: req.day, reqCents: req.cents, day: lines[0]!.day, cents: lines.reduce((n, l) => n + l.cents, 0), ref: [...new Set(lines.map((l) => l.ref).filter(Boolean))].join(' '), lines };
  };
  // First, lines of one day that add up exactly to a requisition, nearest day first.
  [...reqs.keys()].sort((a, b) => reqs[a]!.day.localeCompare(reqs[b]!.day)).forEach((r) => {
    const req = reqs[r]!;
    const days = new Map<string, number[]>();
    payments.forEach((pay, p) => {
      const gap = daysBetween(req.day, pay.day);
      if (!usedP.has(p) && gap >= -GROUP_DAYS_BEFORE && gap <= GROUP_DAYS_AFTER) days.set(pay.day, [...(days.get(pay.day) ?? []), p]);
    });
    const order = [...days.keys()].sort((a, b) => {
      const ga = daysBetween(req.day, a); const gb = daysBetween(req.day, b);
      return (ga >= 0 ? ga : -2 * ga) - (gb >= 0 ? gb : -2 * gb);
    });
    for (const day of order) {
      const ids = days.get(day)!;
      if (ids.length < 2) continue;
      const hit = subsetSum(ids, (i) => payments[i]!.cents, req.cents);
      if (hit) { hit.forEach((i) => usedP.add(i)); usedR.add(r); out.push(combine(req, hit)); return; }
    }
  });
  // Then one line to one requisition.
  const pairs: { p: number; r: number; far: number; diff: number }[] = [];
  payments.forEach((pay, p) => reqs.forEach((req, r) => {
    if (usedP.has(p) || usedR.has(r)) return;
    const gap = daysBetween(req.day, pay.day);
    if (gap >= -MATCH_DAYS_BEFORE && gap <= MATCH_DAYS_AFTER && closeEnough(pay.cents, req.cents)) {
      pairs.push({ p, r, far: gap >= 0 ? gap : -2 * gap, diff: Math.abs(pay.cents - req.cents) });
    }
  }));
  pairs.sort((a, b) => a.far - b.far || a.diff - b.diff || a.p - b.p || a.r - b.r);
  for (const x of pairs) {
    if (usedP.has(x.p) || usedR.has(x.r)) continue;
    usedP.add(x.p); usedR.add(x.r);
    const req = reqs[x.r]!;
    out.push(combine(req, [x.p]));
  }
  return out.sort((a, b) => a.reqDay.localeCompare(b.reqDay) || a.reqId.localeCompare(b.reqId));
}

/** Two to four of the lines that add up exactly to the amount, or null. */
function subsetSum(ids: number[], cents: (i: number) => number, total: number): number[] | null {
  const pick: number[] = [];
  const go = (from: number, left: number): boolean => {
    if (left === 0 && pick.length >= 2) return true;
    if (left <= 0 || pick.length === MAX_GROUP_LINES) return false;
    for (let k = from; k < ids.length; k++) {
      pick.push(ids[k]!);
      if (go(k + 1, left - cents(ids[k]!))) return true;
      pick.pop();
    }
    return false;
  };
  return go(0, total) ? [...pick] : null;
}

type Cell = string | number | Date | boolean | null | undefined;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => (y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

/** "15 Jun 2026", "15-JUN-2026", "15/06/2026", "2026-06-15", or an Excel date. */
export function readDay(c: Cell): string | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : new Date(c.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  if (typeof c !== 'string') return null;
  const s = c.trim().replace(/\u0002/g, '-');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3})[A-Za-z]*[\s\-/.,]+(\d{4})/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1; return mo ? valid(+m[3]!, mo, +m[1]!) : null; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  return null;
}

function readCents(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) && c > 0 ? Math.round(c * 100) : null;
  if (typeof c !== 'string') return null;
  const s = c.replace(/KES|Ksh|,|\s/gi, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.abs(Math.round(Number(s) * 100));
  return n > 0 ? n : null;
}
const text = (c: Cell) => (c instanceof Date ? '' : c == null ? '' : String(c).trim());
const cleanRef = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 40);

/**
 * The payments in an uploaded sheet: the row with "Date", "Reference" and "Amount" headings names the
 * columns. Without such a row (a PDF read as text), each line gives its first date, its first long
 * reference and the first amount after it.
 */
export function readPayments(rows: readonly (readonly Cell[])[]): { payments: BankPayment[]; skipped: number } {
  const head = rows.findIndex((r) => {
    const h = r.map(text);
    const d = h.findIndex((x) => /^date/i.test(x)); const f = h.findIndex((x) => /ref/i.test(x)); const a = h.findIndex((x) => /amount/i.test(x));
    return d >= 0 && f >= 0 && a >= 0 && new Set([d, f, a]).size === 3;
  });
  const payments: BankPayment[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  // Some bank transfers carry no reference (Account to Account before September 2026): those still count.
  const add = (p: BankPayment | null, looked: boolean) => {
    // One transfer split between people (a 29,000 salaries transfer) keeps its reference on each share.
    const key = p ? `${p.ref}|${p.day}|${p.cents}` : '';
    if (p && (!p.ref || !seen.has(key))) { if (p.ref) seen.add(key); payments.push(p); } else if (looked && !p) skipped++;
  };
  if (head >= 0) {
    const h = rows[head]!.map(text);
    const col = (re: RegExp) => h.findIndex((x) => re.test(x));
    const dCol = col(/^date/i); const rCol = col(/ref/i); const aCol = col(/amount|paid|debit/i);
    for (const r of rows.slice(head + 1)) {
      if (!r.some((c) => text(c) || c instanceof Date)) continue;
      const day = readDay(r[dCol]); const ref = cleanRef(text(r[rCol])); const cents = readCents(r[aCol]);
      if (!day && /total/i.test(r.map(text).join(' '))) continue;
      add(day && cents ? { day, ref, cents } : null, true);
    }
    return { payments, skipped };
  }
  for (const r of rows) {
    const line = r.map(text).join(' ').replace(/\s+/g, ' ').trim();
    const dm = /(\d{1,2}[\s\-/.]+[A-Za-z]{3}[A-Za-z]*[\s\-/.,]+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/.exec(line);
    if (!dm) continue;
    const day = readDay(dm[1]!);
    let rest = line.slice(dm.index + dm[1]!.length).replace(/^\s*(\d{1,2}[\s\-/.]+[A-Za-z]{3}[A-Za-z]*[\s\-/.,]+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/, '');
    const rm = /\b([A-Z0-9]*\d[A-Z0-9]{5,})\b/.exec(rest);
    if (!day || !rm) continue;
    rest = rest.slice(rm.index + rm[1]!.length);
    const am = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/.exec(rest);
    add(am ? { day, ref: cleanRef(rm[1]!), cents: readCents(am[1]!)! } : null, true);
  }
  return { payments, skipped };
}

/** What the matched bank line is kept as on the requisition. */
export interface BankProof { day: string; ref: string; cents: number; payee?: string; lines?: BankPayment[] }
