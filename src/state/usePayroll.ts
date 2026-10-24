import { useMemo } from 'react';
import { collection, doc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { DEFAULT_PAYROLL_RATES, type MonthAdjustment, type PayLine, type PayrollRates, type PayrollStaff, type PayrollTotals } from '../../functions/src/shared/payroll';
import type { Permission } from '../../functions/src/shared/permissions';
import type { Organization } from './OrgContext';

export interface StaffRow extends PayrollStaff { deletedAt?: unknown }
export interface PayRun {
  id: string;
  month: string;
  status: 'draft' | 'approved';
  lines: PayLine[];
  totals: PayrollTotals;
  rates: PayrollRates;
  preparedBy: string;
  preparedByName: string;
  approved: { uid: string; name: string; at?: Timestamp } | null;
  reviewed?: { uid: string; name: string; at?: Timestamp } | null;
  adjustments?: Record<string, MonthAdjustment>;
  updatedAt?: Timestamp;
}

/** Payroll permissions. The pastor (users.manage) holds both, as his account predates payroll. */
export function usePayrollAccess() {
  const { can, user } = useAuth();
  const p = (x: Permission) => can(x) || can('users.manage');
  const canManage = p('payroll.manage');
  const canApprove = p('payroll.approve');
  return { uid: user?.uid ?? '', canManage, canApprove, any: canManage || canApprove };
}

/** The organization's payroll staff, pay runs and deduction rates. */
export function usePayroll(org: Organization) {
  const access = usePayrollAccess();
  const on = !!org.id && access.any;
  const staffQ = useLiveQuery<StaffRow>(() => (on ? collection(db, 'organizations', org.id, 'payrollStaff') : null), [org.id, on]);
  const runsQ = useLiveQuery<PayRun>(() => (on ? collection(db, 'organizations', org.id, 'payrollRuns') : null), [org.id, on]);
  const ratesDoc = useLiveDoc<PayrollRates & { id: string }>(() => (on ? doc(db, 'organizations', org.id, 'payrollSettings', 'rates') : null), [org.id, on]);
  const staff = useMemo(() => staffQ.rows.filter((s) => !s.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [staffQ.rows]);
  const runs = useMemo(() => [...runsQ.rows].sort((a, b) => b.month.localeCompare(a.month)), [runsQ.rows]);
  const rates: PayrollRates = ratesDoc.data ? { ...DEFAULT_PAYROLL_RATES, ...ratesDoc.data } : DEFAULT_PAYROLL_RATES;
  return { ...access, staff, runs, rates, ratesSaved: !!ratesDoc.data, loading: staffQ.loading || runsQ.loading };
}
