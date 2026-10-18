import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { useFunds, useGiftsBetween, useLedgerMonth, useStatementLines } from '../../state/useGiving';
import { recordedCodes, type RecordedCode } from '../../lib/givingWrites';
import { useSyncState } from '../../lib/sync';
import { OrgGate } from '../../components/OrgGate';
import { formatMoney, GIFT_METHOD_LABELS, GIFT_METHODS, PAYBILL_NUMBER } from '../../../functions/src/shared/giving';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';

/**
 * The monthly report: giving by fund and by method from the ledger, and the
 * check that the month's M-Pesa giving in the app equals the Paybill
 * statement total, with every difference listed.
 */
export function GivingSummaryPage() {
  return <OrgGate title="Monthly summary">{(org) => <Summary org={org} />}</OrgGate>;
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Summary({ org }: { org: Organization }) {
  const { can } = useAuth();
  const { online } = useSyncState();
  const [month, setMonth] = useState(localDateKey(new Date(), org.timeZone).slice(0, 7));
  const from = `${month}-01`;
  const to = `${month}-31`;
  const { ledger, loading } = useLedgerMonth(org.id, month);
  const { lines } = useStatementLines(org.id, from, to);
  const { funds } = useFunds(org.id);
  const { gifts } = useGiftsBetween(org.id, from, to);
  const [codes, setCodes] = useState<Map<string, RecordedCode> | null>(null);
  const currency = org.currency || 'KES';
  const money = (c: number) => formatMoney(c, currency);

  const lineKey = lines.map((l) => l.id).sort().join(',');
  useEffect(() => {
    setCodes(null);
    if (!lines.length || !online) return;
    let live = true;
    recordedCodes(org.id, lines.map((l) => l.id)).then((m) => { if (live) setCodes(m); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, lineKey, online]);

  const fundName = (id: string) => (id === 'none' ? 'No fund' : funds.find((f) => f.id === id)?.name ?? id);
  const fundRows = Object.entries(ledger?.funds ?? {}).filter(([, t]) => t.count !== 0 || t.cents !== 0).sort((a, b) => b[1].cents - a[1].cents);
  const methodRows = GIFT_METHODS.map((m) => [m, ledger?.methods?.[m]] as const).filter(([, t]) => t && (t.count || t.cents));
  const queued = GIFT_METHODS.reduce((s, m) => s + (ledger?.unassigned?.methods?.[m]?.cents ?? 0), 0);
  const queuedCount = GIFT_METHODS.reduce((s, m) => s + (ledger?.unassigned?.methods?.[m]?.count ?? 0), 0);

  const statementTotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const appMpesa = (ledger?.methods?.mpesa?.cents ?? 0) + (ledger?.unassigned?.methods?.mpesa?.cents ?? 0);
  const difference = appMpesa - statementTotal;
  const covered = lines.length ? [lines.reduce((a, l) => (l.date < a ? l.date : a), lines[0]!.date), lines.reduce((a, l) => (l.date > a ? l.date : a), lines[0]!.date)] : null;

  const missing = codes ? lines.filter((l) => !codes.has(l.id)) : [];
  const amountDiffers = codes ? lines.filter((l) => {
    const c = codes.get(l.id);
    return c?.amountCents != null && c.amountCents !== l.amountCents;
  }) : [];
  const onStatement = useMemo(() => new Set(lines.map((l) => l.id)), [lines]);
  const notOnStatement = can('giving.person.read') && lines.length
    ? gifts.filter((g) => g.method === 'mpesa' && g.status !== 'void' && g.mpesaCode && !onStatement.has(g.mpesaCode))
    : [];

  return (
    <div className="page narrow">
      <p className="no-print"><Link to="/giving">← Giving</Link></p>
      <div className="page-head">
        <h1>{monthLabel(month)}</h1>
        <button type="button" className="btn btn-quiet no-print" onClick={() => window.print()}>Print</button>
      </div>
      <p className="lead">{org.name}</p>
      <label className="field no-print">
        <span>Month</span>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </label>

      <section className="card">
        <h2>Total given</h2>
        {loading ? <p className="muted">Loading…</p> : (
          <>
            <p className="big-number">{money(ledger?.totalCents ?? 0)}</p>
            <p className="muted small">{ledger?.count ?? 0} confirmed gifts. Void gifts are not counted.{queuedCount ? ` ${queuedCount} more (${money(queued)}) wait in Unassigned.` : ''}</p>
          </>
        )}
        {fundRows.length > 0 && (
          <table className="table">
            <thead><tr><th>Fund</th><th className="num">Gifts</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {fundRows.map(([id, t]) => <tr key={id}><td>{fundName(id)}</td><td className="num">{t.count}</td><td className="num">{money(t.cents)}</td></tr>)}
            </tbody>
          </table>
        )}
        {methodRows.length > 0 && (
          <table className="table">
            <thead><tr><th>Method</th><th className="num">Gifts</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {methodRows.map(([m, t]) => <tr key={m}><td>{GIFT_METHOD_LABELS[m]}</td><td className="num">{t!.count}</td><td className="num">{money(t!.cents)}</td></tr>)}
              {queuedCount > 0 && <tr><td>Unassigned (all methods)</td><td className="num">{queuedCount}</td><td className="num">{money(queued)}</td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="card stack">
        <h2>Check against the Paybill statement</h2>
        {lines.length === 0 ? (
          <p className="muted">No statement imported for {monthLabel(month)} yet. Import the Paybill {PAYBILL_NUMBER} statement to check the M-Pesa total.</p>
        ) : (
          <>
            <dl className="details">
              <div><dt>Statement</dt><dd>{money(statementTotal)} · {lines.length} payments{covered && `, ${formatDateKey(covered[0])} to ${formatDateKey(covered[1])}`}</dd></div>
              <div><dt>M-Pesa in the app</dt><dd>{money(appMpesa)} <span className="muted small">(confirmed and unassigned)</span></dd></div>
            </dl>
            {difference === 0 ? (
              <div className="notice" role="status"><strong>Matches.</strong> Every shilling on the statement is in the app.</div>
            ) : (
              <div className="notice notice-warn" role="status">
                <strong>Differs by {money(Math.abs(difference))}</strong>: the app has {difference > 0 ? 'more' : 'less'} M-Pesa giving than the statement.
                {covered && covered[1] < to && covered[0] > from && ' The statement may not cover the whole month.'}
              </div>
            )}
            {!online && <p className="muted small">Go online to list the payments behind the difference.</p>}
            {missing.length > 0 && (
              <div>
                <strong className="small">On the statement but not in the app</strong>
                <ul className="plain small">{missing.map((l) => <li key={l.id}>{l.id} · {formatDateKey(l.date)} · {money(l.amountCents)}</li>)}</ul>
              </div>
            )}
            {amountDiffers.length > 0 && (
              <div>
                <strong className="small">Recorded with a different amount</strong>
                <ul className="plain small">{amountDiffers.map((l) => <li key={l.id}>{l.id} · statement {money(l.amountCents)}, app {money(codes!.get(l.id)!.amountCents!)}</li>)}</ul>
              </div>
            )}
            {notOnStatement.length > 0 && (
              <div>
                <strong className="small">In the app but not on the statement</strong>
                <ul className="plain small">{notOnStatement.map((g) => <li key={g.id}><Link to={`/giving/${org.id}/${g.id}`}>{g.mpesaCode}</Link> · {formatDateKey(g.date)} · {money(g.amountCents)} · {g.giverName}</li>)}</ul>
              </div>
            )}
            {difference !== 0 && codes && !missing.length && !amountDiffers.length && !notOnStatement.length && (
              <p className="muted small">Every code matches, so the difference is a voided gift that was not entered again{can('giving.person.read') ? '' : ', or a payment only the pastor can see'}.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
