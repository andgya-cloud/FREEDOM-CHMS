import { useMemo } from 'react';
import { collection, documentId, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import type { Organization } from './OrgContext';
import { useLiveQuery } from '../lib/useQuery';
import { localDateKey } from '../../functions/src/shared/datetime';
import { activitiesFor } from '../../functions/src/shared/attendance';
import { hopeMetrics, type Child, type SessionEvent, type SessionRecord } from '../../functions/src/shared/hope';
import type { Champion, ChampionDay, HopeDay } from '../../functions/src/shared/hopeRegister';
import type { ChampionExtra } from '../../functions/src/shared/hopeChampionPay';
import type { Club, ClubDay, ClubWin } from '../../functions/src/shared/hopeClubs';
import type { MealDay } from '../../functions/src/shared/hopeRecords';

export interface ChildRow extends Child { orgId: string; createdAt?: Timestamp }
export interface ChildPrivate { id: string; welfare: string; health: string; home: string }
export interface HomeVisit { id: string; childId: string; date: string; note: string; createdBy: string; deletedAt?: unknown }
export interface Referral { id: string; childId: string; date: string; to: string; reason: string; status: 'open' | 'closed'; outcome: string; deletedAt?: unknown }
export interface Concern { id: string; childId: string; summary: string; status: 'open' | 'closed'; closingNote?: string; createdBy: string; createdAt?: Timestamp }
export interface ChildExport { id: string; scope: 'register' | 'attendance'; reason: string; status: 'pending' | 'approved' | 'denied'; createdBy: string; createdAt?: Timestamp; decidedBy?: string; downloadedAt?: Timestamp | null }
export interface AbsenceTask { id: string; personId: string; personName: string; status: 'open' | 'done'; outcome: string | null; absentSince?: string | null; note?: string; deletedAt?: unknown }
export interface StoredHopeReport { id: string; type: 'weekly' | 'monthly'; audience: 'pastor' | 'counts'; from: string; to: string; label: string; generatedAt?: Timestamp }

const col = (orgId: string, name: string) => collection(db, 'organizations', orgId, name);
const live = <T extends object>(rows: T[]) => rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);

/**
 * Everything the Hope Center screens show, live and available offline. Pastor-only records (concerns,
 * welfare notes) are only asked for by the pastor: the server would refuse them for anyone else.
 */
export function useHope(org: Organization) {
  const { profile, can } = useAuth();
  const orgId = org.id;
  const on = !!orgId && !!profile?.active;
  const pastoral = can('pastoral.read');
  const followUps = can('followups.manage');
  const today = localDateKey(new Date(), org.timeZone);

  const children = useLiveQuery<ChildRow>(() => (on ? col(orgId, 'children') : null), [orgId, on]);
  const events = useLiveQuery<SessionEvent>(() => (on ? col(orgId, 'events') : null), [orgId, on]);
  const records = useLiveQuery<SessionRecord>(() => (on ? col(orgId, 'attendance') : null), [orgId, on]);
  const tasks = useLiveQuery<AbsenceTask>(() => (on && followUps ? query(col(orgId, 'followUps'), where('reason', '==', 'child_absent')) : null), [orgId, on, followUps]);
  const concerns = useLiveQuery<Concern>(() => (on && pastoral ? query(col(orgId, 'safeguardingConcerns'), where('status', '==', 'open')) : null), [orgId, on, pastoral]);

  const programmes = useMemo(() => activitiesFor({ type: org.type, activities: org.activities }), [org.type, org.activities]);
  const kids = useMemo(() => live(children.rows), [children.rows]);
  const absenceTasks = useMemo(() => live(tasks.rows), [tasks.rows]);
  const metrics = useMemo(() => {
    // The numbers on the home screen are this month so far; reports cover whole weeks and months.
    const period = { from: `${today.slice(0, 7)}-01`, to: today };
    return hopeMetrics({
      children: kids, programmes, events: live(events.rows), records: live(records.rows), today,
      absenceTasks: absenceTasks.map((t) => ({ status: t.status, outcome: t.outcome })),
    }, period);
  }, [kids, programmes, events.rows, records.rows, absenceTasks, today]);

  return {
    children: kids,
    programmes,
    events: live(events.rows),
    records: live(records.rows),
    absenceTasks,
    openConcerns: concerns.rows,
    metrics,
    today,
    pastoral,
    loading: children.loading,
  };
}
export type HopeData = ReturnType<typeof useHope>;

/** One child's private records (pastor only). */
export function useChildPrivate(orgId: string, childId: string) {
  const { can, profile } = useAuth();
  const on = !!orgId && !!childId && !!profile?.active && can('pastoral.read');
  const priv = useLiveQuery<ChildPrivate>(() => (on ? query(col(orgId, 'childPrivate'), where(documentId(), '==', childId)) : null), [orgId, childId, on]);
  const visits = useLiveQuery<HomeVisit>(() => (on ? query(col(orgId, 'homeVisits'), where('childId', '==', childId)) : null), [orgId, childId, on]);
  const referrals = useLiveQuery<Referral>(() => (on ? query(col(orgId, 'referrals'), where('childId', '==', childId)) : null), [orgId, childId, on]);
  const concerns = useLiveQuery<Concern>(() => (on ? query(col(orgId, 'safeguardingConcerns'), where('childId', '==', childId)) : null), [orgId, childId, on]);
  return {
    private: priv.rows[0] ?? null,
    visits: live(visits.rows).sort((a, b) => b.date.localeCompare(a.date)),
    referrals: live(referrals.rows).sort((a, b) => b.date.localeCompare(a.date)),
    concerns: concerns.rows,
    loading: priv.loading,
  };
}

