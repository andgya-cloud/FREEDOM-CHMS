import { Help } from '../../components/Help';
import { canReadNotes } from '../../../functions/src/shared/hopeRecords';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { hopeReportPdf, type PdfPhoto } from '../../lib/hopePdf';
import { photoFile, photoForPdf } from '../../lib/hopePhotos';
import { usePhotoReports } from './HopePhotosPage';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { PHOTO_REPORT_EMOJI } from '../../../functions/src/shared/hopePhotos';
import { shareOrDownload } from '../../lib/givingPdf';
import type { HopeReportDoc } from '../../../functions/src/shared/hope';
import type { StoredHopeReport } from '../../state/useHope';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { HopeGate, pct } from './common';
import { HopeFigures } from './HopeFigures';
import type { Organization } from '../../state/OrgContext';

export function HopeReportsPage() {
  return <HopeGate title="Hope Center reports">{(org) => <Reports org={org} />}</HopeGate>;
}

/** The reports the signed-in person may open: the pastor sees weekly and monthly, other staff the counts-only monthly ones. */
export function useHopeReportList(orgId: string) {
  const { can } = useAuth();
  const pastor = can('pastoral.read');
  const { rows, loading } = useLiveQuery<StoredHopeReport & HopeReportDoc>(
    () => {
      if (!can('people.read')) return null;
      const reports = collection(db, 'organizations', orgId, 'hopeReports');
      return pastor ? query(reports, orderBy('from', 'desc')) : query(reports, where('audience', '==', 'counts'));
    }, [orgId, pastor]);
  return { reports: [...rows].sort((a, b) => b.from.localeCompare(a.from)), loading, pastor };
}

/**
 * Reports (Andy, 2026-11-05, v173 8A and 10A): four tiles. The monthly report is made by itself on the 1st and
 * opens from its month's folder under Attendance and meals, so there is no form to fill in.
 */
function Reports({ org }: { org: Organization }) {
  const { profile, can } = useAuth();
  const [params] = useSearchParams();
  const openId = params.get('report') ?? '';
  const { reports } = useHopeReportList(org.id);
  const reader = canReadNotes(profile, org.id);
  // Only Andy and Doreen open the Bin (Andy, 2026-11-05).
  const bin = canKeepAccounts(profile);
  const open = reports.find((r) => r.id === openId);
  if (openId) {
    return (
      <div className="page narrow">
        <p><Link to={open ? `/hope/attendance?month=${open.from.slice(0, 7)}` : '/hope/attendance'}>← Attendance and meals</Link></p>
        {open ? <ReportView org={org} report={open} /> : <p className="muted">Loading…</p>}
      </div>
    );
  }
  const tiles: [string, string, string, string][] = [
    ['/hope/attendance', '📋', 'Attendance and meals', 'Every register day and the meals served, in folders by month, with each month\'s report'],
    ['/hope/records', '🔒', 'Care', reader ? 'Notes and conversations about each child' : 'Conversations and the worries you raised'],
    ['/hope/photos', '📷', 'Photos and wins', 'Photo reports and the clubs\' wins'],
    ...(bin ? [['/hope/bin', '🗑', 'Bin', 'What was removed, to put back'] as [string, string, string, string]] : []),
  ];
  return (
    <div className="page lav-today">
      <h1>Reports</h1>
      <div className="rp-tiles">
        {tiles.map(([to, ico, title, sub]) => (
          <Link key={to} to={to} className="card rp-tile"><span className="rp-ico" aria-hidden="true">{ico}</span><b>{title}</b><span className="small muted">{sub}</span></Link>
        ))}
      </div>
      <p className="small muted">The month's report, with numbers only, is made by itself on the 1st. <Help>It opens from its month in Attendance and meals. The weekly report for the pastor, with the children to follow up, is there too.</Help></p>
      {can('people.read') && (
        <section className="stack" aria-label="Figures">
          <h2>📊 Figures</h2>
          <HopeFigures org={org} />
        </section>
      )}
    </div>
  );
}

function ReportView({ org, report }: { org: Organization; report: HopeReportDoc & StoredHopeReport }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const photos = usePhotoReports(org.id, report.id);
  const linked = photos.list?.reports ?? [];
  const photoCount = linked.reduce((n, r) => n + r.files.filter((f) => f.photo).length, 0);
  const m = report.metrics;
  /** The photos added to this report are printed at the end of the PDF (Andy, 2026-11-04, 5A). */
  async function pdf() {
    setBusy(true);
    try {
      const pics: PdfPhoto[] = [];
      for (const r of linked) {
        for (const f of r.files.filter((x) => x.photo)) {
          const p = await photoForPdf(await photoFile(org.id, r.id, f)).catch(() => null);
          if (p) pics.push({ ...p, caption: `${r.title} · ${formatDateKey(r.day)} · ${r.senderName}${r.text ? ` · ${r.text.replace(/\s+/g, ' ').slice(0, 140)}` : ''}` });
        }
      }
      await shareOrDownload(await hopeReportPdf(org, report, pics), `${org.name} report`);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  const rows: [string, string][] = [
    ['Children registered', String(m.registered)], ['Children active', String(m.active)], ['Came in the last 8 weeks', String(m.attendingLast8Weeks)],
    ['Newly registered', String(m.newlyRegistered)], ['Attending regularly', pct(m.consistencyRate)], ['Still here after 6 months', pct(m.retentionRate)],
    ['In school (of those known)', pct(m.schoolEnrolmentRate)],
    ['Guardians reached after absences', pct(m.guardianContactRate)], ['Consent missing', String(m.consentMissing)],
    // Saturday meals left the screens (Andy, 2026-11-04, 7B); old reports that had meals still show them.
    ...(m.meals.sessions ? [['Meals served', String(m.meals.total)], ['Average meals per Saturday', String(m.meals.averagePerSession ?? '–')]] as [string, string][] : []),
  ];
  return (
    <section className="card stack">
      <div className="card-head"><h2>{report.label}</h2><button type="button" className="btn" disabled={busy} onClick={() => void pdf()}>{busy ? 'Making…' : 'PDF'}</button></div>
      {report.aiSummary && (
        <div className="notice stack">
          <strong>This week in brief</strong>
          <p>{report.aiSummary}</p>
          <p className="small muted">Written by AI from the numbers in this report. Please check it.</p>
        </div>
      )}
      <table className="report-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
      <h3>Photos</h3>
      {linked.length > 0 && (
        <ul className="link-list">{linked.map((r) => <li key={r.id}><Link to={`/hope/photos?report=${r.id}`}><span className="link-title">{PHOTO_REPORT_EMOJI[r.kind]} {r.title}</span><span className="link-detail">{formatDateKey(r.day)} · {r.senderName} · {r.files.length} {r.files.length === 1 ? 'file' : 'files'}</span></Link></li>)}</ul>
      )}
      <p className="small muted">{photoCount ? `${photoCount} ${photoCount === 1 ? 'photo is' : 'photos are'} printed at the end of the PDF.` : 'Photos you add here are printed at the end of the PDF.'}</p>
      {photos.list?.sends && <Link className="btn align-start" to={`/hope/photos?new=1&for=${report.id}&label=${encodeURIComponent(report.label)}`}>📷 Add photos</Link>}
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
