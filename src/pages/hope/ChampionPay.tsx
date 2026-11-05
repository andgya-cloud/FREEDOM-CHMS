import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampionPay, type useChampions } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { championPayExcel, championPayPdf } from '../../lib/hopeAttendanceFiles';
import { setPettyPrefill } from '../../lib/pettyPrefill';
import { approveChampionPay } from '../../lib/hopeWrites';
import { championChange, saveChampionChanges } from '../../lib/championEdit';
import { useTwoSignatures } from '../../components/TwoSignatures';
import { monthPay, payMonthReady, planPayUpload, REPORT_TIME } from '../../../functions/src/shared/hopeChampionPay';
import { formatKes } from '../../../functions/src/shared/hopeRecords';
import { pettyCashBase } from '../../../functions/src/shared/pettyCash';
import { SheetPicker } from './registerParts';
import type { Organization } from '../../state/OrgContext';

type Data = ReturnType<typeof useChampions>;
const MONTH = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));

/**
 * Child Champions' pay (Andy, 2026-11-05, 8A 9A 10A): each champion's weekly amount, paid for each week they came;
 * the Director's extra allowances with a reason; the month's report, ready on the 28th and again on the 1st, worked
 * out by itself, as a PDF and Excel. Once the Director approves it, one tap makes a Petty Cash request.
 */
