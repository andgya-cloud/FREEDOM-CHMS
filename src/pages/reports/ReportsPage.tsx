import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WeeklyDashboard } from './DashboardPage';
import { GivingFigures } from '../giving/GivingDashboardPage';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { OrgGate } from '../../components/OrgGate';
import { Bars } from '../../components/Scorecard';
import { requestReport, useLatestReport, useReportRequest, useReports, useReportSettings, type StoredReport } from '../../state/useReports';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { lastCompletePeriod, periodFor, periodLabel, type ReportType } from '../../../functions/src/shared/metrics';

/**
 * Reports, one page with three tabs (Andy, 2026-10-31, 4A): Weekly (the week-by-week dashboard, making a report,
 * the weekly archive), Monthly (the monthly reports) and Giving (the giving dashboard and the monthly summary).
 */
export function ReportsPage() {
  return <OrgGate title="Reports">{(org) => <Archive org={org} />}</OrgGate>;
}

type Tab = 'weekly' | 'monthly' | 'giving';

function Archive({ org }: { org: Organization }) {
  const { can } = useAuth();
  const { reports, loading, error } = useReports(org.id);
  const [params, setParams] = useSearchParams();
  const givingTab = can('finance.reports');
  const asked = params.get('tab');
  const tab: Tab = asked === 'monthly' || (asked === 'giving' && givingTab) ? asked : 'weekly';
  const pick = (t: Tab) => setParams(t === 'weekly' ? {} : { tab: t }, { replace: true });
  const shown = tab === 'giving' ? [] : reports.filter((r) => r.type === tab);
  const tabs: { id: Tab; label: string }[] = [{ id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, ...(givingTab ? [{ id: 'giving' as const, label: 'Giving' }] : [])];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        {can('settings.manage') && <Link to="/settings/reports" className="btn btn-quiet">Report settings</Link>}
      </div>
      <div className="segmented" role="tablist" aria-label="Reports">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' chip-on' : ''}`} onClick={() => pick(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'giving' ? (
        <>
          <GivingFigures org={org} />
          <ul className="link-list narrow-block">
            <li>
              <Link to="/giving/summary">
                <span className="link-title">Monthly summary</span>
                <span className="link-detail">Fund ledger, and the check against the Paybill statement</span>
              </Link>
            </li>
          </ul>
        </>
      ) : (
        <>
          {tab === 'weekly' && <WeeklyDashboard org={org} />}
          {tab === 'weekly' && <CampusComparison />}
          <div className="narrow-block stack">
            <MakeReport key={tab} org={org} type={tab} />
            <h2>{tab === 'weekly' ? 'Weekly reports' : 'Monthly reports'}</h2>
            {error ? <p className="error">The reports could not be loaded ({error}).</p>
              : loading ? <p className="muted">Loading…</p>
              : shown.length === 0 ? <div className="card"><p>{tab === 'weekly' ? 'No weekly reports yet. Make one above, or wait for Monday morning at 07:00.' : 'No monthly reports yet. Make one above, or wait for the 1st of the month at 07:00.'}</p></div>
              : (
                <ul className="link-list">
                  {shown.map((r) => (
                    <li key={r.id}>
                      <Link to={`/reports/${org.id}/${r.id}`}>
                        <span className="link-title">{r.label}</span>
                        <span className="link-detail">{summary(r)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </>
      )}
    </div>
  );
}

function summary(r: StoredReport) {
  const h = r.headlines.current;
  return `${r.type === 'weekly' ? 'Weekly' : 'Monthly'} · attendance ${h.attendance ?? '–'} · ${h.visitors} visitors · ${h.salvations} salvations`;
}

function MakeReport({ org, type }: { org: Organization; type: ReportType }) {
  const { user, can } = useAuth();
  const { settings } = useReportSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localDateKey(new Date(), org.timeZone);
  const [day, setDay] = useState(() => lastCompletePeriod('weekly', today).from);
  const [month, setMonth] = useState(() => lastCompletePeriod('monthly', today).from.slice(0, 7));
  const [email, setEmail] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const req = useReportRequest(org.id, requestId);
  const period = type === 'weekly' ? periodFor('weekly', day || today) : periodFor('monthly', `${month || today.slice(0, 7)}-01`);
  const future = period.from > today;

  useEffect(() => {
    if (!req || req.id !== requestId || req.status === 'pending') return;
    setRequestId(null);
    if (req.status === 'done' && req.reportId) navigate(`/reports/${org.id}/${req.reportId}`);
    else toast.show(req.error ?? 'The report could not be made.');
  }, [req, requestId, navigate, org.id, toast]);

  function make() {
    if (!user || future) return;
    setRequestId(requestReport(org.id, user.uid, type, period.from, email));
  }

  return (
    <section className="card stack">
      <h2>Make a report</h2>
      <p className="small muted">{type === 'weekly' ? 'For any past week' : 'For any past month'}. Making one again brings it up to date with records added since.</p>
      {type === 'weekly' ? (
        <label className="field"><span>Any day in the week</span><input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
      ) : (
        <label className="field"><span>Month</span><input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label>
      )}
      <p className="small">{periodLabel(type, period)}{period.to >= today && !future ? ' (so far)' : ''}</p>
      {can('settings.manage') && settings.emailEnabled && (
        <label className="check"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email it too</label>
      )}
      {future && <p className="notice notice-warn small">That period hasn't started yet.</p>}
      <button type="button" className="btn btn-primary align-start" disabled={!!requestId || future} onClick={make}>
        {requestId ? 'Making the report…' : 'Make the report'}
      </button>
    </section>
  );
}

/** Campuses side by side, from each one's latest weekly report. Only for staff who see every campus. */
function CampusComparison() {
  const { profile } = useAuth();
  const { organizations } = useOrg();
  const campuses = organizations.filter((o) => o.type === 'church_campus' && o.active !== false && !o.training);
  const [latest, setLatest] = useState<Record<string, StoredReport | null>>({});
  const onReport = useCallback((orgId: string, r: StoredReport | null) => setLatest((m) => (m[orgId] === r ? m : { ...m, [orgId]: r })), []);
  if (!profile?.allOrgs || campuses.length < 2) return null;
  const rows = campuses.map((c) => ({ org: c, r: latest[c.id] ?? null }));
  return (
    <section className="card stack">
      <h2>Campuses compared</h2>
      <p className="small muted">From each campus's latest weekly report.</p>
      {campuses.map((c) => <LatestFor key={c.id} orgId={c.id} onReport={onReport} />)}
      <h3>Weekly attendance</h3>
      <Bars rows={rows.map(({ org, r }) => ({ label: org.name, value: r?.headlines.current.attendance ?? 0, note: r ? '' : '(no report yet)' }))} />
      <div className="table-scroll">
        <table className="report-table">
          <thead><tr><th>Campus</th><th className="num">Visitors</th><th className="num">Salvations</th><th className="num">Baptisms</th><th className="num">In a group</th><th className="num">Serving</th></tr></thead>
          <tbody>
            {rows.map(({ org, r }) => (
              <tr key={org.id}>
                <td>{r ? <Link to={`/reports/${org.id}/${r.id}`}>{org.name}</Link> : org.name}</td>
                <td className="num">{r?.headlines.current.visitors ?? '–'}</td>
                <td className="num">{r?.headlines.current.salvations ?? '–'}</td>
                <td className="num">{r?.headlines.current.baptisms ?? '–'}</td>
                <td className="num">{r?.headlines.current.groupParticipation != null ? `${r.headlines.current.groupParticipation}%` : '–'}</td>
                <td className="num">{r?.headlines.current.servingRate != null ? `${r.headlines.current.servingRate}%` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LatestFor({ orgId, onReport }: { orgId: string; onReport: (orgId: string, r: StoredReport | null) => void }) {
  const { report, loading } = useLatestReport(orgId);
  useEffect(() => { if (!loading) onReport(orgId, report); }, [orgId, report, loading, onReport]);
  return null;
}
