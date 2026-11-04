import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Sparkline } from './charts';

/** The key-figure cards, outcome rings, columns and donut of the "See figures" panels (ADIA first, then the Hope Centre). */

/** A key figure: its name and a small chip, the figure, a line under it, and a trend when there is one. */
export function Kpi({ label, chip, tone, value, sub, spark, to }: { label: string; chip?: string; tone?: 'ok' | 'warn'; value: string; sub: string; spark?: number[]; to?: string }) {
  const body = (
    <>
      <span className="lav-lbl">{label}{chip && <span className={`lav-chip${tone ? ` ${tone}` : ''}`}>{chip}</span>}</span>
      <span className="lav-val">{value}</span>
      <span className="lav-sub">{sub}</span>
      {spark && <span className="lav-spark"><Sparkline values={spark} /></span>}
    </>
  );
  return to ? <Link to={to} className="card lav-kpi">{body}</Link> : <div className="card lav-kpi">{body}</div>;
}

/** An outcome as a full ring, drawn in ADIA's gradient; "No data" until there are records. */
export function Ring({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const id = useId();
  const C = 2 * Math.PI * 36;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  return (
    <figure className="lav-ring">
      <svg viewBox="0 0 92 92" role="img" aria-label={`${label}: ${v == null ? 'no data yet' : `${Math.round(v)}%`}`}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="lg-a" /><stop offset="0.6" className="lg-b" /><stop offset="1" className="lg-c" /></linearGradient></defs>
        <circle cx={46} cy={46} r={36} className="lav-ring-track" />
        {v != null && v > 0 && <circle cx={46} cy={46} r={36} className="lav-ring-fill" stroke={`url(#${id})`} strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform="rotate(-90 46 46)" />}
        <text x={46} y={v == null ? 50 : 52} textAnchor="middle" className={v == null ? 'lav-ring-none' : 'lav-ring-val'}>{v == null ? 'No data' : `${Math.round(v)}%`}</text>
      </svg>
      <figcaption><b>{label}</b><span>{v == null ? 'Waiting for records' : note ?? ''}</span></figcaption>
    </figure>
  );
}

/** Students in each department as rounded gradient columns, each with its count on top. */
export function DeptBars({ rows, what = 'Enrolled students in each department' }: { rows: { label: string; title: string; value: number }[]; what?: string }) {
  const shown = rows.filter((r) => r.value > 0);
  if (shown.length === 0) return <p className="muted small">Nothing recorded yet.</p>;
  const max = Math.max(...shown.map((r) => r.value)) * 1.15;
  return (
    <div className="lav-bars" role="img" aria-label={`${what}: ${shown.map((r) => `${r.title} ${r.value}`).join(', ')}`}>
      {shown.map((r, i) => (
        <div key={r.title} className="lav-bar" title={`${r.title}: ${r.value}`}>
          <span className="lav-bar-v">{r.value}</span>
          <span className="lav-bar-col" style={{ height: `${(r.value / max) * 100}%`, animationDelay: `${i * 0.08}s` }} />
          <span className="lav-bar-l">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export const DONUT_COLOURS: [string, string][] = [['#1f2a5c', '#3a4a8c'], ['#c99a3c', '#e9c977'], ['#34c38f', '#7fdcb5'], ['#5b6aa8', '#8c97c9'], ['#8a6d2f', '#b8923f'], ['#9497b3', '#c3c5d8']];
/** Freedom Hope Centre's greens, with gold. */
export const HOPE_DONUT_COLOURS: [string, string][] = [['#02341b', '#038241'], ['#16a058', '#4fd18f'], ['#c99a3c', '#e9c977'], ['#05542d', '#2f9e63'], ['#7fc8a0', '#b9e4cc'], ['#9497b3', '#c3c5d8']];

/** Where every student is: a thick gradient ring and a legend of statuses with bars. */
export function StatusDonut({ rows, title, sub, noun, colours = DONUT_COLOURS }: { rows: { label: string; value: number }[]; title: string; sub: string; noun: string; colours?: [string, string][] }) {
  const id = useId();
  const shown = rows.filter((r) => r.value > 0);
  const total = shown.reduce((n, r) => n + r.value, 0);
  const C = 2 * Math.PI * 78;
  const gap = shown.length > 1 ? 16 : 0;
  let at = 0;
  return (
    <section className="card lav-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${sub}: ${shown.map((r) => `${r.label} ${r.value}`).join(', ') || 'none yet'}`}>
        <defs>{colours.map(([a, b], i) => <linearGradient key={a} id={`${id}${i}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>)}</defs>
        <circle cx={100} cy={100} r={78} className="lav-donut-track" />
        {total > 0 && shown.map((r, i) => {
          const len = (r.value / total) * C;
          const seg = <circle key={r.label} cx={100} cy={100} r={78} fill="none" stroke={`url(#${id}${i % colours.length})`} strokeWidth={22} strokeLinecap={shown.length > 1 ? 'round' : 'butt'}
            strokeDasharray={`${Math.max(0.1, len - gap)} ${C}`} strokeDashoffset={-(at + gap / 2)} transform="rotate(-90 100 100)" />;
          at += len;
          return seg;
        })}
        <circle cx={100} cy={100} r={56} className="lav-donut-hole" />
        <text x={100} y={98} textAnchor="middle" className="lav-donut-n">{total}</text>
        <text x={100} y={120} textAnchor="middle" className="lav-donut-t">{noun}</text>
      </svg>
      <div>
        <h2>{title}</h2>
        <p className="lav-sub">{sub}</p>
        <div className="lav-legend">
          {shown.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
          {shown.map((r, i) => {
            const [a, b] = colours[i % colours.length]!;
            const p = total ? Math.round((r.value / total) * 100) : 0;
            return (
              <div key={r.label} className="lav-lg">
                <span className="lav-sw" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                <span className="lav-lg-name"><b>{r.label}</b><span className="lav-meter"><i style={{ width: `${p}%`, background: `linear-gradient(90deg, ${a}, ${b})` }} /></span></span>
                <span className="lav-lg-num">{r.value}</span>
                <span className="lav-lg-pc">{p}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