/** Export requests: the pastor sees all, anyone else sees their own. */
export function useChildExports(orgId: string) {
  const { can, profile, user } = useAuth();
  const on = !!orgId && !!profile?.active && !!user;
  const all = can('data.export');
  const { rows, loading } = useLiveQuery<ChildExport>(
    () => (on ? (all ? col(orgId, 'childExports') : query(col(orgId, 'childExports'), where('createdBy', '==', user!.uid))) : null), [orgId, on, all, user?.uid]);
  return { requests: [...rows].sort((a, b) => (b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER) - (a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER)), loading };
}

/** Just the register, for screens that only need to know who the children are (the session register). */
export function useChildren(orgId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const { rows, loading } = useLiveQuery<ChildRow>(() => (on ? col(orgId, 'children') : null), [orgId, on]);
  return { children: live(rows), loading };
}

/** Open safeguarding concerns for the home screen. Only the pastor's account is allowed to ask. */
export function useOpenConcerns(orgId: string) {
  const { can, profile } = useAuth();
  const on = !!orgId && !!profile?.active && can('pastoral.read');
  return useLiveQuery<Concern>(() => (on ? query(col(orgId, 'safeguardingConcerns'), where('status', '==', 'open')) : null), [orgId, on]).rows;
}

/** The children's weekly register: one record a day. */
export function useHopeDays(orgId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const { rows, loading } = useLiveQuery<HopeDay & { id: string }>(() => (on ? col(orgId, 'hopeDays') : null), [orgId, on]);
  return { days: useMemo(() => live(rows), [rows]), loading };
}

/** Meals served each day (Andy, 2026-11-05): counts of breakfast, lunch and fruit. */
export function useHopeMeals(orgId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const { rows, loading } = useLiveQuery<MealDay & { id: string }>(() => (on ? col(orgId, 'hopeMeals') : null), [orgId, on]);
  return { meals: useMemo(() => live(rows).sort((a, b) => b.date.localeCompare(a.date)), [rows]), loading };
}

/** When each helper arrived, for one day (Andy, 2026-11-04, 2A). */
export function useHelperDay(orgId: string, date: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const { rows, loading } = useLiveQuery<{ id: string; date: string; marks?: Record<string, { name: string; t: string }> }>(() => (on ? query(col(orgId, 'helperDays'), where('date', '==', date)) : null), [orgId, on, date]);
  const marks = rows[0]?.marks ?? {};
  return { helpers: useMemo(() => Object.entries(marks).map(([uid, m]) => ({ uid, ...m })).sort((a, b) => a.t.localeCompare(b.t)), [marks]), loading };
}

/** The Child Champions and their weekly register. */
export function useChampions(orgId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const people = useLiveQuery<Champion>(() => (on ? col(orgId, 'champions') : null), [orgId, on]);
  const days = useLiveQuery<ChampionDay & { id: string }>(() => (on ? col(orgId, 'championDays') : null), [orgId, on]);
  const champions = useMemo(() => live(people.rows).sort((a, b) => a.name.localeCompare(b.name)), [people.rows]);
  return { champions, days: useMemo(() => live(days.rows), [days.rows]), loading: people.loading || days.loading };
}

/** Champions' extra allowances and the approved months (Andy, 2026-11-05, 9A 10A). */
export function useChampionPay(orgId: string, enabled = true) {
  const { profile } = useAuth();
  const on = enabled && !!orgId && !!profile?.active;
  const extras = useLiveQuery<ChampionExtra>(() => (on ? col(orgId, 'championExtras') : null), [orgId, on]);
  const approved = useLiveQuery<{ id: string; month: string; total: number; count: number; approvedName: string; approvedAt?: Timestamp }>(() => (on ? col(orgId, 'championPay') : null), [orgId, on]);
  return { extras: useMemo(() => live(extras.rows), [extras.rows]), approved: approved.rows };
}

/** Children's photos, by child id. Only children with photo consent have one. */
export function useChildPhotos(orgId: string, enabled = true) {
  const { profile } = useAuth();
  const on = enabled && !!orgId && !!profile?.active;
  const { rows } = useLiveQuery<{ id: string; photo: string }>(() => (on ? col(orgId, 'childPhotos') : null), [orgId, on]);
  return useMemo(() => new Map(rows.map((r) => [r.id, r.photo])), [rows]);
}
export function useChildPhoto(orgId: string, childId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!childId && !!profile?.active;
  const { rows } = useLiveQuery<{ id: string; photo: string }>(() => (on ? query(col(orgId, 'childPhotos'), where(documentId(), '==', childId)) : null), [orgId, childId, on]);
  return rows[0]?.photo ?? null;
}

/** The clubs, every club register day and the wins log. */
export function useClubs(orgId: string) {
  const { profile } = useAuth();
  const on = !!orgId && !!profile?.active;
  const clubs = useLiveQuery<Club>(() => (on ? col(orgId, 'clubs') : null), [orgId, on]);
  const days = useLiveQuery<ClubDay & { id: string }>(() => (on ? col(orgId, 'clubDays') : null), [orgId, on]);
  const wins = useLiveQuery<ClubWin>(() => (on ? col(orgId, 'clubWins') : null), [orgId, on]);
  return {
    clubs: useMemo(() => live(clubs.rows).sort((a, b) => a.name.localeCompare(b.name)), [clubs.rows]),
    days: useMemo(() => live(days.rows), [days.rows]),
    wins: useMemo(() => live(wins.rows).sort((a, b) => b.date.localeCompare(a.date)), [wins.rows]),
    loading: clubs.loading,
  };
}
