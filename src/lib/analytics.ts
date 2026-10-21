/** Small number helpers shared by the dashboards and charts. */

/** The month key `n` months after `month` (YYYY-MM); negative goes back. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** The `count` month keys ending with `last`, oldest first. */
export function monthsEnding(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(last, i - count + 1));
}

/** "Oct" for 2026-10; with the year, "Oct 2026". */
export function shortMonth(month: string, withYear = false): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** Percentage change from `before` to `now`, or null when there is nothing to compare with. */
export function pctChange(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

/** A round number at or above `v` for the top of a chart axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

/** Short figure for axis labels: 1.2k, 3.4M. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Shares of a whole as whole-number percentages that add up to 100 (largest remainder). */
export function shares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i]! += 1; left -= 1; }
  return out;
}
