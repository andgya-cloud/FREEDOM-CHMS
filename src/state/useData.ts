import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { trackWrite } from '../lib/sync';
import type { DataRequestKind } from '../../functions/src/shared/dataset';

export interface DataRequest {
  id: string;
  kind: DataRequestKind | 'reset_training';
  status: 'pending' | 'done' | 'failed';
  error?: string;
  counts?: Record<string, number> | null;
}

/** Asks the server to log (and for erase, carry out) a data request. The app waits for it to be marked done. */
export function requestData(orgId: string, uid: string, kind: DataRequest['kind'], personId: string | null = null): string {
  const ref = doc(collection(db, 'organizations', orgId, 'dataRequests'));
  void trackWrite(setDoc(ref, { orgId, kind, personId, status: 'pending', createdAt: serverTimestamp(), createdBy: uid }));
  return ref.id;
}

/** Resolves when the server marks the request done, and throws its reason if it failed. */
export function waitForRequest(orgId: string, requestId: string, timeoutMs = 120_000): Promise<DataRequest> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { stop(); reject(new Error('That is taking too long. Check your connection and try again.')); }, timeoutMs);
    const stop = onSnapshot(doc(db, 'organizations', orgId, 'dataRequests', requestId), (snap) => {
      if (!snap.exists()) return;
      const req = { id: snap.id, ...snap.data() } as DataRequest;
      if (req.status === 'pending') return;
      window.clearTimeout(timer);
      stop();
      if (req.status === 'done') resolve(req);
      else reject(new Error(req.error ?? 'That could not be done.'));
    }, (err) => { window.clearTimeout(timer); reject(err); });
  });
}

export interface BackupStatus { ok?: boolean; lastAt?: Timestamp; file?: string; bytes?: number; records?: number; error?: string | null }

export function useBackupStatus(): BackupStatus | null {
  const { profile, can } = useAuth();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const allowed = !!profile?.active && can('data.export');
  useEffect(() => {
    if (!allowed) return;
    return onSnapshot(doc(db, 'settings', 'backupStatus'), (snap) => setStatus((snap.data() as BackupStatus | undefined) ?? null), () => undefined);
  }, [allowed]);
  return status;
}

export function useRetentionDays(): { days: number | null; exists: boolean } {
  const { profile } = useAuth();
  const [state, setState] = useState<{ days: number | null; exists: boolean }>({ days: null, exists: false });
  useEffect(() => {
    if (!profile?.active) return;
    return onSnapshot(doc(db, 'settings', 'retention'), (snap) => {
      setState({ days: typeof snap.get('deletedDays') === 'number' ? snap.get('deletedDays') : null, exists: snap.exists() });
    }, () => undefined);
  }, [profile?.active]);
  return state;
}
