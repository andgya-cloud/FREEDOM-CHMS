import { useMemo } from 'react';
import { collection, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import type { BankStatement, CashCount, DailyBankEntry, OrgKind, OwnedItem } from '../../functions/src/shared/finance';
import type { Organization } from './OrgContext';

/** Who keeps the financial statements: the petty cash signatories, finance and the pastor (Andy, 2026-11-08, 6A). */
export function useFinAccess(): boolean {
  const { can } = useAuth();
  return can('finance.reports') || can('pettycash.approve') || can('pettycash.check') || can('pettycash.authorize') || can('users.manage');
}

export const orgKind = (type: string | undefined): OrgKind => (type === 'church_campus' ? 'church' : type === 'ministry' ? 'hope' : 'school');

export interface StatementRow extends BankStatement { deletedAt?: unknown }

/** An organization's uploaded statements, the remembered choices, the budget and what it owns and owes. */
export function useFinance(org: Organization) {
  const allowed = useFinAccess();
  const on = allowed && !!org.id;
  const res = useLiveQuery<StatementRow>(() => (on ? collection(db, 'organizations', org.id, 'bankStatements') : null), [org.id, on]);
  const statements = useMemo(() => res.rows.filter((s) => !s.deletedAt).sort((a, b) => a.account.localeCompare(b.account) || a.from.localeCompare(b.from)), [res.rows]);
  const learned = useLiveDoc<{ learned?: Record<string, string> }>(() => (on ? doc(db, 'organizations', org.id, 'finBooks', 'learned') : null), [org.id, on]);
  const budget = useLiveDoc<{ budget?: Record<string, number> }>(() => (on ? doc(db, 'organizations', org.id, 'finBooks', 'budget') : null), [org.id, on]);
  const owned = useLiveDoc<{ owned?: OwnedItem[] }>(() => (on ? doc(db, 'organizations', org.id, 'finBooks', 'owned') : null), [org.id, on]);
  return {
    allowed, statements, loading: res.loading,
    learned: learned.data?.learned ?? {}, budget: budget.data?.budget ?? {}, owned: owned.data?.owned ?? [],
  };
}

export interface DailyRow extends DailyBankEntry { deletedAt?: unknown }
/** Bank money typed day by day and the cash counts (Andy, 2026-11-09). */
export function useDaily(org: Organization) {
  const on = useFinAccess() && !!org.id;
  const e = useLiveQuery<DailyRow>(() => (on ? collection(db, 'organizations', org.id, 'bankDaily') : null), [org.id, on]);
  const c = useLiveQuery<CashCount & { id: string }>(() => (on ? collection(db, 'organizations', org.id, 'cashCounts') : null), [org.id, on]);
  const entries = useMemo(() => e.rows.filter((x) => !x.deletedAt).sort((a, b) => b.date.localeCompare(a.date)), [e.rows]);
  return { on, entries, counts: c.rows };
}
