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
export interface BankMatch { reqId: string; reqDay: string; reqCents: number; day: string; cents: number; ref: string }

/** A payment may come up to 2 days before the requisition date, or up to 7 days after it. */
export const MATCH_DAYS_BEFORE = 2;
export const MATCH_DAYS_AFTER = 7;
export const MAX_MATCHES = 300;

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** A payment far off the amount asked (a small extra, say) is not this requisition's payment. */
export const closeEnough = (paid: number, asked: number) => paid * 2 >= asked && paid <= asked * 2;

/**
 * Pairs payments and requisitions one to one: closest dates first (a payment before the date counts as
 * twice as far, since payment usually follows), then the nearest amount.
 */
export function matchPayments(payments: readonly BankPayment[], reqs: readonly MatchCandidate[]): BankMatch[] {
  const pairs: { p: number; r: number; far: number; diff: number }[] = [];
  payments.forEach((pay, p) => reqs.forEach((req, r) => {
    const gap = daysBetween(req.day, pay.day);
    if (gap >= -MATCH_DAYS_BEFORE && gap <= MATCH_DAYS_AFTER && closeEnough(pay.cents, req.cents)) {
      pairs.push({ p, r, far: gap >= 0 ? gap : -2 * gap, diff: Math.abs(pay.cents - req.cents) });
    }
  }));
  pairs.sort((a, b) => a.far - b.far || a.diff - b.diff || a.p - b.p || a.r - b.r);
  const usedP = new Set<number>();
  const usedR = new Set<number>();
  const out: BankMatch[] = [];
  for (const x of pairs) {
    if (usedP.has(x.p) || usedR.has(x.r)) continue;
    usedP.add(x.p); usedR.add(x.r);
    const pay = payments[x.p]!; const req = reqs[x.r]!;
    out.push({ reqId: req.id, reqDay: req.day, reqCents: req.cents, day: pay.day, cents: pay.cents, ref: pay.ref });
  }
  return out.sort((a, b) => a.reqDay.localeCompare(b.reqDay) || a.reqId.localeCompare(b.reqId));
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
  const add = (p: BankPayment | null, looked: boolean) => {
    if (p && !seen.has(p.ref)) { seen.add(p.ref); payments.push(p); } else if (looked && !p) skipped++;
  };
  if (head >= 0) {
    const h = rows[head]!.map(text);
    const col = (re: RegExp) => h.findIndex((x) => re.test(x));
    const dCol = col(/^date/i); const rCol = col(/ref/i); const aCol = col(/amount|paid|debit/i);
    for (const r of rows.slice(head + 1)) {
      if (!r.some((c) => text(c) || c instanceof Date)) continue;
      const day = readDay(r[dCol]); const ref = cleanRef(text(r[rCol])); const cents = readCents(r[aCol]);
      if (!day && /total/i.test(r.map(text).join(' '))) continue;
      add(day && ref && cents ? { day, ref, cents } : null, true);
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
export interface BankProof { day: string; ref: string; cents: number; payee?: string }
