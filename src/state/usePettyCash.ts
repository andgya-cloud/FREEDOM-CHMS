import { useMemo } from 'react';
import { collection, doc, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { localDateKey } from '../../functions/src/shared/datetime';
import { ACCOUNTANT_TITLE, canKeepAccounts, isDirectorProfile, type Permission } from '../../functions/src/shared/permissions';
import { fundSummary, periodStartOf, type PettyCashRequisition, type PettyFund, type PettyMonth } from '../../functions/src/shared/pettyCash';
import type { Organization } from './OrgContext';

export interface RequisitionRow extends PettyCashRequisition {
  createdAt?: Timestamp; deletedAt?: unknown;
  /** Set by the server when it emails or messages the stakeholders. */
  notice?: { askedAt?: Timestamp; askEmailed?: number; askWhatsapp?: number; remindedAt?: Timestamp; approvedAt?: Timestamp; approvedEmailed?: number; approvedWhatsapp?: number;
    askEmailAt?: Timestamp; askEmailBy?: string; approvedEmailAt?: Timestamp; approvedEmailBy?: string };
  raisedBy?: string;
}
export interface FundRow extends PettyFund { createdAt?: Timestamp; createdBy?: string; deletedAt?: unknown }
export const millis = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : null);

/** Petty cash permissions. The pastor holds every one of them (see the pettyCash rules). */
export function usePettyCashAccess() {
  const { can, user, profile } = useAuth();
  const pc = (p: Permission) => can(p) || can('users.manage');
  const canCheck = pc('pettycash.check');
  const canApprove = pc('pettycash.approve');
  const canAuthorize = pc('pettycash.authorize');
  // Only the signatories (and the pastor) raise requests.
  const canRequest = pc('pettycash.request');
  const canSign = canCheck || canApprove || canAuthorize;
  // The title printed under a signature, set on each signatory's account; the accountant's must be on every request.
  const signRole = signTitle(profile?.pettyTitle, can('users.manage'));
  const isAccountant = profile?.pettyTitle === ACCOUNTANT_TITLE;
  // "Pastor" powers in petty cash (delete alone, the register, put back) are the Director's only (Andy, 2026-10-24).
  const isPastor = isDirectorProfile(profile);
  return { uid: user?.uid ?? '', canRequest, canCheck, canApprove, canAuthorize, canSign, signRole, isAccountant, isPastor, isKeeper: canKeepAccounts(profile), seesAll: canSign,
    // The Chairman also sees the deletion register, read-only (Andy, 2026-10-24).
    seesRegister: isPastor || profile?.pettyTitle === 'Chairman', any: canRequest || canAuthorize };
}

/** The voucher title for a signer: the one on their account, otherwise Pastor or Stakeholder. */
export function signTitle(pettyTitle: string | undefined, isPastor: boolean): string {
  return pettyTitle || (isPastor ? 'Pastor' : 'Stakeholder');
}

/** The organization's requisitions (or, for a requester, their own), the top-ups and resets, and the budget they add up to. */
export function usePettyCash(org: Organization) {
  const access = usePettyCashAccess();
  const orgId = org.id;
  const on = !!orgId && access.any && !!access.uid;
  const month = localDateKey(new Date(), org.timeZone).slice(0, 7);
  const reqs = useLiveQuery<RequisitionRow>(() => {
    if (!on) return null;
    const col = collection(db, 'organizations', orgId, 'pettyCash');
    return access.seesAll ? col : query(col, where('requesterId', '==', access.uid));
  }, [orgId, on, access.seesAll, access.uid]);
  const fundRows = useLiveQuery<FundRow>(() => (on ? collection(db, 'organizations', orgId, 'pettyFunds') : null), [orgId, on]);
  const requisitions = useMemo(
    () => reqs.rows.filter((r) => !r.deletedAt).sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
    [reqs.rows],
  );
  const funds = useMemo(
    () => fundRows.rows.filter((f) => f.status !== 'cancelled' && !f.deletedAt).sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
    [fundRows.rows],
  );
  const summary = useMemo(() => fundSummary(funds, requisitions, millis), [funds, requisitions]);
  const periodStart = useMemo(() => periodStartOf(funds, millis), [funds]);
  const budget = useLiveDoc<{ allocations?: Record<string, number> }>(() => (on ? doc(db, 'organizations', orgId, 'pettySettings', 'budget') : null), [orgId, on]);
  const allocations = budget.data?.allocations ?? {};
  return { ...access, month, requisitions, funds, summary, periodStart, allocations, loading: reqs.loading };
}

export interface ReceiptRow { id: string; reqId: string; name: string; type: string; size: number; uploadedByName: string; itemIndex?: number | null; createdAt?: Timestamp; createdBy?: string; deletedAt?: unknown }

/** Receipt records (not the files): all of them for those who see every requisition, or one requisition's. */
export function useReceipts(org: Organization, reqId?: string) {
  const access = usePettyCashAccess();
  const on = !!org.id && access.any && !!access.uid && (access.seesAll || !!reqId);
  const res = useLiveQuery<ReceiptRow>(() => {
    if (!on) return null;
    const col = collection(db, 'organizations', org.id, 'pettyReceipts');
    return reqId ? query(col, where('reqId', '==', reqId)) : col;
  }, [org.id, on, reqId]);
  const receipts = useMemo(() => res.rows.filter((r) => !r.deletedAt).sort((a, b) => (a.createdAt?.toMillis() ?? Date.now()) - (b.createdAt?.toMillis() ?? Date.now())), [res.rows]);
  return { receipts, loading: res.loading };
}

export interface MonthRow extends PettyMonth { id: string; updatedAt?: Timestamp }
/** Month-end close records, keyed by month ("2026-10"). */
export function usePettyMonths(org: Organization) {
  const access = usePettyCashAccess();
  const on = !!org.id && access.any && !!access.uid;
  const res = useLiveQuery<MonthRow>(() => (on ? collection(db, 'organizations', org.id, 'pettyMonths') : null), [org.id, on]);
  const byMonth = useMemo(() => Object.fromEntries(res.rows.map((m) => [m.id, m])) as Record<string, MonthRow>, [res.rows]);
  return { months: byMonth, loading: res.loading };
}
