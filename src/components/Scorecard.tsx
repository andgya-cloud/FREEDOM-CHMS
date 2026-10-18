import { Link } from 'react-router-dom';
import { changeText, trendOf, type GivingPart, type Headlines, type ReportDoc, type Trend } from '../../functions/src/shared/reports';
import { formatMoney } from '../../functions/src/shared/giving';

interface Tile {
  key: string;
  label: string;
  value: string;
  now: number | null;
  previous: number | null;
  lastYear: number | null;
  unit?: '%';
  to: string;
  /** For follow-ups, fewer is better. */
  lowerIsBetter?: boolean;
}

const ARROW: Record<Trend, string> = { up: '▲', down: '▼', same: '●', none: '' };

function Change({ now, before, since, unit, lowerIsBetter }: { now: number | null; before: number | null; since: string; unit?: '%'; lowerIsBetter?: boolean }) {
  const t = trendOf(now, before);
  const good = t === 'same' || t === 'none' ? '' : (t === 'up') !== !!lowerIsBetter ? ' tile-good' : ' tile-bad';
  return (
    <span className={`tile-change${good}`}>
      {t !== 'none' && <span aria-hidden="true">{ARROW[t]} </span>}
      {changeText(now, before, since, unit)}
    </span>
  );
}

/**
 * The home scorecard: the numbers that matter most, each with how it moved
 * since last week (or month) and a year ago. Each tile opens the records behind it.
 */
export function Scorecard({ report, giving, base }: { report: ReportDoc; giving: GivingPart | null; base: string }) {
  const h = report.headlines;
  const pick = (f: (x: Headlines) => number | null) => ({ now: f(h.current), previous: f(h.previous), lastYear: f(h.lastYear) });
  const n = (v: number | null, unit = '') => (v == null ? '–' : `${v}${unit}`);
  const tiles: Tile[] = [
    { key: 'attendance', label: 'Attendance', value: n(h.current.attendance), ...pick((x) => x.attendance), to: `${base}#attendance` },
    { key: 'visitors', label: 'First-time visitors', value: n(h.current.visitors), ...pick((x) => x.visitors), to: `${base}#visitors` },
    { key: 'salvations', label: 'Salvations', value: n(h.current.salvations), ...pick((x) => x.salvations), to: `${base}#salvations` },
    { key: 'baptisms', label: 'Baptisms', value: n(h.current.baptisms), ...pick((x) => x.baptisms), to: `${base}#salvations` },
    { key: 'groups', label: 'In a Freedom Group', value: n(h.current.groupParticipation, '%'), ...pick((x) => x.groupParticipation), unit: '%', to: `${base}#groups` },
    { key: 'serving', label: 'Serving', value: n(h.current.servingRate, '%'), ...pick((x) => x.servingRate), unit: '%', to: `${base}#groups` },
  ];
  if (giving) {
    tiles.push({
      key: 'giving', label: 'Giving', value: formatMoney(giving.current.totalCents, giving.currency),
      now: giving.current.totalCents, previous: giving.previous.totalCents, lastYear: giving.lastYear.totalCents, to: `${base}#giving`,
    });
  }
  tiles.push({ key: 'followups', label: 'Follow-ups overdue', value: String(report.scorecard.overdueFollowUps), now: null, previous: null, lastYear: null, to: '/follow-ups', lowerIsBetter: true });

  const since = report.type === 'weekly' ? 'last week' : 'last month';
  return (
    <ul className="tiles" aria-label="Scorecard">
      {tiles.map((t) => (
        <li key={t.key}>
          <Link to={t.to} className="tile">
            <span className="tile-label">{t.label}</span>
            <span className="tile-value">{t.value}</span>
            {t.key === 'followups' ? (
              <span className="tile-change">When the report was made</span>
            ) : (
              <>
                <Change now={t.now} before={t.previous} since={since} unit={t.unit} lowerIsBetter={t.lowerIsBetter} />
                <Change now={t.now} before={t.lastYear} since="last year" unit={t.unit} lowerIsBetter={t.lowerIsBetter} />
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A simple line chart of weekly attendance, with plain labels. */
export function TrendChart({ points, label }: { points: { week: string; total: number }[]; label: string }) {
  const W = 320;
  const H = 120;
  const pad = 8;
  const max = Math.max(1, ...points.map((p) => p.total));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad - 14);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const day = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
  const last = points[points.length - 1];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={label}>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="chart-axis" />
        <path d={path} className="chart-line" />
        {points.map((p, i) => <circle key={p.week} cx={x(i)} cy={y(p.total)} r={2.5} className="chart-dot"><title>{`Week of ${day(p.week)}: ${p.total}`}</title></circle>)}
        {last && <text x={x(points.length - 1)} y={y(last.total) - 6} textAnchor="end" className="chart-text">{last.total}</text>}
        <text x={pad} y={H + 12} className="chart-text">{points[0] ? day(points[0].week) : ''}</text>
        <text x={W - pad} y={H + 12} textAnchor="end" className="chart-text">{last ? day(last.week) : ''}</text>
      </svg>
      <figcaption className="small muted">{label}</figcaption>
    </figure>
  );
}

/** Bars for comparing a few numbers side by side. */
export function Bars({ rows, format = String }: { rows: { label: string; value: number; note?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track"><span className="bars-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bars-value">{format(r.value)}{r.note ? <span className="muted small"> {r.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}
