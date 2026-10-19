import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { requestHopeReport } from '../../lib/hopeWrites';
import { hopeReportPdf } from '../../lib/hopePdf';
import { shareOrDownload } from '../../lib/givingPdf';
import { lastCompletePeriod, periodFor, periodLabel, type ReportType } from '../../../functions/src/shared/metrics';
import type { HopeReportDoc } from '../../../functions/src/shared/hope';
import type { StoredHopeReport } from '../../state/useHope';
import { HopeGate, HopeNav, pct, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeReportsPage() {
  return <HopeGate title="Hope Center reports">{(org) => <Reports org={org} />}</HopeGate>;
}

function Reports({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { user, can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const openId = params.get('report') ?? '';
  const pastor = can('pastoral.read');
  // Staff other than the pastor may only ask for the counts-only reports, so that is the only list the server allows them.
  const { rows: found, loading } = useLiveQuery<StoredHopeReport & HopeReportDoc>(
    () => {
      if (!can('people.read')) return null;
      const reports = collection(db, 'organizations', org.id, 'hopeReports');
      return pastor ? query(reports, orderBy('from', 'desc')) : query(reports, where('audience', '==', 'counts'));
    }, [org.id, pastor]);
  const rows = [...found].sort((a, b) => b.from.localeCompare(a.from));
  // Staff who cannot open the weekly report (it has names) are only offered the monthly one.
  const [type, setType] = useState<ReportType>(pastor ? 'weekly' : 'monthly');
  const [day, setDay] = useState(() => lastCompletePeriod('weekly', h.today).from);
  const [month, setMonth] = useState(() => lastCompletePeriod('monthly', h.today).from.slice(0, 7));
  const [requestId, setRequestId] = useState<string | null>(null);
  const period = type === 'weekly' ? periodFor('weekly', day || h.today) : periodFor('monthly', `${month || h.today.slice(0, 7)}-01`);

  useEffect(() => {
    if (!requestId) return;
    return onSnapshot(doc(db, 'organizations', org.id, 'hopeReportRequests', requestId), (snap) => {
      const d = snap.data();
      if (!d || d.status === 'pending') return;
      setRequestId(null);
      if (d.status === 'done' && d.reportId) setParams({ report: d.reportId as string });
      else toast.show((d.error as string) ?? 'The report could not be made.');
    });
  }, [requestId, org.id, setParams, toast]);

  const open = rows.find((r) => r.id === openId);
  return (
    <div className="page narrow">
      <h1>Hope Center reports</h1>
      <HopeNav />
      <p className="small muted">The monthly report (counts and trends only, no names) is made on the 1st for leadership and donors. The weekly attendance and follow-up report is for the pastor and lists children by code and name.</p>
      <section className="card stack">
        <h2>Make a report</h2>
        <div className="segmented" role="radiogroup" aria-label="Report">
          {(pastor ? ['weekly', 'monthly'] as const : ['monthly'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className={`chip${type === t ? ' chip-on' : ''}`} onClick={() => setType(t)}>{t === 'weekly' ? 'Week (pastor)' : 'Month (counts only)'}</button>
          ))}
        </div>
        {type === 'weekly'
          ? <label className="field"><span>Any day in the week</span><input type="date" value={day} max={h.today} onChange={(e) => setDay(e.target.value)} /></label>
          : <label className="field"><span>Month</span><input type="month" value={month} max={h.today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label>}
        <p className="small">{periodLabel(type, period)}</p>
        <button type="button" className="btn btn-primary align-start" disabled={!!requestId || period.from > h.today || !user}
          onClick={() => { try { setRequestId(requestHopeReport(org.id, type, period.from)); } catch (err) { toast.show(friendlyError(err)); } }}>
          {requestId ? 'Making the report…' : 'Make the report'}
        </button>
      </section>

      {open && <ReportView org={org} report={open} />}

      <h2>Archive</h2>
      {loading ? <p className="muted">Loading…</p> : rows.filter((r) => r.audience === 'counts' || pastor).length === 0 ? <div className="card"><p>No reports yet.</p></div> : (
        <ul className="link-list">
          {rows.filter((r) => r.audience === 'counts' || pastor).map((r) => (
            <li key={r.id}><Link to={`/hope/reports?report=${r.id}`}><span className="link-title">{r.label}</span><span className="link-detail">{r.type === 'weekly' ? 'Weekly, for the pastor' : 'Monthly, counts only'} · {r.metrics.active} active children</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportView({ org, report }: { org: Organization; report: HopeReportDoc & StoredHopeReport }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = report.metrics;
  async function pdf() {
    setBusy(true);
    try { await shareOrDownload(await hopeReportPdf(org, report), `${org.name} report`); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  const rows: [string, string][] = [
    ['Children registered', String(m.registered)], ['Children active', String(m.active)], ['Came in the last 8 weeks', String(m.attendingLast8Weeks)],
    ['Newly registered', String(m.newlyRegistered)], ['Attending regularly', pct(m.consistencyRate)], ['Still here after 6 months', pct(m.retentionRate)],
    ['In one programme', String(m.reachOne)], ['In two or more', String(m.reachTwoPlus)], ['In school (of those known)', pct(m.schoolEnrolmentRate)],
    ['Guardians reached after absences', pct(m.guardianContactRate)], ['Consent missing', String(m.consentMissing)],
    ['Meals served', String(m.meals.total)], ['Average meals per Saturday', String(m.meals.averagePerSession ?? '–')],
  ];
  return (
    <section className="card stack">
      <div className="card-head"><h2>{report.label}</h2><button type="button" className="btn" disabled={busy} onClick={() => void pdf()}>{busy ? 'Making…' : 'PDF'}</button></div>
      <table className="report-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
      <h3>By programme</h3>
      <table className="report-table">
        <thead><tr><th>Programme</th><th className="num">Children</th><th className="num">Sessions</th><th className="num">Average</th></tr></thead>
        <tbody>{m.byProgramme.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{p.children}</td><td className="num">{p.sessions}</td><td className="num">{p.averageAttendance ?? '–'}</td></tr>)}</tbody>
      </table>
      {report.audience === 'pastor' && (
        <>
          <h3>Guardians to call</h3>
          {(report.followUps ?? []).length === 0 ? <p className="muted small">No follow-ups are open.</p> : (
            <ul className="link-list">{report.followUps!.map((f) => <li key={`${f.code}${f.programme}`}><div><span className="link-title">{f.code} {f.name}</span><span className="link-detail">{f.programme} · missed since {f.since}</span></div></li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
