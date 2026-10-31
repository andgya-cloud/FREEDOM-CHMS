import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { useReports } from '../../state/useReports';
import { ColumnChart, CsvButton, Donut, Funnel, Gauge, KpiCard, KpiRow, LineChart, Panel } from '../../components/charts';
import type { Headlines } from '../../../functions/src/shared/reports';
import { toCsv } from '../../lib/analytics';

/**
 * The ministry dashboard: the weekly reports laid side by side, so the pastor
 * sees how attendance, visitors, salvations and baptisms move week by week,
 * who came, how many stay connected, and where people stop on the journey.
 * It holds no money; giving has its own dashboard.
 */
/** The same dashboard inside the Weekly tab of Reports (Andy, 2026-10-31, 4A: one Reports page). */
export function WeeklyDashboard({ org }: { org: Organization }) {
  return <Dashboard org={org} embedded />;
}

const SPANS = [12, 26, 52] as const;
const day = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v)}%`);

function Dashboard({ org, embedded = false }: { org: Organization; embedded?: boolean }) {
  const { reports, loading } = useReports(org.id);
  const [span, setSpan] = useState<(typeof SPANS)[number]>(12);
  const weeks = useMemo(() => reports.filter((r) => r.type === 'weekly').sort((a, b) => a.from.localeCompare(b.from)), [reports]);
  const shown = weeks.slice(-span);
  const latest = shown[shown.length - 1];

  if (loading) return <div className={embedded ? 'dash' : 'page dash'}><p className="muted">Loading…</p></div>;
  if (!latest && embedded) return null;
  if (!latest) {
    return (
      <div className="page dash">
        <h1>Dashboard</h1>
        <div className="notice">The dashboard fills in from the weekly reports, made every Monday at 07:00. <Link to="/reports">Open reports</Link></div>
      </div>
    );
  }

  const h = latest.headlines;
  const series = (f: (x: Headlines) => number | null) => shown.map((r) => f(r.headlines.current));
  const labels = shown.map((r) => day(r.from));
  const kpi = (f: (x: Headlines) => number | null) => ({
    spark: series(f).map((v) => v ?? 0),
    changes: [{ now: f(h.current), before: f(h.previous), since: 'last week' }, { now: f(h.current), before: f(h.lastYear), since: 'last year' }],
  });
  const n = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('en-GB'));
  const s = latest.scorecard;
  const base = `/reports/${org.id}/${latest.id}`;

  return (
    <div className={embedded ? 'dash' : 'page dash'}>
      <div className="page-head">
        {embedded ? <h2>Week by week</h2> : <h1>Dashboard</h1>}
        <span className="row-actions">
          <CsvButton name={`Dashboard-${latest.from}.csv`} csv={() => toCsv(
            ['Week of', 'Attendance', 'First-time visitors', 'Salvations', 'Baptisms', 'Regular attenders', 'In a group %', 'Serving %', 'Visitors back %', 'Followed up in 48h %', 'Net growth'],
            shown.map((r) => { const c = r.headlines.current; return [r.from, c.attendance, c.visitors, c.salvations, c.baptisms, c.regularAttenders, c.groupParticipation, c.servingRate, c.returnRate, c.followUpSpeed, c.netGrowth]; }),
          )} />
          <button type="button" className="btn btn-quiet no-print" onClick={() => window.print()}>Print</button>
        </span>
      </div>
      <p className="lead">{latest.label}</p>
      <div className="dash-controls no-print">
        <div className="segmented" role="group" aria-label="How many weeks">
          {SPANS.map((w) => <button key={w} type="button" className={span === w ? 'on' : ''} onClick={() => setSpan(w)}>{w} weeks</button>)}
        </div>
        <Link to={base} className="btn btn-quiet">Latest report</Link>
      </div>

      <KpiRow label="This week at a glance">
        <KpiCard label="Service attendance" value={n(h.current.attendance)} tone="gold" {...kpi((x) => x.attendance)} to={`${base}#attendance`} />
        <KpiCard label="First-time visitors" value={n(h.current.visitors)} {...kpi((x) => x.visitors)} to={`${base}#visitors`} />
        <KpiCard label="Salvations" value={n(h.current.salvations)} {...kpi((x) => x.salvations)} to={`${base}#salvations`} />
        <KpiCard label="Baptisms" value={n(h.current.baptisms)} {...kpi((x) => x.baptisms)} to={`${base}#salvations`} />
        <KpiCard label="Regular attenders" value={n(h.current.regularAttenders)} {...kpi((x) => x.regularAttenders)} note={`Came ${latest.regularWeeks}+ of the last 8 weeks`} />
        <KpiCard label="Net growth" value={`${h.current.netGrowth > 0 ? '+' : ''}${h.current.netGrowth}`} tone={h.current.netGrowth >= 0 ? 'ok' : 'warn'}
          note={`${s.netGrowth.gained} joined, ${s.netGrowth.lost} stopped coming`} spark={series((x) => x.netGrowth).map((v) => v ?? 0)} />
        <KpiCard label="Visitors who came back" value={pct(h.current.returnRate)} {...kpi((x) => x.returnRate)} />
        <KpiCard label="Follow-ups overdue" value={String(s.overdueFollowUps)} tone={s.overdueFollowUps ? 'warn' : 'ok'} note="When the report was made" to="/follow-ups" />
      </KpiRow>

      <div className="dash-grid">
        <Panel title="Service attendance each week" wide>
          <LineChart label={`Weekly service attendance for the last ${shown.length} weeks, beside the same weeks last year`} labels={labels}
            series={[{ name: 'This year', values: series((x) => x.attendance) }, { name: 'Same week last year', values: shown.map((r) => r.headlines.lastYear.attendance), dashed: true }]} />
        </Panel>

        <Panel title="First-time visitors">
          <ColumnChart label="First-time visitors each week" rows={shown.map((r, i) => ({ label: labels[i]!, value: r.headlines.current.visitors }))} />
        </Panel>

        <Panel title="Salvations and baptisms">
          <LineChart label="Salvations and baptisms each week" labels={labels} height={180}
            series={[{ name: 'Salvations', values: series((x) => x.salvations) }, { name: 'Baptisms', values: series((x) => x.baptisms) }]} />
        </Panel>

        <Panel title="Who came">
          <Donut label="Attendance by age group" rows={[{ label: 'Adults', value: s.attendance.adults }, { label: 'Teens', value: s.attendance.teens }, { label: 'Children', value: s.attendance.children }]}
            center={s.attendance.total.toLocaleString('en-GB')} centerNote={s.attendance.weeks > 1 ? `in ${s.attendance.weeks} weeks` : 'this week'} />
        </Panel>

        <Panel title="Staying connected">
          <div className="gauges">
            <Gauge value={h.current.groupParticipation ?? 0} max={100} label="In a Freedom Group" display={pct(h.current.groupParticipation)} />
            <Gauge value={h.current.servingRate ?? 0} max={100} label="Serving" display={pct(h.current.servingRate)} />
            <Gauge value={h.current.returnRate ?? 0} max={100} label="Visitors back" display={pct(h.current.returnRate)} />
            <Gauge value={h.current.followUpSpeed ?? 0} max={100} label="Followed up in 48h" display={pct(h.current.followUpSpeed)} />
          </div>
        </Panel>

        <Panel title="The journey" wide>
          <Funnel label="People who completed each step" steps={latest.funnel} />
          <p className="muted small">Everyone who has completed each step so far. Some people join at a later step, so a step can be bigger than the one before.</p>
        </Panel>
      </div>
    </div>
  );
}
