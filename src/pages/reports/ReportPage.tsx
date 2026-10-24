import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { requestReport, useReport, useReportPart, useReportRequest } from '../../state/useReports';
import { Bars, Scorecard, TrendChart } from '../../components/Scorecard';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { formatMoney } from '../../../functions/src/shared/giving';
import { dueText, reasonLabel, reportCsv, reportFileName, reportPdf, type GivingPart, type PastoralPart } from '../../../functions/src/shared/reports';
import { stampPoweredBy } from '../../../functions/src/shared/poweredBy';

const day = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);

/** One weekly or monthly report: the scorecard, what changed, and the people behind the numbers. */
export function ReportPage() {
  const { orgId = '', reportId = '' } = useParams();
  const { can, user } = useAuth();
  const { organizations } = useOrg();
  const toast = useToast();
  const location = useLocation();
  const { report, loading, error } = useReport(orgId, reportId);
  const version = report?.generatedAt?.toMillis();
  const pastoral = useReportPart<PastoralPart>(orgId, reportId, 'pastoral', can('pastoral.read'), version);
  const giving = useReportPart<GivingPart>(orgId, reportId, 'giving', can('finance.reports'), version);
  const [requestId, setRequestId] = useState<string | null>(null);
  const req = useReportRequest(orgId, requestId);
  const org = organizations.find((o) => o.id === orgId);

  // Tiles link to a section of this page.
  useEffect(() => {
    if (!report || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [report, location.hash]);

  useEffect(() => {
    if (!req || req.id !== requestId || req.status === 'pending') return;
    toast.show(req.status === 'done' ? 'Report remade with the latest records' : req.error ?? 'The report could not be made.');
    setRequestId(null);
  }, [req, requestId, toast]);

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;
  if (error || !report) {
    return (
      <div className="page narrow">
        <p><Link to="/reports">← Reports</Link></p>
        <h1>Report not found</h1>
        <p className="muted">{error ? `It could not be opened (${error}).` : 'This report hasn\'t been made yet.'}</p>
      </div>
    );
  }

  const s = report.scorecard;
  const since = report.type === 'weekly' ? 'Last week' : 'Last month';
  const money = (c: number | null | undefined) => (c == null || !giving ? '–' : formatMoney(c, giving.currency));

  async function pdfFile() {
    const { jsPDF } = await import('jspdf');
    const pdf = reportPdf(jsPDF, report!, pastoral, giving);
    stampPoweredBy(pdf);
    return new File([pdf.output('blob')], reportFileName(report!, 'pdf'), { type: 'application/pdf' });
  }
  async function sharePdf() {
    try {
      const how = await shareOrDownload(await pdfFile(), `${report!.orgName}: ${report!.label}`);
      if (how === 'downloaded') toast.show('PDF downloaded');
    } catch { toast.show('The PDF could not be made. Please try again.'); }
  }
  function csv() {
    const text = reportCsv(report!, pastoral, giving);
    // A byte-order mark so Excel reads names with accents correctly.
    downloadFile(new File(['﻿', text], reportFileName(report!, 'csv'), { type: 'text/csv' }));
  }
  function remake() {
    if (!user) return;
    setRequestId(requestReport(orgId, user.uid, report!.type, report!.from));
    toast.show('Remaking the report…');
  }

  return (
    <div className="page">
      <p><Link to="/reports">← Reports</Link></p>
      <div className="page-head">
        <div>
          <h1>{report.label}</h1>
          <p className="lead">{report.orgName} · {report.type === 'weekly' ? 'Weekly report' : 'Monthly report'}</p>
        </div>
      </div>
      <p className="muted small">
        Made {report.generatedAt ? report.generatedAt.toDate().toLocaleString('en-GB', { timeZone: org?.timeZone ?? 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }) : 'just now'}
        {report.generatedBy === 'system' ? ' automatically' : ' by hand'}
        {report.emailedTo ? `, emailed to ${report.emailedTo}` : ''}.
        {!giving && can('people.read') && ' Giving is shown only to staff with finance reports.'}
      </p>
      <div className="chips">
        <button type="button" className="btn btn-primary" onClick={() => void sharePdf()}>PDF</button>
        <button type="button" className="btn" onClick={csv}>Excel (CSV)</button>
        <button type="button" className="btn btn-quiet" disabled={!!requestId} onClick={remake}>{requestId ? 'Remaking…' : 'Remake with the latest records'}</button>
      </div>

      <Scorecard report={report} giving={giving} base={location.pathname} />

      <section className="card stack report-section">
        <h2>The biggest changes</h2>
        {report.changes.length === 0 ? <p className="muted">No big changes on {since.toLowerCase()}.</p>
          : <ul>{report.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
      </section>

      <section id="attendance" className="card stack report-section">
        <h2>Attendance</h2>
        <table className="report-table">
          <tbody>
            <tr><td>Total at services</td><td className="num">{s.attendance.total}</td></tr>
            <tr><td>Adults / teens / children</td><td className="num">{s.attendance.adults} / {s.attendance.teens} / {s.attendance.children}</td></tr>
            <tr><td>Weekly average</td><td className="num">{s.attendance.weeklyAverage ?? '–'}</td></tr>
            <tr><td>4-week average</td><td className="num">{s.averageAttendance.fourWeeks ?? '–'}</td></tr>
            <tr><td>Year-to-date average</td><td className="num">{s.averageAttendance.yearToDate ?? '–'}</td></tr>
            <tr><td>Regular attenders ({report.regularWeeks} or more of the last 8 weeks)</td><td className="num">{s.regularAttenders}</td></tr>
            <tr><td>Net growth in regular attenders</td><td className="num">{s.netGrowth.net > 0 ? '+' : ''}{s.netGrowth.net} ({s.netGrowth.gained} new, {s.netGrowth.lost} dropped below)</td></tr>
          </tbody>
        </table>
        <TrendChart points={report.trend} label={`Service attendance, the last ${report.trend.length} weeks`} />
        <p className="small muted">A service counts its headcount; a service with no headcount counts the people checked in.</p>
      </section>

      <section id="visitors" className="card stack report-section">
        <h2>First-time visitors ({report.visitors.length})</h2>
        <p className="small">
          Came back within 4 weeks: <strong>{pct(s.returnRate.rate)}</strong> ({s.returnRate.returned} of {s.returnRate.cohort} who first came {day(s.returnRate.from)} to {day(s.returnRate.to)}).
          {' '}Contacted within 48 hours: <strong>{pct(s.followUpSpeed.rate)}</strong> ({s.followUpSpeed.within48h} of {s.followUpSpeed.visitors}).
        </p>
        <PeopleList orgId={orgId} rows={report.visitors.map((v) => ({ personId: v.personId, name: v.name, detail: day(v.date) }))} empty="No first-time visitors." />
      </section>

      <section id="salvations" className="card stack report-section">
        <h2>Salvations and baptisms</h2>
        <p>{report.headlines.current.salvations} saved, {report.headlines.current.baptisms} baptised. Of those saved in the last year, {pct(s.salvationToBaptism.rate)} have been baptised ({s.salvationToBaptism.baptised} of {s.salvationToBaptism.salvations}).</p>
        {pastoral ? (
          <>
            <h3>Saved</h3>
            <PeopleList orgId={orgId} rows={pastoral.salvations.map((x) => ({ personId: x.personId, name: x.name, detail: day(x.date) }))} empty="None." />
            <h3>Baptised</h3>
            <PeopleList orgId={orgId} rows={pastoral.baptisms.map((x) => ({ personId: x.personId, name: x.name, detail: day(x.date) }))} empty="None." />
          </>
        ) : <p className="small muted">Names are shown only to staff with pastoral access.</p>}
      </section>

      <section id="journey" className="card stack report-section">
        <h2>Journey</h2>
        <p className="small muted">Everyone who has completed each step, and how many didn't go on to the next.</p>
        <Bars rows={report.funnel.map((f) => ({ label: f.label, value: f.count, note: f.dropOff == null ? '' : `${f.dropOff}% didn't go on` }))} />
      </section>

      <section id="programmes" className="card stack report-section">
        <h2>Programme progress</h2>
        {s.programs.length === 0 ? <p className="muted">No programmes.</p> : (
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th>Programme</th><th className="num">Enrolled</th><th className="num">Completed</th><th className="num">Rate</th></tr></thead>
              <tbody>
                {s.programs.flatMap((p) => [
                  <tr key={p.programId}>
                    <td><strong>{p.name}</strong>{p.topicCount > 0 && p.averageTopics != null ? <span className="small muted"> · average {p.averageTopics} of {p.topicCount} topics</span> : null}{p.completedInPeriod ? <span className="small muted"> · {p.completedInPeriod} completed this period</span> : null}</td>
                    <td className="num">{p.enrolled}</td><td className="num">{p.completed}</td><td className="num">{pct(p.completionRate)}</td>
                  </tr>,
                  ...p.cohorts.map((c) => (
                    <tr key={`${p.programId}-${c.cohortId}`}><td className="small">&nbsp;&nbsp;{c.name}</td><td className="num">{c.enrolled}</td><td className="num">{c.completed}</td><td className="num">{pct(c.completionRate)}</td></tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="groups" className="card stack report-section">
        <h2>Freedom Groups and Dream Team</h2>
        <table className="report-table">
          <tbody>
            <tr><td>Regular attenders in a Freedom Group</td><td className="num">{pct(s.groups.participationRate)} ({s.groups.participants})</td></tr>
            <tr><td>Groups / average size</td><td className="num">{s.groups.count} / {s.groups.averageSize ?? '–'}</td></tr>
            <tr><td>Average group meeting attendance</td><td className="num">{s.groups.averageMeetingAttendance ?? '–'}</td></tr>
            <tr><td>Regular attenders serving on the Dream Team</td><td className="num">{pct(s.serving.rate)} ({s.serving.members} serving)</td></tr>
            <tr><td>Still serving after 90 days</td><td className="num">{pct(s.serving.retention.rate)} ({s.serving.retention.stayed} of {s.serving.retention.eligible})</td></tr>
          </tbody>
        </table>
        {s.groups.missedTwo.length > 0 && (
          <>
            <h3>Groups that missed 2 or more meetings</h3>
            <ul className="plain">{s.groups.missedTwo.map((g) => <li key={g.groupId}><Link to={`/groups/${orgId}/${g.groupId}`}>{g.name}</Link> <span className="muted small">{g.inARow} in a row</span></li>)}</ul>
          </>
        )}
      </section>

      <section id="followups" className="card stack report-section">
        <h2>People needing follow-up</h2>
        <PeopleList orgId={orgId} rows={report.followUpsDue.map((f) => ({ personId: f.personId, name: f.name, detail: `${reasonLabel(f.reason)}, ${dueText(f).toLowerCase()}${f.overdueDays ? ' overdue' : ''}` }))} empty="Nobody was due." />
        {pastoral && pastoral.followUpsDue.length > 0 && (
          <>
            <h3>Pastoral follow-ups</h3>
            <PeopleList orgId={orgId} rows={pastoral.followUpsDue.map((f) => ({ personId: f.personId, name: f.name, detail: `${reasonLabel(f.reason)}, ${dueText(f).toLowerCase()}${f.overdueDays ? ' overdue' : ''}` }))} empty="" />
          </>
        )}
        <h3>Regulars away 4 weeks or more</h3>
        <PeopleList orgId={orgId} rows={s.dropOff.map((d) => ({ personId: d.personId, name: d.name, detail: `Last at church ${day(d.lastDate)}` }))} empty="Nobody." />
        <p><Link to="/follow-ups">Open the Follow-ups queue</Link></p>
      </section>

      {giving && (
        <section id="giving" className="card stack report-section">
          <h2>Giving</h2>
          <p className="small muted">Pastor's copy. Confirmed gifts only.</p>
          <div className="table-scroll">
            <table className="report-table">
              <thead><tr><th /><th className="num">This period</th><th className="num">{since}</th><th className="num">A year ago</th></tr></thead>
              <tbody>
                <tr><td>Total</td><td className="num"><strong>{money(giving.current.totalCents)}</strong></td><td className="num">{money(giving.previous.totalCents)}</td><td className="num">{money(giving.lastYear.totalCents)}</td></tr>
                <tr><td>Givers</td><td className="num">{giving.current.givers}</td><td className="num">{giving.previous.givers}</td><td className="num">{giving.lastYear.givers}</td></tr>
                <tr><td>Average gift</td><td className="num">{money(giving.current.averageGiftCents)}</td><td className="num">{money(giving.previous.averageGiftCents)}</td><td className="num">{money(giving.lastYear.averageGiftCents)}</td></tr>
                <tr><td>Per attendee</td><td className="num">{money(giving.current.perAttendeeCents)}</td><td className="num">{money(giving.previous.perAttendeeCents)}</td><td className="num">{money(giving.lastYear.perAttendeeCents)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="small">First-time givers: <strong>{giving.current.firstTimeGivers}</strong>. Lapsed givers (nothing in 90 days): <strong>{giving.current.lapsedGivers}</strong>.</p>
          {giving.budgetCents ? <p className="small">Against budget: <strong>{Math.round((giving.current.totalCents / giving.budgetCents) * 100)}%</strong> of {money(giving.budgetCents)}.</p> : null}
          <h3>By fund</h3>
          <Bars rows={Object.entries(giving.current.byFund).map(([id, cents]) => ({ label: giving.fundNames[id] ?? 'No fund', value: cents }))} format={(v) => formatMoney(v, giving.currency)} />
        </section>
      )}
    </div>
  );
}

function PeopleList({ orgId, rows, empty }: { orgId: string; rows: { personId: string; name: string; detail: string }[]; empty: string }) {
  if (rows.length === 0) return empty ? <p className="muted small">{empty}</p> : null;
  return (
    <ul className="plain">
      {rows.map((r, i) => <li key={`${r.personId}-${i}`}><Link to={`/people/${orgId}/${r.personId}`}>{r.name}</Link> <span className="muted small">{r.detail}</span></li>)}
    </ul>
  );
}
