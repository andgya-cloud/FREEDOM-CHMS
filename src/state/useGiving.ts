import { collection, doc, documentId, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
import { useAuth } from './AuthContext';
import type { GiftMethod, GiftStatus, UnassignedReason } from '../../functions/src/shared/giving';

export interface Fund {
  id: string;
  orgId: string;
  name: string;
  aliases: string[];
  active: boolean;
  deletedAt: Timestamp | null;
}

export interface Gift {
  id: string;
  orgId: string;
  personId: string | null;
  giverName: string;
  phone: string | null;
  /** YYYY-MM-DD the money was received */
  date: string;
  amountCents: number;
  fundId: string | null;
  method: GiftMethod;
  mpesaCode: string | null;
  accountRef: string;
  status: GiftStatus;
  unassignedReason: UnassignedReason | null;
  receivedBy: string;
  receivedByName: string;
  handledBy: string | null;
  notes: string;
  importId: string | null;
  receiptNumber: string | null;
  receiptIssuedAt: Timestamp | null;
  voidReason: string | null;
  voidedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  createdAt?: Timestamp;
  createdBy: string;
}

export interface LedgerTotal { cents: number; count: number }

export interface LedgerMonth {
  id: string;
  month: string;
  totalCents?: number;
  count?: number;
  funds?: Record<string, LedgerTotal>;
  methods?: Partial<Record<GiftMethod, LedgerTotal>>;
  unassigned?: { methods?: Partial<Record<GiftMethod, LedgerTotal>> };
}

export interface StatementLine {
  id: string;
  date: string;
  amountCents: number;
  importId: string;
}

export interface GiftImport {
  id: string;
  fileName: string;
  firstDate: string | null;
  lastDate: string | null;
  statementTotalCents: number;
  paymentCount: number;
  importedCount: number;
  importedCents: number;
  duplicateCount: number;
  duplicateCents: number;
  unassignedCount: number;
  skippedCount: number;
  createdAt?: Timestamp;
  createdBy: string;
}

const live = <T extends { deletedAt?: unknown }>(r: T) => !r.deletedAt;
const newestFirst = (a: Gift, b: Gift) => b.date.localeCompare(a.date) || (b.createdAt?.toMillis() ?? Infinity) - (a.createdAt?.toMillis() ?? Infinity);

export function useFunds(orgId: string) {
  const { rows, loading } = useLiveQuery<Fund>(() => (orgId ? collection(db, 'organizations', orgId, 'funds') : null), [orgId]);
  const funds = rows.filter(live).sort((a, b) => a.name.localeCompare(b.name));
  return { funds, active: funds.filter((f) => f.active), loading };
}

/** Payments waiting for a person or fund. Everyone who records gifts sees these. */
export function useUnassignedGifts(orgId: string) {
  const { rows, loading } = useLiveQuery<Gift>(
    () => (orgId ? query(collection(db, 'organizations', orgId, 'gifts'), where('status', '==', 'unassigned')) : null),
    [orgId],
  );
  return { gifts: rows.filter(live).sort(newestFirst), loading };
}

/**
 * Gifts this person may see in the list: all of them for the pastor (or
 * anyone allowed per-person giving) within the dates; otherwise only the
 * gifts they recorded or confirmed themselves.
 */
export function useRecentGifts(orgId: string, since: string) {
  const { profile, can } = useAuth();
  const uid = profile?.uid ?? '';
  const all = can('giving.person.read');
  const byDate = useLiveQuery<Gift>(
    () => (orgId && all ? query(collection(db, 'organizations', orgId, 'gifts'), where('date', '>=', since)) : null),
    [orgId, all, since],
  );
  const mine = useLiveQuery<Gift>(
    () => (orgId && !all && uid ? query(collection(db, 'organizations', orgId, 'gifts'), where('createdBy', '==', uid)) : null),
    [orgId, all, uid],
  );
  const handled = useLiveQuery<Gift>(
    () => (orgId && !all && uid ? query(collection(db, 'organizations', orgId, 'gifts'), where('handledBy', '==', uid)) : null),
    [orgId, all, uid],
  );
  const gifts = useMemo(() => {
    const merged = new Map<string, Gift>();
    for (const g of [...byDate.rows, ...mine.rows, ...handled.rows]) merged.set(g.id, g);
    return [...merged.values()].filter((g) => live(g) && g.status !== 'unassigned' && g.date >= since).sort(newestFirst);
  }, [byDate.rows, mine.rows, handled.rows, since]);
  return { gifts, loading: byDate.loading || mine.loading || handled.loading };
}

/** One person's giving. Only for staff allowed to see per-person giving. */
export function usePersonGifts(orgId: string, personId: string) {
  const { can } = useAuth();
  const allowed = can('giving.person.read');
  const { rows, loading } = useLiveQuery<Gift>(
    () => (orgId && personId && allowed ? query(collection(db, 'organizations', orgId, 'gifts'), where('personId', '==', personId)) : null),
    [orgId, personId, allowed],
  );
  return { gifts: rows.filter(live).sort(newestFirst), loading };
}

/** Gifts between two dates (YYYY-MM-DD, inclusive), for statements and reports. Pastor only. */
export function useGiftsBetween(orgId: string, from: string, to: string, enabled = true) {
  const { can } = useAuth();
  const allowed = can('giving.person.read') && enabled;
  const { rows, loading } = useLiveQuery<Gift>(
    () => (orgId && allowed && from && to
      ? query(collection(db, 'organizations', orgId, 'gifts'), where('date', '>=', from), where('date', '<=', to))
      : null),
    [orgId, allowed, from, to],
  );
  return { gifts: rows.filter(live).sort(newestFirst), loading };
}

export function useGift(orgId: string, giftId: string) {
  const [gift, setGift] = useState<Gift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!orgId || !giftId) return;
    setLoading(true);
    return onSnapshot(doc(db, 'organizations', orgId, 'gifts', giftId), (snap) => {
      setGift(snap.exists() ? ({ id: snap.id, ...snap.data(ESTIMATE) } as Gift) : null);
      setLoading(false);
      setError('');
    }, (err) => {
      setError(err.code);
      setLoading(false);
    });
  }, [orgId, giftId]);
  return { gift, loading, error };
}

