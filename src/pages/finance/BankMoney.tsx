import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { money } from '../school/common';
import { KpiCard, KpiRow } from '../../components/charts';
import { millis, usePettyCash, type RequisitionRow } from '../../state/usePettyCash';
import { useFinance } from '../../state/useFinance';
import { bankMoney, type BankMoney } from '../../../functions/src/shared/finance';

const EAT = 3 * 3_600_000;
const dayOf = (ms: number) => new Date(ms + EAT).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Requisitions approved in a month after the statement's last day: paid from the bank but not in its lines yet. */
export function approvedAfter(reqs: readonly RequisitionRow[], asOf: string, month: string) {
  return reqs.filter((r) => r.status === 'approved' && !r.pastRecord)
    .map((r) => ({ day: dayOf(millis(r.approved?.at) ?? millis(r.createdAt) ?? Date.now()), category: r.category, cents: r.totalCents }))
    .filter((x) => x.day > asOf && x.day.startsWith(month));
}

/**
 * Petty cash is paid from the bank (Andy, 2026-11-09, 1A 2A): the money available is the bank balance on the
 * latest uploaded statement, less the requisitions approved after that statement's last day.
 */
export function useBankMoney(org: Organization): BankMoney & { ready: boolean } {
  const fin = useFinance(org);
  const p = usePettyCash(org);
  return useMemo(() => {
    const approved = p.requisitions.filter((r) => r.status === 'approved' && !r.pastRecord)
      .map((r) => ({ day: dayOf(millis(r.approved?.at) ?? millis(r.createdAt) ?? Date.now()), cents: r.totalCents }));
    return { ...bankMoney(fin.statements, approved), ready: !fin.loading && !p.loading };
  }, [fin.statements, fin.loading, p.requisitions, p.loading]);
}

/** The Overview card: bank balance, paid since, available, and where to upload the next statement. */
export function BankMoneyCard({ org }: { org: Organization }) {
  const m = useBankMoney(org);
  if (!m.ready) return null;
  return (
    <section className="card stack">
      <h2>Money in the bank</h2>
      {m.asOf ? (
        <KpiRow label="Money in the bank">
          <KpiCard label={`Bank balance, ${shortDay(m.asOf)}`} value={money(org, m.bankCents)} />
          <KpiCard label="Approved since" value={money(org, m.paidSinceCents)} note={`${m.paidSince} requisition${m.paidSince === 1 ? '' : 's'}`} />
          <KpiCard label="Available" value={money(org, m.availableCents)} tone={m.availableCents > 0 ? 'ok' : 'warn'} />
        </KpiRow>
      ) : <p className="petty-warn">No bank statement uploaded yet, so requisitions cannot be approved.</p>}
      <p className="small muted">Upload the latest bank statement (any day, even part of a month) to bring this up to date. <Link to="/finance">Upload bank statement</Link></p>
    </section>
  );
}
