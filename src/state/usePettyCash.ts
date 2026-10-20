import { useMemo } from 'react';
import { collection, doc, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { localDateKey } from '../../functions/src/shared/datetime';
import type { Permission } from '../../functions/src/shared/permissions';
import type { PettyCashRequisition } from '../../functions/src/shared/pettyCash';
import type { Organization } from './OrgContext';

export interface RequisitionRow extends PettyCashRequisition { createdAt?: Timestamp; deletedAt?: unknown }
export interface PettyBudget { id: string; amountCents: number; note: string }

/** Petty cash permissions. The pastor holds every one of them (see the pettyCash rules). */
export function usePettyCashAccess() {
  const { can, user } = useAuth();
  const pc = (p: Permission) => can(p) || can('users.manage');
  const canCheck = pc('pettycash.check');
  const canApprove = pc('pettycash.approve');
  const canRequest = pc('pettycash.request') || canCheck || canApprove;
  return { uid: user?.uid ?? '', canRequest, canCheck, canApprove, seesAll: canCheck || canApprove, any: canRequest };
}

/** The organization's requisitions (or, for a requester, their own) and this month's budget. */
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
  const budget = useLiveDoc<PettyBudget>(() => (on ? doc(db, 'organizations', orgId, 'pettyBudgets', month) : null), [orgId, on, month]);
  const requisitions = useMemo(
    () => reqs.rows.filter((r) => !r.deletedAt).sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
    [reqs.rows],
  );
  return { ...access, month, requisitions, budget: budget.data, loading: reqs.loading };
}
