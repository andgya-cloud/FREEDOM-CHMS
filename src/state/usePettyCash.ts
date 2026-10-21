import { useMemo } from 'react';
import { collection, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { localDateKey } from '../../functions/src/shared/datetime';
import type { Permission } from '../../functions/src/shared/permissions';
import { fundSummary, type PettyCashRequisition, type PettyFund } from '../../functions/src/shared/pettyCash';
import type { Organization } from './OrgContext';

export interface RequisitionRow extends PettyCashRequisition { createdAt?: Timestamp; deletedAt?: unknown }
export interface FundRow extends PettyFund { createdAt?: Timestamp; createdBy?: string }
const millis = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : null);

/** Petty cash permissions. The pastor holds every one of them (see the pettyCash rules). */
export function usePettyCashAccess() {
  const { can, user } = useAuth();
  const pc = (p: Permission) => can(p) || can('users.manage');
  const canCheck = pc('pettycash.check');
  const canApprove = pc('pettycash.approve');
  const canAuthorize = pc('pettycash.authorize');
  const canRequest = pc('pettycash.request') || canCheck || canApprove;
  return { uid: user?.uid ?? '', canRequest, canCheck, canApprove, canAuthorize, seesAll: canCheck || canApprove || canAuthorize, any: canRequest || canAuthorize };
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
    () => fundRows.rows.filter((f) => f.status !== 'cancelled').sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
    [fundRows.rows],
  );
  const summary = useMemo(() => fundSummary(funds, requisitions, millis), [funds, requisitions]);
  return { ...access, month, requisitions, funds, summary, loading: reqs.loading };
}
