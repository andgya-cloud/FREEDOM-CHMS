import { Link } from 'react-router-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { compact, niceMax, pctChange, shares } from '../lib/analytics';

/**
 * The dashboard kit: KPI cards, line and column charts, donuts, gauges and
 * sparklines. Drawn as plain SVG so they work offline, print, and follow the
 * light, dark and church looks through CSS colours (--c1 to --c6).
 * Lines are thin, smooth and drawn in a gradient (--g-from to --g-to), so each look
 * gets its own colours (Andy, 2026-10-26, 6A and 7A).
 */

/** A two-stop gradient whose colours come from CSS (.gs-a and .gs-b), so the looks can recolour it. */
function Grad({ id, vertical, fade }: { id: string; vertical?: boolean; fade?: boolean }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
      <stop offset="0" className={fade ? 'gs-a gs-soft' : 'gs-a'} />
      <stop offset="1" className={fade ? 'gs-fade' : 'gs-b'} />
    </linearGradient>
  );
}

/** A smooth line through the points that never swings above or below them. */
function smooth(pts: readonly (readonly [number, number])[]): string {
  return pts.map(([px, py], i) => {
    if (i === 0) return `M${px.toFixed(1)},${py.toFixed(1)}`;
    const [qx, qy] = pts[i - 1]!;
    const h = (px - qx) / 2;
    return `C${(qx + h).toFixed(1)},${qy.toFixed(1)} ${(px - h).toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
}

const fmtDefault = (v: number) => v.toLocaleString('en-GB');

/** The drawn width of a chart, so its labels stay readable on a phone and on a wide screen. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e!.contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** "▲ 12% vs last month", green when it moved the good way. */
export function Delta({ now, before, since, lowerIsBetter }: { now: number | null; before: number | null; since: string; lowerIsBetter?: boolean }) {
  const p = pctChange(now, before);
  if (p == null) return <span className="kpi-delta">No figure for {since}</span>;
  const tone = p === 0 ? '' : (p > 0) !== !!lowerIsBetter ? ' up-good' : ' up-bad';
  return (
    <span className={`kpi-delta${tone}`}>
      <span aria-hidden="true">{p > 0 ? '▲' : p < 0 ? '▼' : '●'} </span>
      {p === 0 ? 'Same as' : `${Math.abs(p)}% ${p > 0 ? 'up on' : 'down on'}`} {since}
    </span>
  );
}

export interface KpiProps {
  label: string;
  value: string;
  /** Comparisons shown under the value. */
  changes?: { now: number | null; before: number | null; since: string }[];
  lowerIsBetter?: boolean;
  spark?: number[];
  note?: ReactNode;
  to?: string;
  tone?: 'gold' | 'navy' | 'ok' | 'warn';
}

/** A KPI card: the figure, how it moved, and a small trend line. */
export function KpiCard({ label, value, changes = [], lowerIsBetter, spark, note, to, tone }: KpiProps) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {changes.map((c) => <Delta key={c.since} {...c} lowerIsBetter={lowerIsBetter} />)}
      {note && <span className="kpi-note">{note}</span>}
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </>
  );
  const cls = `kpi${tone ? ` kpi-${tone}` : ''}`;
  return <li>{to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

export function KpiRow({ children, label }: { children: ReactNode; label: string }) {
  return <ul className="kpis" aria-label={label}>{children}</ul>;
}

/** A tiny trend line with the last point marked. */
export function Sparkline({ values, width = 120, height = 30 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i * (width - 4)) / Math.max(1, values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = smooth(values.map((v, i) => [x(i), y(v)] as const));
  const i = values.length - 1;
  const id = useId();
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
      <defs><Grad id={`${id}a`} vertical fade /><Grad id={`${id}l`} /></defs>
      <path d={`${d} L${x(i)},${height} L${x(0)},${height} Z`} className="spark-area" fill={`url(#${id}a)`} />
      <path d={d} className="spark-line" stroke={`url(#${id}l)`} />
      <circle cx={x(i)} cy={y(values[i]!)} r={2.2} className="spark-dot" />
    </svg>
  );
}

export interface Series { name: string; values: (number | null)[]; dashed?: boolean }

/** Lines over time with a light grid; the first series is filled. Hover a column to read every value. */
export function LineChart({ labels, series, format = fmtDefault, axis = compact, label, height = 200 }: {
  labels: string[]; series: Series[]; format?: (v: number) => string; axis?: (v: number) => string; label: string; height?: number;
}) {
  const [ref, W] = useWidth();
  const H = W < 480 ? Math.round(height * 0.85) : height;
  const L = 42, R = 12, T = 12, B = 24;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const n = labels.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = (top < 20 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => f * top);
  // Each unbroken run of figures is one smooth curve; a missing week leaves a gap.
  const runsOf = (vals: (number | null)[]) => {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v == null) { if (run.length) runs.push(run); run = []; return; }
      run.push([x(i), y(v)]);
    });
    if (run.length) runs.push(run);
    return runs;
  };
  const pathOf = (vals: (number | null)[]) => runsOf(vals).map(smooth).join(' ');
  const id = useId();
  const first = series[0];
  const area = first ? runsOf(first.values).filter((r) => r.length > 1)
    .map((r) => `${smooth(r)} L${r[r.length - 1]![0].toFixed(1)},${y(0)} L${r[0]![0].toFixed(1)},${y(0)} Z`).join(' ') : '';
  const every = Math.ceil(n / Math.max(3, Math.floor(W / 70)));
  return (
    <figure className="viz" ref={ref}>
      {series.length > 1 && (
        <ul className="viz-legend">
          {series.map((s, k) => <li key={s.name}><span className={`swatch c${k + 1}${s.dashed ? ' dashed' : ''}`} />{s.name}</li>)}
        </ul>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs><Grad id={`${id}a`} vertical fade /><Grad id={`${id}l`} /></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="viz-tick">{axis(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => ((i % every === 0 && n - 1 - i >= every) || i === n - 1) && (
          <text key={l + i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="viz-tick">{l}</text>
        ))}
        {area && <path d={area} className="viz-area" fill={`url(#${id}a)`} />}
        {series.map((s, k) => <path key={s.name} d={pathOf(s.values)} className={`viz-line c${k + 1}${s.dashed ? ' dashed' : ''}`} stroke={k === 0 && !s.dashed ? `url(#${id}l)` : undefined} />)}
        {series.map((s, k) => {
          const last = s.values.reduce<number>((at, v, i) => (v != null ? i : at), -1);
          return s.values.map((v, i) => v != null && (
            <g key={`${k}-${i}`}>
              {i === last && !s.dashed && <circle cx={x(i)} cy={y(v)} r={6} className={`viz-halo c${k + 1}`} />}
              <circle cx={x(i)} cy={y(v)} r={i === last ? 3 : 1.6} className={`viz-dot c${k + 1}${s.dashed ? ' dashed' : ''}`} />
            </g>
          ));
        })}
        {labels.map((l, i) => (
          <rect key={`h${i}`} x={x(i) - (W - L - R) / Math.max(1, n - 1) / 2} y={T} width={(W - L - R) / Math.max(1, n - 1)} height={H - T - B} className="viz-hit">
            <title>{`${l}\n${series.map((s) => `${s.name}: ${s.values[i] == null ? '–' : format(s.values[i]!)}`).join('\n')}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}

/** Upright bars for a handful of periods or groups; the last (or chosen) bar is gold. */
export function ColumnChart({ rows, format = fmtDefault, axis = compact, label, highlight, height = 180 }: {
  rows: { label: string; value: number }[]; format?: (v: number) => string; axis?: (v: number) => string; label: string; highlight?: number; height?: number;
}) {
  const [ref, W] = useWidth();
  const H = height;
  const L = 42, R = 8, T = 18, B = 24;
  const top = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const slot = (W - L - R) / Math.max(1, rows.length);
  const bw = Math.min(26, slot * 0.46);
  const id = useId();
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const hi = highlight ?? rows.length - 1;
  const showValues = rows.length <= 8 || slot >= 40;
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor((W - L) / 44)));
  const fit = (t: string) => { const room = Math.max(4, Math.floor((slot * labelEvery) / 6.2)); return t.length > room ? `${t.slice(0, room - 1)}…` : t; };
  if (!rows.some((r) => r.value > 0)) return <p className="muted small">Nothing recorded yet.</p>;
  return (
    <figure className="viz" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs><Grad id={`${id}b`} vertical /></defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(f * top)} y2={y(f * top)} className="viz-grid" />
            <text x={L - 6} y={y(f * top) + 3.5} textAnchor="end" className="viz-tick">{axis(f * top)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = L + slot * i + slot / 2;
          const h = Math.max(0, y(0) - y(r.value));
          return (
            <g key={r.label + i}>
              <rect x={cx - bw / 2} y={y(0) - h} width={bw} height={h} rx={Math.min(bw / 2, h / 2, 8)} className={i === hi ? 'viz-bar hi' : 'viz-bar'} fill={`url(#${id}b)`}>
                <title>{`${r.label}: ${format(r.value)}`}</title>
              </rect>
              {showValues && r.value > 0 && <text x={cx} y={y(0) - h - 4} textAnchor="middle" className="viz-val">{axis(r.value)}</text>}
              {i % labelEvery === 0 && <text x={cx} y={H - 6} textAnchor="middle" className="viz-tick">{fit(r.label)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}

/** A ring split into shares, with a legend of amounts and percentages. */
export function Donut({ rows, format = fmtDefault, center, centerNote, label }: {
  rows: { label: string; value: number }[]; format?: (v: number) => string; center?: string; centerNote?: string; label: string;
}) {
  const shown = rows.filter((r) => r.value > 0);
  const top = shown.length <= 6 ? shown : shown.slice(0, 5);
  const rest = shown.slice(top.length).reduce((s, r) => s + r.value, 0);
  const parts = rest > 0 ? [...top, { label: 'Others', value: rest }] : top;
  const total = parts.reduce((s, r) => s + r.value, 0);
  const pct = shares(parts.map((p) => p.value));
  const R = 52;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <figure className="viz donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={label}>
        <circle cx={70} cy={70} r={R} className="donut-track" />
        {total > 0 && parts.map((p, i) => {
          const len = (p.value / total) * C;
          const seg = <circle key={p.label} cx={70} cy={70} r={R} className={`donut-seg c${i + 1}`} strokeDasharray={`${Math.max(0.1, len - (parts.length > 1 ? 9 : 0))} ${C}`} strokeDashoffset={-at} transform="rotate(-90 70 70)"><title>{`${p.label}: ${format(p.value)} (${pct[i]}%)`}</title></circle>;
          at += len;
          return seg;
        })}
        {center && <text x={70} y={centerNote ? 70 : 75} textAnchor="middle" className="donut-center">{center}</text>}
        {centerNote && <text x={70} y={86} textAnchor="middle" className="viz-tick">{centerNote}</text>}
      </svg>
      <ul className="viz-legend col">
        {parts.length === 0 && <li className="muted">Nothing yet</li>}
        {parts.map((p, i) => (
          <li key={p.label}><span className={`swatch c${i + 1}`} /><span className="lg-name">{p.label}</span><span className="lg-val">{format(p.value)} <span className="muted">{pct[i]}%</span></span></li>
        ))}
      </ul>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}

/** A half-dial from 0 to `max`, for progress toward a target or a rate. */
export function Gauge({ value, max, label, display, caption, bands }: {
  value: number; max: number; label: string; display: string; caption?: string;
  /** Shares of `max` from which the dial turns gold, then green; without them it stays one colour. */
  bands?: [fair: number, good: number];
}) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const R = 54;
  const arc = (to: number) => {
    const a = Math.PI * (1 - to);
    return `M${70 - R},74 A${R},${R} 0 0 1 ${(70 + R * Math.cos(a)).toFixed(2)},${(74 - R * Math.sin(a)).toFixed(2)}`;
  };
  const tone = !bands ? 'g-plain' : f >= bands[1] ? 'g-good' : f >= bands[0] ? 'g-fair' : 'g-low';
  // A dash means there is no figure yet: say so in words rather than draw an empty dial (Andy, 2026-10-26, 6A).
  const empty = display === '–';
  const end = Math.PI * (1 - f);
  const id = useId();
  return (
    <figure className={`viz gauge${empty ? ' gauge-none' : ''}`}>
      <svg viewBox="0 0 140 86" role="img" aria-label={`${label}: ${empty ? 'no data yet' : display}`} className={tone}>
        <defs><Grad id={`${id}g`} /></defs>
        <path d={arc(1)} className="gauge-track" />
        {!empty && f > 0 && <path d={arc(f)} className="gauge-fill" stroke={`url(#${id}g)`} />}
        {!empty && f > 0 && <circle cx={70 + R * Math.cos(end)} cy={74 - R * Math.sin(end)} r={4} className="gauge-cap" />}
        <text x={70} y={empty ? 66 : 68} textAnchor="middle" className={empty ? 'gauge-empty' : 'gauge-value'}>{empty ? 'No data yet' : display}</text>
      </svg>
      <figcaption><strong>{label}</strong>{caption && <span className="muted small"> {caption}</span>}</figcaption>
    </figure>
  );
}

/** A dashboard panel: a titled card with an optional control on the right. */
export function Panel({ title, action, children, wide }: { title: string; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`panel${wide ? ' panel-wide' : ''}`}>
      <div className="panel-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

/** Steps people move through, each bar sized against the first, with how many were lost between steps. */
export function Funnel({ steps, label }: { steps: { label: string; count: number; dropOff: number | null }[]; label: string }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ol className="funnel" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label}>
          <span className="funnel-label">{s.label}</span>
          <span className="funnel-track"><span className={`funnel-bar c${(i % 6) + 1}`} style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }} /></span>
          <span className="funnel-count">{s.count.toLocaleString('en-GB')}</span>
          {i > 0 && <span className="funnel-drop muted small">{s.dropOff == null ? '' : `${s.dropOff}% did not go on`}</span>}
        </li>
      ))}
    </ol>
  );
}

/** A button that saves the figures behind a dashboard as a CSV file for Excel. */
export function CsvButton({ name, csv }: { name: string; csv: () => string }) {
  return (
    <button type="button" className="btn btn-quiet no-print" onClick={() => {
      const url = URL.createObjectURL(new Blob(['﻿', csv()], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Download CSV</button>
  );
}
