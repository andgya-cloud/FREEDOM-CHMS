import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import type { MonthAdjustment, PayLine, PayrollRates, PayrollStaff, PayrollTotals } from '../../functions/src/shared/payroll';

const me = () => {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
};

export type StaffInput = Omit<PayrollStaff, 'id'>;

/** Adds a staff member to the payroll, or saves changes to one. */
export function saveStaff(orgId: string, id: string | null, input: StaffInput) {
  if (id) return updateRecord(doc(db, 'organizations', orgId, 'payrollStaff', id), { orgId, ...input });
  const ref = doc(collection(db, 'organizations', orgId, 'payrollStaff'));
  return trackWrite(setDoc(ref, { orgId, ...input, ...createStamps() }));
}

/** Prepares (or prepares again) a month's pay run from the current staff details and rates. */
export function preparePayRun(orgId: string, month: string, exists: boolean, data: { lines: PayLine[]; totals: PayrollTotals; rates: PayrollRates; adjustments: Record<string, MonthAdjustment> }, preparedByName: string) {
  const ref = doc(db, 'organizations', orgId, 'payrollRuns', month);
  // Firestore does not store undefined, so optional staff fields are written as empty text.
  const body = { ...JSON.parse(JSON.stringify(data)) as typeof data, preparedBy: me(), preparedByName, reviewed: null };
  if (exists) return updateRecord(ref, body);
  return trackWrite(setDoc(ref, { orgId, month, status: 'draft', approved: null, ...body, ...createStamps() }));
}

/** Signs a pay run as checked; whoever prepared it cannot. */
export function reviewPayRun(orgId: string, month: string, name: string) {
  return updateRecord(doc(db, 'organizations', orgId, 'payrollRuns', month), { reviewed: { uid: me(), name, at: serverTimestamp() } });
}

/** Approves a pay run; it is then locked. */
export function approvePayRun(orgId: string, month: string, name: string) {
  return updateRecord(doc(db, 'organizations', orgId, 'payrollRuns', month), { status: 'approved', approved: { uid: me(), name, at: serverTimestamp() } });
}

export function savePayrollRates(orgId: string, rates: PayrollRates, exists: boolean) {
  const ref = doc(db, 'organizations', orgId, 'payrollSettings', 'rates');
  if (exists) return updateRecord(ref, { orgId, ...rates });
  return trackWrite(setDoc(ref, { orgId, ...rates, ...createStamps() }));
}