export function useLedgerMonth(orgId: string, month: string) {
  const [ledger, setLedger] = useState<LedgerMonth | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!orgId || !month) return;
    setLoading(true);
    return onSnapshot(doc(db, 'organizations', orgId, 'ledger', month), (snap) => {
      setLedger(snap.exists() ? ({ id: snap.id, ...snap.data(ESTIMATE) } as LedgerMonth) : null);
      setLoading(false);
    }, () => setLoading(false));
  }, [orgId, month]);
  return { ledger, loading };
}

/** The ledger months from `from` to `to` (YYYY-MM, both included), for the dashboards. */
export function useLedgerMonths(orgId: string, from: string, to: string) {
  const { rows, loading } = useLiveQuery<LedgerMonth>(
    () => (orgId ? query(collection(db, 'organizations', orgId, 'ledger'), where(documentId(), '>=', from), where(documentId(), '<=', to)) : null),
    [orgId, from, to],
  );
  return { months: rows, loading };
}

/** Statement lines imported for a date range, by M-Pesa code. */
export function useStatementLines(orgId: string, from: string, to: string) {
  const { rows, loading } = useLiveQuery<StatementLine>(
    () => (orgId ? query(collection(db, 'organizations', orgId, 'statementLines'), where('date', '>=', from), where('date', '<=', to)) : null),
    [orgId, from, to],
  );
  return { lines: rows, loading };
}

export function useGiftImports(orgId: string) {
  const { rows, loading } = useLiveQuery<GiftImport>(() => (orgId ? collection(db, 'organizations', orgId, 'giftImports') : null), [orgId]);
  return { imports: rows.sort((a, b) => (b.createdAt?.toMillis() ?? Infinity) - (a.createdAt?.toMillis() ?? Infinity)), loading };
}

export interface GiftReview {
  id: string;
  giftId: string;
  giverName: string;
  personId: string | null;
  date: string;
  amountCents: number;
  fundId: string | null;
  method: GiftMethod;
  mpesaCode: string | null;
  notes: string;
  savedAt: string;
  reason: string;
  status: 'open' | 'resolved';
  createdBy: string;
}

/** Gifts a device saved that the server refused, waiting for someone to check them. */
export function useOpenReviews(orgId: string) {
  const { can } = useAuth();
  const allowed = can('gifts.write') || can('giving.person.read');
  const { rows } = useLiveQuery<GiftReview>(
    () => (orgId && allowed ? query(collection(db, 'organizations', orgId, 'giftReviews'), where('status', '==', 'open')) : null),
    [orgId, allowed],
  );
  return rows;
}
