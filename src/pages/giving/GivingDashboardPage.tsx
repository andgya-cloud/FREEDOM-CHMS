import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { useFunds, useLedgerMonths, type LedgerMonth } from '../../state/useGiving';
import { OrgGate } from '../../components/OrgGate';
import { ColumnChart, Donut, Gauge, KpiCard, KpiRow, LineChart, Panel } from '../../components/charts';
import { addMonths, compact, monthsEnding, pctChange, shortMonth } from '../../lib/analytics';
import { formatMoney, GIFT_METHOD_LABELS, GIFT_METHODS } from '../../../functions/src/shared/giving';
import { localDateKey } from '../../../functions/src/shared/datetime';

/**
 * The giving dashboard: the month's KPIs against last month and last year,
 * twelve months of giving beside the twelve before, where it went by fund and
 * how it came in by method, and the year so far against all of last year.
 * Built from the monthly ledger only, so it shows totals and never a giver.
 */
export function GivingDashboardPage() {
  return <OrgGate title="Giving dashboard">{(org) => <Dashboard org={org} />}</OrgGate>;
}

type Scope = 'month' | 'year';

function Dashboard({ org }: { org: Organization }) {
  const [month, setMonth] = useState(localDateKey(new Date(), org.timeZone).slice(0, 7));
  const [scope, setScope] = useState<Scope>('month');
  const from = addMonths(month, -23);
  // 24 months always reach back to January of last year, which the year gauge needs.
  const { months, loading } = useLedgerMonths(org.id, from, month);
  const { funds } = useFunds(org.id);
  const currency = org.currency || 'KES';
  const kes = (c: number) => formatMoney(Math.round(c / 100) * 100, currency).replace(/\.00$/, '');

  const byMonth = useMemo(() => new Map(months.map((m) => [m.id, m])), [months]);
  const total = (m: string) => byMonth.get(m)?.totalCents ?? 0;
  const count = (m: string) => byMonth.get(m)?.count ?? 0;
  const has = (m: string) => byMonth.has(m);

  const last12 = monthsEnding(month, 12);
  const prev12 = monthsEnding(addMonths(month, -12), 12);
  const lastMonth = addMonths(month, -1);
  const lastYear = addMonths(month, -12);
  const year = month.slice(0, 4);
  const ytd = last12.filter((m) => m.startsWith(year));
  const ytdPrev = ytd.map((m) => addMonths(m, -12));
  const sum = (ms: string[], f: (m: string) => number) => ms.reduce((s, m) => s + f(m), 0);
  const ytdTotal = sum(ytd, total);
  const ytdPrevTotal = sum(ytdPrev, total);
  const lastYearAll = sum(monthsEnding(`${Number(year) - 1}-12`, 12), total);
  const avg = (m: string) => (count(m) ? total(m) / count(m) : 0);
  const mpesaShare = (ms: string[]) => {
    const all = sum(ms, total);
    return all ? sum(ms, (m) => byMonth.get(m)?.methods?.mpesa?.cents ?? 0) / all : 0;
  };

  const scopeMonths = scope === 'month' ? [month] : ytd;
  const fundName = (id: string) => (id === 'none' ? 'No fund' : funds.find((f) => f.id === id)?.name ?? id);
  const fundTotals = new Map<string, number>();
  const methodTotals = new Map<string, number>();
  for (const m of scopeMonths) {
    const l: LedgerMonth | undefined = byMonth.get(m);
    for (const [id, t] of Object.entries(l?.funds ?? {})) fundTotals.set(id, (fundTotals.get(id) ?? 0) + t.cents);
    for (const k of GIFT_METHODS) methodTotals.set(k, (methodTotals.get(k) ?? 0) + (l?.methods?.[k]?.cents ?? 0));
  }
  const fundRows = [...fundTotals].map(([id, v]) => ({ id, label: fundName(id), value: v })).sort((a, b) => b.value - a.value);
  const scopeTotal = sum(scopeMonths, total);

  // How each fund did this month against the same month last year.
  const fundIds = new Set([...Object.keys(byMonth.get(month)?.funds ?? {}), ...Object.keys(byMonth.get(lastYear)?.funds ?? {})]);
  const fundCompare = [...fundIds].map((id) => {
    const now = byMonth.get(month)?.funds?.[id]?.cents ?? 0;
    const before = byMonth.get(lastYear)?.funds?.[id]?.cents ?? 0;
    return { id, name: fundName(id), now, before, change: pctChange(now, before) };
  }).sort((a, b) => b.now - a.now);

  const ytdVsLastYear = lastYearAll ? ytdTotal / lastYearAll : 0;
  const spark = last12.map(total);

  return (
    <div className="page dash">
      <p className="no-print"><Link to="/giving">← Giving</Link></p>
      <div className="page-head">
        <h1>Giving dashboard</h1>
        <button type="button" className="btn btn-quiet no-print" onClick={() => window.print()}>Print</button>
      </div>
      <p className="lead">{org.name} · {shortMonth(month, true)}</p>
      <div className="dash-controls no-print">
        <label className="field">
          <span>Month</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          <KpiRow label="Giving at a glance">
            <KpiCard label={`Given in ${shortMonth(month)}`} value={kes(total(month))} tone="gold" spark={spark}
              changes={[{ now: total(month), before: has(lastMonth) ? total(lastMonth) : null, since: shortMonth(lastMonth) }, { now: total(month), before: has(lastYear) ? total(lastYear) : null, since: shortMonth(lastYear, true) }]}
              to="/giving/summary" />
            <KpiCard label={`Year to date ${year}`} value={kes(ytdTotal)}
              changes={[{ now: ytdTotal, before: ytdPrevTotal || null, since: `the same months of ${Number(year) - 1}` }]} />
            <KpiCard label="Gifts this month" value={count(month).toLocaleString('en-GB')} spark={last12.map(count)}
              changes={[{ now: count(month), before: has(lastMonth) ? count(lastMonth) : null, since: shortMonth(lastMonth) }]} />
            <KpiCard label="Average gift" value={kes(avg(month))} spark={last12.map(avg)}
              changes={[{ now: avg(month), before: has(lastMonth) ? avg(lastMonth) : null, since: shortMonth(lastMonth) }]} />
          </KpiRow>

          <div className="dash-grid">
            <Panel title="Twelve months of giving" wide>
              <LineChart
                label={`Giving each month, ${shortMonth(last12[0]!, true)} to ${shortMonth(month, true)}, beside the year before`}
                labels={last12.map((m) => shortMonth(m))}
                series={[
                  { name: `To ${shortMonth(month, true)}`, values: last12.map((m) => (has(m) ? total(m) / 100 : 0)) },
                  { name: 'The year before', values: prev12.map((m) => (has(m) ? total(m) / 100 : null)), dashed: true },
                ]}
                format={(v) => kes(v * 100)}
              />
            </Panel>

            <Panel title="By fund" action={
              <div className="segmented no-print" role="group" aria-label="Period">
                <button type="button" className={scope === 'month' ? 'on' : ''} onClick={() => setScope('month')}>Month</button>
                <button type="button" className={scope === 'year' ? 'on' : ''} onClick={() => setScope('year')}>Year</button>
              </div>
            }>
              <Donut label="Giving by fund" rows={fundRows} format={kes} center={`${currency} ${compact(scopeTotal / 100)}`} centerNote={scope === 'month' ? shortMonth(month) : `${year} so far`} />
            </Panel>

            <Panel title="How it came in">
              <ColumnChart label="Giving by method" rows={GIFT_METHODS.map((k) => ({ label: GIFT_METHOD_LABELS[k], value: (methodTotals.get(k) ?? 0) / 100 }))}
                format={(v) => kes(v * 100)} highlight={0} height={170} />
              <p className="muted small">{Math.round(mpesaShare(scopeMonths) * 100)}% came through M-Pesa {scope === 'month' ? `in ${shortMonth(month)}` : `in ${year} so far`}.</p>
            </Panel>

            <Panel title="Year so far against last year">
              <Gauge value={ytdTotal} max={lastYearAll} label={`${year} so far`} display={lastYearAll ? `${Math.round(ytdVsLastYear * 100)}%` : '–'}
                caption={lastYearAll ? `of all of ${Number(year) - 1} (${kes(lastYearAll)})` : `No giving recorded for ${Number(year) - 1}`} />
              <p className="muted small">Ahead of the pace to match last year when this is above {Math.round((ytd.length / 12) * 100)}%.</p>
            </Panel>

            <Panel title={`Funds in ${shortMonth(month)} against ${shortMonth(lastYear, true)}`}>
              {fundCompare.length === 0 ? <p className="muted">No giving recorded yet.</p> : (
                <table className="table">
                  <thead><tr><th>Fund</th><th className="num">{shortMonth(month)} ({currency})</th><th className="num">A year ago</th><th className="num">Change</th></tr></thead>
                  <tbody>
                    {fundCompare.map((f) => (
                      <tr key={f.id}>
                        <td>{f.name}</td>
                        <td className="num">{Math.round(f.now / 100).toLocaleString('en-GB')}</td>
                        <td className="num">{Math.round(f.before / 100).toLocaleString('en-GB')}</td>
                        <td className={`num ${f.change == null ? 'muted' : f.change >= 0 ? 'up-good' : 'up-bad'}`}>{f.change == null ? 'New' : `${f.change > 0 ? '+' : ''}${f.change}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
          <p className="muted small">Totals are confirmed gifts from the fund ledger. Void gifts and payments still in Unassigned are not counted.</p>
        </>
      )}
    </div>
  );
}
