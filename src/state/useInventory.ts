import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
import { isInventoryManager } from '../../functions/src/shared/permissions';
import type { InventoryCount } from '../../functions/src/shared/inventory';

export interface InventoryCountRow extends InventoryCount {
  id: string;
  submittedAt?: Timestamp | null;
  verifiedAt?: Timestamp | null;
  updatedAt?: Timestamp;
  deletedAt?: unknown;
}

/** Who may do what with inventory: Admin, the Principal and the pastor manage; the people in charge count their departments. */
export function useInventoryAccess() {
  const { profile } = useAuth();
  const manager = isInventoryManager(profile);
  const mine = profile?.inventoryCourseIds ?? [];
  return { manager, mine, counts: manager || mine.length > 0, myName: profile?.displayName ?? '' };
}

const col = (orgId: string) => collection(db, 'organizations', orgId, 'inventoryCounts');

/** Every count for a manager; a person in charge reads only their own departments', each asked for by itself. */
export function useInventoryCounts(orgId: string) {
  const a = useInventoryAccess();
  const all = useLiveQuery<InventoryCountRow>(() => (orgId && a.manager ? col(orgId) : null), [orgId, a.manager]);
  const key = a.manager ? '' : a.mine.join(',');
  const [byCourse, setByCourse] = useState<Record<string, InventoryCountRow[]>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setByCourse({});
    setLoaded({});
    const ids = key ? key.split(',') : [];
    if (!orgId || !ids.length) return;
    const offs = ids.map((id) => onSnapshot(query(col(orgId), where('courseId', '==', id)), (snap) => {
      setByCourse((m) => ({ ...m, [id]: snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as InventoryCountRow) }));
      setLoaded((m) => ({ ...m, [id]: true }));
    }, () => setLoaded((m) => ({ ...m, [id]: true }))));
    return () => offs.forEach((off) => off());
  }, [orgId, key]);
  const rows = a.manager ? all.rows : Object.values(byCourse).flat();
  const counts = useMemo(() => rows.filter((r) => !r.deletedAt), [rows]);
  const loading = a.manager ? all.loading : key.split(',').some((id) => id && !loaded[id]);
  return { counts, loading };
}

export function useInventoryCount(orgId: string, id: string) {
  const { data, loading } = useLiveDoc<InventoryCountRow>(() => (orgId && id ? doc(db, 'organizations', orgId, 'inventoryCounts', id) : null), [orgId, id]);
  return { count: data && !data.deletedAt ? { ...data, id } : null, loading };
}

/** An item's photo (a small JPEG kept in the database). */
export function useInventoryPhoto(orgId: string, photoId: string | null | undefined) {
  const { data } = useLiveDoc<{ data: string }>(() => (orgId && photoId ? doc(db, 'organizations', orgId, 'inventoryPhotos', photoId) : null), [orgId, photoId]);
  return data?.data ?? null;
}