export function ChampionPay({ org, today, data }: { org: Organization; today: string; data: Data }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const canPetty = ['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage'].some((x) => can(x as never));
  const pay = useChampionPay(org.id);
  const ready = payMonthReady(today);
  const [month, setMonth] = useState(ready?.month ?? today.slice(0, 7));
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const { sign, dialog } = useTwoSignatures(org.id);
  const byId = (id: string) => data.champions.find((c) => c.id === id);
  const report = useMemo(() => monthPay(data.champions, data.days, pay.extras, month), [data.champions, data.days, pay.extras, month]);
  const approved = pay.approved.find((a) => a.id === month);
  const changedSince = approved && approved.total !== report.total;
  const monthExtras = pay.extras.filter((x) => x.month === month);
  const [upload, setUpload] = useState<ReturnType<typeof planPayUpload>>(null);
  const [uploadError, setUploadError] = useState('');
  const [extra, setExtra] = useState({ championId: '', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const active = data.champions.filter((c) => c.status === 'active');
  const noPay = active.filter((c) => !c.weeklyPay && !c.monthlyPay).length;

  async function files(kind: 'pdf' | 'excel') {
    setBusy(true);
    try {
      const who = approved ? approved.approvedName : null;
      downloadFile(await (kind === 'pdf' ? championPayPdf : championPayExcel)(org, month, report.lines, report.total, who));
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  function approve() {
    approveChampionPay(org.id, month, report.total, report.lines.filter((l) => l.total > 0).length, profile?.displayName || profile?.email || 'Director').catch(fail);
    toast.show(`${MONTH(month)} approved: ${formatKes(report.total)}`);
  }
  function petty() {
    setPettyPrefill({
      orgId: org.id, category: 'Staff Payments', payee: 'Child Champions',
      lines: report.lines.filter((l) => l.total > 0).map((l) => ({ description: `${l.name}: ${l.weeks} ${l.weeks === 1 ? 'week' : 'weeks'}${l.extras ? ' + extra' : ''} (${MONTH(month)})`, quantity: '1', unitPrice: String(l.total) })),
    });
    navigate(`${pettyCashBase('ministry')}/new`);
  }
  function saveWeekly(id: string, value: string) {
    const n = value.trim() === '' ? null : Math.round(Number(value.replace(/[^\d.]/g, '')));
    if (n != null && !Number.isFinite(n)) return;
    const c = byId(id);
    if (!c) return;
    sign(`Change ${c.name}'s weekly amount.`, (proofs) => saveChampionChanges(org.id, proofs, { champions: [championChange(c, { weeklyPay: n, monthlyPay: null })] }).then(() => toast.show('Saved')));
  }
  function addExtra() {
    const amount = Math.round(Number(extra.amount.replace(/[^\d.]/g, '')));
    if (!extra.championId || !(amount > 0) || extra.reason.trim().length < 2) { toast.show('Choose the champion, the amount and the reason.'); return; }
    const add = { championId: extra.championId, month, amount, reason: extra.reason.trim() };
    sign(`Add ${formatKes(amount)} for ${byId(add.championId)?.name ?? 'the champion'}.`, (proofs) => saveChampionChanges(org.id, proofs, { addExtras: [add] })
      .then(() => { setExtra({ championId: '', amount: '', reason: '' }); toast.show('Extra allowance added'); }));
  }

  return (
    <>
      {dialog}
      <section className="card stack">
        <div className="card-head">
          <h2>💵 Pay for {MONTH(month)}</h2>
          <input type="month" aria-label="Month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <p className="lead"><b>{formatKes(report.total)}</b> for {report.lines.filter((l) => l.total > 0).length} champions</p>
        {ready?.month === month && <p className="notice small">{ready.final ? `The month is over: this is the final report for ${MONTH(month)}.` : `Ready to check on the 28th. It is final on the 1st, after the last Saturday.`}</p>}
        {approved && <p className={`notice small ${changedSince ? 'notice-warn' : 'notice-ok'}`}>✓ Approved by {approved.approvedName}{changedSince ? `, for ${formatKes(approved.total)}. It has changed since: approve again.` : '.'}</p>}
        {noPay > 0 && <p className="notice notice-warn small">{noPay} {noPay === 1 ? 'champion has' : 'champions have'} no weekly amount yet. Type it below or upload your list.</p>}
        <div className="chips">
          <button type="button" className="btn" disabled={busy} onClick={() => void files('pdf')}>⬇︎ PDF</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void files('excel')}>⬇︎ Excel</button>
          {(!approved || changedSince) && <button type="button" className="btn btn-primary" disabled={!report.total} onClick={approve}>✓ Approve {formatKes(report.total)}</button>}
          {approved && !changedSince && canPetty && <button type="button" className="btn btn-primary" onClick={petty}>💵 Make the Petty Cash request</button>}
          {approved && !changedSince && !canPetty && <span className="small muted align-center">Send the PDF to a Petty Cash signatory to raise the request.</span>}
        </div>
      </section>

      <section className="card stack">
        <h2>Each champion</h2>
        <div className="exam-table-wrap">
          <table className="table cp-table">
            <thead><tr><th>Name</th><th>Weekly (KES)</th><th>Weeks came</th><th>Late</th><th>Extra</th><th>Total</th></tr></thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.championId}>
                  <td>{l.name}</td>
                  <td>{l.monthlyPay ? <span title="A fixed amount for the month">{l.monthlyPay.toLocaleString('en-KE')} a month</span> : <input className="cp-weekly" inputMode="numeric" aria-label={`${l.name}'s weekly amount`} defaultValue={l.weeklyPay || ''} key={`${l.championId}${l.weeklyPay}`} placeholder="0"
                    onBlur={(e) => e.target.value.trim() !== String(l.weeklyPay || '') && saveWeekly(l.championId, e.target.value)} />}</td>
                  <td>{l.weeks}</td>
                  <td>{l.late || ''}</td>
                  <td title={l.extraReasons.join('; ')}>{l.extras ? l.extras.toLocaleString('en-KE') : ''}</td>
                  <td><b>{l.total.toLocaleString('en-KE')}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}><b>Total to pay</b></td><td><b>{report.total.toLocaleString('en-KE')}</b></td></tr></tfoot>
          </table>
        </div>
        <p className="small muted">A fixed monthly amount is paid in full each month. A week counts when the champion came on any day that week, on time or late. Champions report at {REPORT_TIME.replace(/^0/, '')}am; after that they are marked late.</p>
      </section>

      <section className="card stack">
        <h2>Extra allowance for {MONTH(month)}</h2>
        <div className="field-row">
          <label className="field"><span>Champion</span>
            <select value={extra.championId} onChange={(e) => setExtra({ ...extra, championId: e.target.value })}>
              <option value="">Choose…</option>
              {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Amount (KES)</span><input inputMode="numeric" value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} placeholder="500" /></label>
        </div>
        <label className="field"><span>Reason</span><input maxLength={200} value={extra.reason} onChange={(e) => setExtra({ ...extra, reason: e.target.value })} placeholder="Transport for the trip, extra day…" /></label>
        <button type="button" className="btn btn-primary align-start" onClick={addExtra}>Add the allowance</button>
        {monthExtras.length > 0 && (
          <ul className="link-list">
            {monthExtras.map((x) => (
              <li key={x.id}><span className="grow"><b>{data.champions.find((c) => c.id === x.championId)?.name ?? 'Champion'}</b><span className="small muted">{formatKes(x.amount)} · {x.reason}</span></span>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => sign(`Remove ${formatKes(x.amount)}.`, (proofs) => saveChampionChanges(org.id, proofs, { removeExtras: [x.id] }).then(() => toast.show('Removed')))}>Remove</button></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Upload the weekly amounts</h2>
        <p className="small">An Excel or CSV file with a <b>Name</b> column and a <b>Weekly amount</b> column. Names are matched to the champions here.</p>
        <SheetPicker onRows={(rows) => { const p = planPayUpload(rows, data.champions); setUploadError(p ? '' : 'The file needs a "Name" column and a "Weekly amount" column.'); setUpload(p); }} />
        {uploadError && <p className="error" role="alert">{uploadError}</p>}
        {upload && (
          <>
            <p><b>{upload.found.length}</b> matched{upload.notFound.length ? `, ${upload.notFound.length} not found: ${upload.notFound.join(', ')}` : ''}.</p>
            <ul className="link-list">{upload.found.map((f) => <li key={f.id}><span className="grow">{f.name}</span><b>{formatKes(f.amount)}{f.monthly ? ' a month, fixed' : ' a week'}</b></li>)}</ul>
            <button type="button" className="btn btn-primary align-start" disabled={!upload.found.length} onClick={() => {
              const champions = upload.found.flatMap((f) => { const c = byId(f.id); return c ? [championChange(c, f.monthly ? { monthlyPay: f.amount, weeklyPay: null } : { weeklyPay: f.amount, monthlyPay: null })] : []; });
              sign(`Save ${champions.length} amounts.`, (proofs) => saveChampionChanges(org.id, proofs, { champions })
                .then(() => { toast.show(`${champions.length} amounts saved`); setUpload(null); }));
            }}>Save {upload.found.length} amounts</button>
          </>
        )}
      </section>
    </>
  );
}
