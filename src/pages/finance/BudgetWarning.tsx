import { useMemo } from 'react';
import type { Organization } from '../../state/OrgContext';
import { money } from '../school/common';
import { usePettyCash } from '../../state/usePettyCash';
import { useFinance } from '../../state/useFinance';
import { budgetWarning, pettyToFin, spentInMonth } from '../../../functions/src/shared/finance';
import { approvedAfter, useBankMoney } from './BankMoney';

/**
 * On a new requisition: a warning when the request takes its category to 80% or past 100% of this month's
 * budget, counting the bank statement, the requisitions approved since it, and those waiting (Andy, 2026-11-09, 7A).
 */
export function BudgetWarning({ org, category, addingCents }: { org: Organization; category: string; addingCents: number }) {
  const f = useFinance(org);
  const p = usePettyCash(org);
  const bank = useBankMoney(org);
  const fin = category ? pettyToFin(category) : '';
  const monthly = fin ? f.budget[fin] ?? 0 : 0;
  const warn = useMemo(() => {
    if (!monthly) return null;
    const month = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
    const petty = approvedAfter(p.requisitions, bank.asOf, month);
    const waiting = p.requisitions.filter((r) => (r.status === 'submitted' || r.status === 'checked') && pettyToFin(r.category) === fin).reduce((n, r) => n + r.totalCents, 0);
    const spent = (spentInMonth(month, f.statements, [], petty)[fin] ?? 0) + waiting;
    return budgetWarning(fin, monthly, spent, addingCents, (c) => money(org, c));
  }, [monthly, p.requisitions, fin, f.statements, addingCents, org, bank.asOf]);
  if (!warn) return null;
  return <p className={`small petty-warn${warn.level === 'over' ? ' danger-text' : ''}`}>{warn.text} {warn.level === 'over' ? 'It can still be sent; the signers will see it.' : ''}</p>;
}
