import { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildExports, type ChildExport } from '../../state/useHope';
import { decideChildExport, markExportDownloaded, requestChildExport } from '../../lib/hopeWrites';
import { friendlyError } from '../../lib/errors';
import { csvFile } from '../../lib/schoolPdf';
import { downloadFile } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { ATTENDANCE_STATUS_LABELS } from '../../../functions/src/shared/attendance';
import { SCHOOL_STATUS_LABELS } from '../../../functions/src/shared/hope';
import { HopeGate, HopeNav, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeExportsPage() {
  return <HopeGate title="Exports">{(org) => <Exports org={org} />}</HopeGate>;
}

const SCOPES = { register: 'The children register (codes, names, ages, programmes, consent)', attendance: 'Attendance of children (who came to which session)' } as const;

function Exports({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const { requests, loading } = useChildExports(org.id);
  const [scope, setScope] = useState<keyof typeof SCOPES>('register');
  const [reason, setReason] = useState('');
  const pastor = can('data.export');
  const fail = (err: unknown) => toast.show(friendlyError(err));

  function ask() {
    try {
      requestChildExport(org.id, scope, reason, pastor);
      setReason('');
      toast.show(pastor ? 'Approved. You can download it below.' : 'Sent to the pastor for approval.');
    } catch (err) { fail(err); }
  }

  function download(r: ChildExport) {
    const rows: (string | number | null)[][] = r.scope === 'register'
      ? [['Code', 'Name', 'Status', 'Date of birth', 'Joined', 'School', 'In school', 'Programmes', 'Guardian consent', 'Photo consent'],
        ...h.children.map((c) => [c.code ?? '', h.nameOf(c.id), c.status, c.dateOfBirth ?? '', c.enrolledOn ?? '', c.school ?? '', SCHOOL_STATUS_LABELS[c.schoolStatus],
          c.programmes.map((p) => p.name).join('; '), c.guardianConsent.given == null ? 'not on file' : c.guardianConsent.given ? `yes ${c.guardianConsent.date ?? ''}` : 'no',
          c.photoConsent.given == null ? 'not on file' : c.photoConsent.given ? `yes ${c.photoConsent.date ?? ''}` : 'no'])]
      : [['Code', 'Name', 'Date', 'Session', 'Status'],
        ...h.records.flatMap((rec) => {
          const child = h.children.find((c) => c.id === rec.personId);
          const ev = h.events.find((e) => e.id === rec.eventId);
          return child && ev ? [[child.code ?? '', h.nameOf(child.id), ev.date, ev.name, ATTENDANCE_STATUS_LABELS[rec.status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? rec.status]] : [];
        })];
    downloadFile(csvFile(`Hope Center ${r.scope} ${h.today}.csv`, rows));
    markExportDownloaded(org.id, r.id).catch(fail);
  }

  return (
    <div className="page narrow">
      <h1>Exports</h1>
      <HopeNav />
      <p className="notice small">Anything that takes children's details out of the system needs the pastor's approval, and every request and download is written to the activity log. Welfare notes and safeguarding records are never exported.</p>
      <section className="card stack">
        <h2>Ask for an export</h2>
        <label className="field"><span>What do you need?</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as keyof typeof SCOPES)}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field"><span>Why? (the pastor will read this)</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: list for the school fees sponsor" /></label>
        <button type="button" className="btn btn-primary align-start" disabled={reason.trim().length < 3} onClick={ask}>{pastor ? 'Approve and prepare' : 'Ask the pastor'}</button>
      </section>

      <h2>Requests</h2>
      {loading ? <p className="muted">Loading…</p> : requests.length === 0 ? <div className="card"><p>No requests yet.</p></div> : (
        <ul className="link-list">
          {requests.map((r) => (
            <li key={r.id}>
              <div>
                <span className="link-title">{SCOPES[r.scope].split(' (')[0]} · {r.status === 'pending' ? 'waiting for the pastor' : r.status === 'approved' ? 'approved' : 'declined'}</span>
                <span className="link-detail">{r.reason}{r.createdAt ? ` · ${formatDateKey(r.createdAt.toDate().toISOString().slice(0, 10))}` : ''}{r.downloadedAt ? ' · downloaded' : ''}</span>
                {r.status === 'pending' && pastor && (
                  <span className="chips">
                    <button type="button" className="btn btn-primary" onClick={() => decideChildExport(org.id, r.id, true).catch(fail)}>Approve</button>
                    <button type="button" className="btn" onClick={() => decideChildExport(org.id, r.id, false).catch(fail)}>Decline</button>
                  </span>
                )}
                {r.status === 'approved' && !r.downloadedAt && <button type="button" className="btn" onClick={() => download(r)}>Download once</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
