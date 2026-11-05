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
import { monthPay, payMonthReady, REPORT_TIME } from '../../../functions/src/shared/hopeChampionPay';
import { formatKes } from '../../../functions/src/shared/hopeRecords';
import { pettyCashBase } from '../../../functions/src/shared/pettyCash';
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
  const report = useMemo(() => monthPay(data.champions, data.days, pay.extras, month), [data.champions, data.days, pay.extras, month]);
  const approved = pay.approved.find((a) => a.id === month);
  const changedSince = approved && approved.total !== report.total;
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
  return (
    <>
      <section className="card stack">
        <div className="card-head">
          <h2>💵 Pay for {MONTH(month)}</h2>
          <input type="month" aria-label="Month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <p className="lead"><b>{formatKes(report.total)}</b> for {report.lines.filter((l) => l.total > 0).length} champions</p>
        {ready?.month === month && <p className="notice small">{ready.final ? `The month is over: this is the final report for ${MONTH(month)}.` : `Ready to check on the 28th. It is final on the 1st, after the last Saturday.`}</p>}
        {approved && <p className={`notice small ${changedSince ? 'notice-warn' : 'notice-ok'}`}>✓ Approved by {approved.approvedName}{changedSince ? `, for ${formatKes(approved.total)}. It has changed since: approve again.` : '.'}</p>}
        {noPay > 0 && <p className="notice notice-warn small">{noPay} {noPay === 1 ? 'champion has' : 'champions have'} no weekly amount yet. Set it in the champion's Edit box, on The champions tab, or upload your list there.</p>}
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
                  <td>{l.monthlyPay ? `${l.monthlyPay.toLocaleString('en-KE')} a month` : l.weeklyPay ? l.weeklyPay.toLocaleString('en-KE') : '–'}</td>
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
        <p className="small muted">Amounts and extra allowances are set in each champion's Edit box, with two signatures. A fixed monthly amount is paid in full each month. A week counts when the champion came on any day that week, on time or late. Champions report at {REPORT_TIME.replace(/^0/, '')}am; after that they are marked late.</p>
      </section>

    </>
  );
}
