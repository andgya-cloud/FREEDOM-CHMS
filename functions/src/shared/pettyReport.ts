/**
 * The professional petty cash report (Andy, 2026-11-08) for a month ("2026-10") or a year ("2026"), in
 * all three organizations: opening balance, money in, money out, closing balance, spending by category
 * against the period before, every voucher, every top-up and the checks. Times are read in Nairobi.
 */
import { categoryLabel, pettyLedger, type PettyCashRequisition, type PettyFund } from './pettyCash.js';

const EAT = 3 * 3_600_000;
const periodOf = (ms: number, len: number) => new Date(ms + EAT).toISOString().slice(0, len);
const dayOf = (ms: number) => new Date(ms + EAT).toISOString().slice(0, 10);
/** The period before: "2026-10" gives "2026-09", "2026-01" gives "2025-12", "2026" gives "2025". */
export function previousPeriod(period: string): string {
  if (period.length === 4) return String(Number(period) - 1);
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export function periodName(period: string): string {
  return period.length === 4 ? `January to December ${period}`
    : new Date(`${period}-01T12:00:00Z`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface ReportVoucher {
  id: string; number: string; date: string; requester: string; category: string; payee: string; mpesaCode: string; refNo: string;
  approvedBy: string; cents: number; receipts: number; past: boolean;
}
export interface ReportMoneyIn { date: string; by: string; note: string; cents: number; past: boolean }
export interface ReportCategory { category: string; count: number; cents: number; share: number; beforeCents: number }
export interface ReportMonthRow { period: string; name: string; openingCents: number; inCents: number; outCents: number; closingCents: number; vouchers: number }
export interface PettyReport {
  period: string; name: string; beforeName: string;
  openingCents: number; inCents: number; outCents: number; closingCents: number; beforeOutCents: number;
  categories: ReportCategory[];
  vouchers: ReportVoucher[];
  moneyIn: ReportMoneyIn[];
  /** A year report's twelve months (only months up to the latest with figures). */
  months: ReportMonthRow[];
  waiting: { count: number; cents: number };
  missingReceipts: number;
  pastRecords: number;
}

type Req = Pick<PettyCashRequisition, 'id' | 'number' | 'status' | 'totalCents' | 'approved' | 'requesterName' | 'category' | 'signatures'>
  & { createdAt?: unknown; categoryNote?: string | null; payee?: string | null; mpesaCode?: string | null; refNo?: string | null; pastRecord?: boolean };
type Fund = Pick<PettyFund, 'id' | 'kind' | 'amountCents' | 'status' | 'doneAt' | 'signatures'> & { note?: string | null; pastRecord?: boolean };

export function pettyReport(period: string, funds: readonly Fund[], requisitions: readonly Req[], receiptCounts: Readonly<Record<string, number>>,
  millis: (t: unknown) => number | null, now = Date.now()): PettyReport {
  const len = period.length;
  const at = (t: unknown) => millis(t) ?? now;
  const ledger = pettyLedger(funds, requisitions, millis, now);
  const inP = (ms: number, p = period) => periodOf(ms, len) === p;
  const before = ledger.filter((l) => periodOf(l.at, len) < period);
  const openingCents = before.length ? before[before.length - 1]!.balanceCents : 0;
  const lines = ledger.filter((l) => inP(l.at));
  const inCents = lines.reduce((n, l) => n + l.creditCents, 0);
  const outCents = lines.reduce((n, l) => n + l.debitCents, 0);
  const closingCents = lines.length ? lines[lines.length - 1]!.balanceCents : openingCents;

  const approved = requisitions.filter((r) => r.status === 'approved');
  const prev = previousPeriod(period);
  const mine = approved.filter((r) => inP(at(r.approved?.at))).sort((a, b) => at(a.approved?.at) - at(b.approved?.at) || (a.number ?? '').localeCompare(b.number ?? ''));
  const prevReqs = approved.filter((r) => inP(at(r.approved?.at), prev));
  const byCat = new Map<string, ReportCategory>();
  for (const r of mine) {
    const c = byCat.get(r.category) ?? { category: r.category, count: 0, cents: 0, share: 0, beforeCents: 0 };
    c.count += 1; c.cents += r.totalCents; byCat.set(r.category, c);
  }
  for (const r of prevReqs) {
    const c = byCat.get(r.category) ?? { category: r.category, count: 0, cents: 0, share: 0, beforeCents: 0 };
    c.beforeCents += r.totalCents; byCat.set(r.category, c);
  }
  const categories = [...byCat.values()].map((c) => ({ ...c, share: outCents ? c.cents / outCents : 0 })).sort((a, b) => b.cents - a.cents || b.beforeCents - a.beforeCents);
  const signers = (r: Req) => Object.values(r.signatures ?? {}).map((s) => s.name).join(' & ');
  const vouchers: ReportVoucher[] = mine.map((r) => ({
    id: r.id, number: r.number ?? '', date: dayOf(at(r.approved?.at)), requester: r.requesterName, category: categoryLabel(r), payee: r.payee ?? '',
    mpesaCode: r.mpesaCode ?? '', refNo: r.refNo ?? '', approvedBy: signers(r), cents: r.totalCents, receipts: receiptCounts[r.id] ?? 0, past: !!r.pastRecord,
  }));
  const moneyIn: ReportMoneyIn[] = funds.filter((f) => f.kind === 'topup' && f.status === 'done' && inP(at(f.doneAt)))
    .sort((a, b) => at(a.doneAt) - at(b.doneAt))
    .map((f) => ({ date: dayOf(at(f.doneAt)), by: Object.values(f.signatures ?? {}).map((s) => s.name).join(' & '), note: f.note ?? '', cents: f.amountCents, past: !!f.pastRecord }));

  const months: ReportMonthRow[] = [];
  if (len === 4) {
    const last = Math.max(0, ...ledger.filter((l) => inP(l.at)).map((l) => Number(periodOf(l.at, 7).slice(5))));
    let open = openingCents;
    for (let m = 1; m <= last; m++) {
      const p = `${period}-${String(m).padStart(2, '0')}`;
      const ls = ledger.filter((l) => periodOf(l.at, 7) === p);
      const close = ls.length ? ls[ls.length - 1]!.balanceCents : open;
      months.push({ period: p, name: periodName(p), openingCents: open, inCents: ls.reduce((n, l) => n + l.creditCents, 0), outCents: ls.reduce((n, l) => n + l.debitCents, 0),
        closingCents: close, vouchers: ls.filter((l) => l.kind === 'request').length });
      open = close;
    }
  }
  const waitingReqs = requisitions.filter((r) => (r.status === 'submitted' || r.status === 'checked') && periodOf(at(r.createdAt), len) <= period);
  return {
    period, name: periodName(period), beforeName: periodName(prev),
    openingCents, inCents, outCents, closingCents, beforeOutCents: prevReqs.reduce((n, r) => n + r.totalCents, 0),
    categories, vouchers, moneyIn, months,
    waiting: { count: waitingReqs.length, cents: waitingReqs.reduce((n, r) => n + r.totalCents, 0) },
    missingReceipts: vouchers.filter((v) => !v.past && v.receipts === 0).length,
    pastRecords: vouchers.filter((v) => v.past).length,
  };
}

/** "+12%" / "−5%" / "new" against the period before. */
export function changeLabel(now: number, before: number): string {
  if (!before) return now ? 'new' : '–';
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? 'same' : `${pct > 0 ? '+' : '-'}${Math.abs(pct)}%`;
}

/** Who prepares and who may approve the report (Andy 2A, 2026-11-08). */
export const REPORT_PREPARED_BY = { name: "Daniel Ojwang'", role: 'Accountant' };
export const REPORT_APPROVERS = ['Andrew Guya', 'Doreen Guya', 'Elias Omondi'] as const;
