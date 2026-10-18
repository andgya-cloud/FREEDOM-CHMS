import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { trackWrite } from '../lib/sync';
import { ESTIMATE } from '../lib/firestoreOptions';
import type { GivingPart, PastoralPart, ReportDoc } from '../../functions/src/shared/reports';
import type { ReportType } from '../../functions/src/shared/metrics';

export interface StoredReport extends ReportDoc {
  id: string;
  generatedAt?: Timestamp;
  generatedBy: string;
  emailedAt?: Timestamp;
  emailedTo?: number;
}

export interface ReportRequest {
  id: string;
  type: ReportType;
  from: string;
  email: boolean;
  status: 'pending' | 'done' | 'failed';
  reportId?: string;
  error?: string;
  createdBy: string;
}

export interface ReportSettings {
  regularWeeks?: number;
  budgets?: Record<string, number>;
  emailEnabled?: boolean;
  recipientUids?: string[];
}

const reports = (orgId: string) => collection(db, 'organizations', orgId, 'reports');
export const reportIdFor = (type: ReportType, from: string) => `${type}_${from}`;

/** Every report for an organization, newest period first. */
export function useReports(orgId: string) {
  const { can } = useAuth();
  const { rows, loading, error } = useLiveQuery<StoredReport>(
    () => (orgId && can('people.read') ? query(reports(orgId), orderBy('from', 'desc')) : null),
    [orgId],
  );
  return { reports: rows, loading, error };
}

/** The newest weekly report, for the home scorecard. */
export function useLatestReport(orgId: string, type: ReportType = 'weekly') {
  const { can } = useAuth();
  const { rows, loading } = useLiveQuery<StoredReport>(
    () => (orgId && can('people.read') ? query(reports(orgId), where('type', '==', type), orderBy('from', 'desc'), limit(1)) : null),
    [orgId, type],
  );
  return { report: rows[0] ?? null, loading };
}

export function useReport(orgId: string, reportId: string) {
  const [report, setReport] = useState<StoredReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!orgId || !reportId) return;
    setLoading(true);
    return onSnapshot(doc(reports(orgId), reportId), (snap) => {
      setReport(snap.exists() ? ({ id: snap.id, ...snap.data(ESTIMATE) } as StoredReport) : null);
      setLoading(false);
    }, (err) => { setError(err.code); setLoading(false); });
  }, [orgId, reportId]);
  return { report, loading, error };
}

/** The pastoral or giving part of a report, for staff allowed to see it. */
export function useReportPart<T extends PastoralPart | GivingPart>(orgId: string, reportId: string, part: 'pastoral' | 'giving', allowed: boolean, version?: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    setData(null);
    if (!allowed || !orgId || !reportId) return;
    let live = true;
    getDoc(doc(reports(orgId), reportId, 'private', part))
      .then((snap) => { if (live) setData(snap.exists() ? (snap.data() as T) : null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [orgId, reportId, part, allowed, version]);
  return data;
}

/** Asks the server to make (or remake) a report. It appears in the archive a few seconds later. */
export function requestReport(orgId: string, uid: string, type: ReportType, from: string, email = false) {
  const ref = doc(collection(db, 'organizations', orgId, 'reportRequests'));
  void trackWrite(setDoc(ref, { orgId, type, from, email, status: 'pending', createdAt: serverTimestamp(), createdBy: uid }));
  return ref.id;
}

export function useReportRequest(orgId: string, requestId: string | null): ReportRequest | null {
  const [req, setReq] = useState<ReportRequest | null>(null);
  useEffect(() => {
    setReq(null);
    if (!orgId || !requestId) return;
    return onSnapshot(doc(db, 'organizations', orgId, 'reportRequests', requestId), (snap) => {
      if (snap.exists()) setReq({ id: snap.id, ...snap.data() } as ReportRequest);
    }, () => undefined);
  }, [orgId, requestId]);
  return req;
}

export function useReportSettings(): { settings: ReportSettings; exists: boolean; ready: boolean } {
  const { profile } = useAuth();
  const [state, setState] = useState<{ settings: ReportSettings; exists: boolean; ready: boolean }>({ settings: {}, exists: false, ready: false });
  useEffect(() => {
    if (!profile?.active) return;
    return onSnapshot(doc(db, 'settings', 'reports'), (snap) => {
      setState({ settings: (snap.data() as ReportSettings | undefined) ?? {}, exists: snap.exists(), ready: true });
    }, () => setState((s) => ({ ...s, ready: true })));
  }, [profile?.active]);
  return state;
}
