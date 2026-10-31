import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { requestSchoolReport } from '../../lib/schoolWrites';
import { schoolReportPdf } from '../../lib/schoolPdf';
import { shareOrDownload } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { lastCompletePeriod, periodFor, periodLabel, type ReportType } from '../../../functions/src/shared/metrics';
import type { SchoolReportDoc } from '../../../functions/src/shared/school';
import type { StoredSchoolReport } from '../../state/useSchool';
import { SchoolGate, SchoolTitle, money, pct, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function SchoolReportsPage() {
  return <SchoolGate title="School reports">{(org) => <Reports org={org} />}</SchoolGate>;
}

function Reports({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { user, can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const openId = params.get('report') ?? '';
  const allowed = can('finance.reports') || can('settings.manage');
  const { rows, loading } = useLiveQuery<StoredSchoolReport & SchoolReportDoc>(
    () => (allowed ? query(collection(db, 'organizations', org.id, 'schoolReports'), orderBy('from', 'desc')) : null), [org.id, allowed]);
  const [type, setType] = useState<ReportType>('weekly');
  const [day, setDay] = useState(() => lastCompletePeriod('weekly', s.today).from);
  const [month, setMonth] = useState(() => lastCompletePeriod('monthly', s.today).from.slice(0, 7));
  const [requestId, setRequestId] = useState<string | null>(null);
  const period = type === 'weekly' ? periodFor('weekly', day || s.today) : periodFor('monthly', `${month || s.today.slice(0, 7)}-01`);

  useEffect(() => {
    if (!requestId) return;
    return onSnapshot(doc(db, 'organizations', org.id, 'schoolReportRequests', requestId), (snap) => {
      const d = snap.data();
      if (!d || d.status === 'pending') return;
      setRequestId(null);
      if (d.status === 'done' && d.reportId) setParams({ report: d.reportId as string });
      else toast.show((d.error as string) ?? 'The report could not be made.');
    });
  }, [requestId, org.id, setParams, toast]);

  if (!allowed) return <div className="page narrow"><h1>School reports</h1><p>Reports are for the Director and the people the Director has given access.</p></div>;
  // The chosen report, or else the newest one, shows straight away (Andy, 2026-10-28, 7A).
  const open = rows.find((r) => r.id === openId) ?? rows[0];

  return (
    <div className="page narrow">
      <SchoolTitle feesAllowed={s.feesAllowed} />
      {loading ? <p className="muted">Loading…</p> : open ? <ReportView org={org} report={open} /> : <div className="card"><p>No reports yet. The first weekly report comes on Monday morning.</p></div>}

      <details className="card fold-card">
        <summary><span>Make a report</span></summary>
        <div className="stack">
          <p className="small muted">Weekly reports come every Monday and monthly ones on the 1st on their own.</p>
          <div className="segmented" role="radiogroup" aria-label="Report">
            {(['weekly', 'monthly'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} className={`chip${type === t ? ' chip-on' : ''}`} onClick={() => setType(t)}>{t === 'weekly' ? 'Week' : 'Month'}</button>
            ))}
          </div>
          {type === 'weekly'
            ? <label className="field"><span>Any day in the week</span><input type="date" value={day} max={s.today} onChange={(e) => setDay(e.target.value)} /></label>
            : <label className="field"><span>Month</span><input type="month" value={month} max={s.today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label>}
          <p className="small">{periodLabel(type, period)}</p>
          <button type="button" className="btn btn-primary align-start" disabled={!!requestId || period.from > s.today || !user}
            onClick={() => user && setRequestId(requestSchoolReport(org.id, user.uid, type, period.from))}>
            {requestId ? 'Making the report…' : 'Make the report'}
          </button>
        </div>
      </details>

      {rows.length > 1 && (
        <details className="card fold-card">
          <summary><span>Earlier reports</span><span className="muted small">{rows.length}</span></summary>
          <ul className="link-list">
            {rows.map((r) => (
              <li key={r.id}><Link to={`/school/reports?report=${r.id}`}><span className="link-title">{r.label}{r.id === open?.id ? ' (showing)' : ''}</span><span className="link-detail">{r.type === 'weekly' ? 'Weekly' : 'Monthly'} · {r.metrics.enrolled} enrolled · attendance {pct(r.metrics.attendanceRate)}</span></Link></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReportView({ org, report }: { org: Organization; report: SchoolReportDoc & StoredSchoolReport }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = report.metrics;
  async function pdf() {
    setBusy(true);
    try {
      await shareOrDownload(await schoolReportPdf(org, report), `${org.name} school report`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  const rows: [string, string][] = [
    ['Students enrolled', String(m.enrolled)], ['Withdrawn', String(m.withdrawn)], ['Retention', pct(m.retentionRate)],
    ['Attendance rate', pct(m.attendanceRate)], ['Below the attendance threshold', String(m.belowThreshold)], ['Pass rate', pct(m.passRate)],
    ['Fees billed', money(org, m.billedCents)], ['Fees paid', money(org, m.paidCents)], ['Arrears', money(org, m.arrearsCents)],
    ['Fee collection rate', pct(m.collectionRate)], ['Graduation rate', pct(m.graduationRate)], ['Graduates working at 6 months', pct(m.employmentRate)],
  ];
  return (
    <section className="card stack">
      <div className="card-head"><h2>{report.label}</h2><button type="button" className="btn" disabled={busy} onClick={() => void pdf()}>{busy ? 'Making…' : 'PDF'}</button></div>
      <table className="report-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
      <h3>By department</h3>
      <table className="report-table">
        <thead><tr><th>Department</th><th className="num">Students</th><th className="num">Trainers</th><th className="num">Per trainer</th></tr></thead>
        <tbody>{m.byCourse.map((c) => <tr key={c.courseId}><td>{c.name}</td><td className="num">{c.enrolled}</td><td className="num">{c.trainers}</td><td className="num">{c.ratio ?? '–'}</td></tr>)}</tbody>
      </table>
      <h3>Attendance alerts</h3>
      {report.alerts.length === 0 ? <p className="muted small">Nobody is below the threshold.</p> : <ul className="link-list">{report.alerts.map((a) => <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{a.name}</span><span className="link-detail">{a.course} · {a.percent}% of {a.held} classes</span></Link></li>)}</ul>}
      <h3>Fee arrears</h3>
      {report.arrears.length === 0 ? <p className="muted small">No fees are owed.</p> : <ul className="link-list">{report.arrears.map((a) => <li key={a.studentId}><Link to={`/school/students/${a.studentId}`}><span className="link-title">{a.name}</span><span className="link-detail">{a.course} · {money(org, a.balanceCents)}{a.overdue ? ' · overdue' : ''}</span></Link></li>)}</ul>}
      {report.outcomesDue.length > 0 && (
        <>
          <h3>Graduate follow-ups due</h3>
          <ul className="link-list">{report.outcomesDue.map((o) => <li key={`${o.studentId}${o.months}`}><div><span className="link-title">{o.name}</span><span className="link-detail">{o.months} months · due {formatDateKey(o.due)}</span></div></li>)}</ul>
        </>
      )}
    </section>
  );
}
