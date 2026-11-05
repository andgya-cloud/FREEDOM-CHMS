/**
 * Child Champions' pay (Andy, 2026-11-05, 8A 9A 10A 11A 12): each champion has their own weekly amount and is paid
 * for each week they came; the Director adds any extra allowance with a reason; the month's report is ready on the
 * 28th and again on the 1st. Champions report at 8:30am and are late after 8:30am; a champion's QR card checks
 * them in at the door with the time.
 */
import { isInventoryManager } from './permissions.js';
import { isHopeDirector } from './hopePhotos.js';
import { readChampionPay, saturdayOnOrBefore, type Champion, type ChampionDay, type ChampionMark } from './hopeRegister.js';

export const REPORT_TIME = '08:30';
/** Present until 8:30, late after (Andy, 12). */
export function arrivalMark(time: string | null): ChampionMark {
  return time && time > REPORT_TIME ? 'late' : 'present';
}

/** Champion card codes, CC-0001. */
export const championCode = (n: number) => `CC-${String(n).padStart(4, '0')}`;
export function normalizeChampionCode(text: string): string | null {
  const m = /^\s*cc[-\s]?(\d{1,6})\s*$/i.exec(text);
  return m ? championCode(Number(m[1])) : null;
}
/** Codes for the champions without one, after the highest in use. */
export function newChampionCodes(champions: readonly Pick<Champion, 'id' | 'name' | 'code'>[]): Record<string, string> {
  let top = Math.max(0, ...champions.map((c) => Number(/^CC-(\d+)$/.exec(c.code ?? '')?.[1] ?? 0)));
  const out: Record<string, string> = {};
  for (const c of [...champions].filter((x) => !x.code).sort((a, b) => a.name.localeCompare(b.name))) out[c.id] = championCode(++top);
  return out;
}

export interface ChampionExtra { id: string; championId: string; month: string; amount: number; reason: string; deletedAt?: unknown }

export interface PayLine {
  championId: string;
  name: string;
  weeklyPay: number;
  /** A fixed amount for the month instead of the weekly one; 0 when none. */
  monthlyPay: number;
  /** Weeks in the month with the champion present or late. */
  weeks: number;
  late: number;
  basic: number;
  extras: number;
  extraReasons: string[];
  total: number;
}

/** Each champion's pay for a month, "YYYY-MM". */
export function monthPay(champions: readonly Champion[], days: readonly ChampionDay[], extras: readonly ChampionExtra[], month: string): { lines: PayLine[]; total: number } {
  const inMonth = days.filter((d) => !d.deletedAt && d.date.startsWith(month));
  const lines = champions.map((c): PayLine => {
    const weeks = new Set<string>();
    let late = 0;
    for (const d of inMonth) {
      const e = d.marks?.[c.id];
      if (e?.s === 'present' || e?.s === 'late') weeks.add(saturdayOnOrBefore(d.date));
      if (e?.s === 'late') late++;
    }
    const mine = extras.filter((x) => !x.deletedAt && x.championId === c.id && x.month === month);
    const weeklyPay = Math.max(0, Math.round(c.weeklyPay ?? 0));
    // A fixed amount for the month ("9000 - fixed") is paid whatever the weeks (Andy, 2026-11-05).
    const monthlyPay = Math.max(0, Math.round(c.monthlyPay ?? 0));
    const basic = monthlyPay ? (c.status === 'active' || weeks.size ? monthlyPay : 0) : weeks.size * weeklyPay;
    const extra = mine.reduce((n, x) => n + Math.round(x.amount), 0);
    return { championId: c.id, name: c.name, weeklyPay, monthlyPay, weeks: weeks.size, late, basic, extras: extra, extraReasons: mine.map((x) => x.reason), total: basic + extra };
  }).filter((l) => l.total > 0 || l.weeks > 0 || champions.find((c) => c.id === l.championId)?.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
  return { lines, total: lines.reduce((n, l) => n + l.total, 0) };
}

/** The month whose report is ready today: this month from the 28th, last month on the 1st to the 7th. */
export function payMonthReady(today: string): { month: string; final: boolean } | null {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  if (d >= 28) return { month: today.slice(0, 7), final: false };
  if (d <= 7) { const p = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; return { month: p, final: true }; }
  return null;
}

/** Reads the weekly amounts sheet: a Name column and a weekly amount column (Andy will share his). */
export function planPayUpload(rows: readonly (readonly unknown[])[], champions: readonly Pick<Champion, 'id' | 'name'>[]): { found: { id: string; name: string; amount: number; monthly: boolean }[]; notFound: string[] } | null {
  const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const key = (v: unknown) => clean(v).toLowerCase().replace(/[^a-z]/g, '');
  const at = rows.findIndex((r) => r.some((c) => key(c) === 'name' || key(c) === 'championname' || key(c) === 'names'));
  if (at < 0) return null;
  const head = rows[at]!.map(key);
  const ni = head.findIndex((k) => k === 'name' || k === 'championname' || k === 'names');
  const ai = head.findIndex((k) => /weekly|perweek|amount|pay|allowance|kes|appreciation/.test(k));
  if (ai < 0) return null;
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  const found: { id: string; name: string; amount: number; monthly: boolean }[] = [];
  const notFound: string[] = [];
  for (const r of rows.slice(at + 1)) {
    const name = clean(r[ni]);
    if (!name) continue;
    const pay = readChampionPay(r[ai] as never);
    const amount = pay.weekly ?? pay.monthly;
    if (amount == null) { notFound.push(`${name} (no amount)`); continue; }
    const words = norm(name);
    const c = champions.find((x) => norm(x.name).join(' ') === words.join(' '))
      ?? champions.find((x) => { const w = norm(x.name); return w[0] === words[0] && w[w.length - 1] === words[words.length - 1]; });
    if (c) found.push({ id: c.id, name: c.name, amount, monthly: pay.monthly != null }); else notFound.push(name);
  }
  return { found, notFound };
}

/** Who keeps the champions, their register and pay: admins, and the Hope Centre Director (Andy, 2026-11-05). */
export function isChampionManager(p: (Parameters<typeof isInventoryManager>[0]) & { orgIds?: string[] } | null | undefined, orgId: string): boolean {
  return isInventoryManager(p) || isHopeDirector(p as Parameters<typeof isHopeDirector>[0], orgId);
}
