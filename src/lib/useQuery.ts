import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';
import { ESTIMATE } from './firestoreOptions';

/** Live results of a Firestore query (served from the device cache when offline). */
export function useLiveQuery<T>(makeQuery: () => Query | null, deps: unknown[]): { rows: T[]; loading: boolean; error: string } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as T));
      setLoading(false);
      setError('');
    }, (err) => {
      setError(err.code);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { rows, loading, error };
}

/** One live document, or null while it is missing. */
export function useLiveDoc<T>(makeRef: () => DocumentReference | null, deps: unknown[]): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ref = makeRef();
    if (!ref) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(ref, (snap) => {
      setData(snap.exists() ? ({ id: snap.id, ...snap.data(ESTIMATE) } as T) : null);
      setLoading(false);
    }, () => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading };
}
