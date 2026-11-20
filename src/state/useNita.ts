import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { isAttachmentKeeper } from '../../functions/src/shared/permissions';
import type { NitaRelease, NitaResultRecord } from '../../functions/src/shared/nita';

export type NitaReleaseRow = NitaRelease & { id: string; deletedAt?: unknown };
export type NitaResultRow = NitaResultRecord & { id: string; deletedAt?: unknown };

/** The principal, Admin, the pastor and Doreen keep NITA results (Andy, 2026-11-20, 2A). */
export function useNitaKeeper() {
  const { profile } = useAuth();
  return isAttachmentKeeper(profile);
}

/** Every NITA release and result of the organization (a few hundred at most), for the keepers and the principal. */
export function useNita(orgId: string) {
  const { profile, can } = useAuth();
  const on = !!orgId && !!profile?.active && (isAttachmentKeeper(profile) || can('exams.manage'));
  const rel = useLiveQuery<NitaReleaseRow>(() => (on ? collection(db, 'organizations', orgId, 'nitaReleases') : null), [orgId, on]);
  const res = useLiveQuery<NitaResultRow>(() => (on ? collection(db, 'organizations', orgId, 'nitaResults') : null), [orgId, on]);
  return useMemo(() => {
    const releases = rel.rows.filter((r) => !r.deletedAt);
    const byStudent: Record<string, NitaResultRow> = {};
    for (const r of res.rows) if (!r.deletedAt) byStudent[r.studentId] = r;
    return { releases, byStudent, loading: rel.loading || res.loading };
  }, [rel.rows, res.rows, rel.loading, res.loading]);
}
