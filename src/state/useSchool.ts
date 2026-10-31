import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
import { useClassEvents } from './useAttendance';
import { TRAINER_ROLE_ID } from '../../functions/src/shared/permissions';
import { COMMON_DEPARTMENT } from '../../functions/src/shared/commonCourses';
import { withDefaults, type FeeItem, type Assessment, type ClassEvent, type ClassRecord, type Course, type Intake, type Invoice, type Mark, type OutcomeStatus, type SchoolSettings, type Student } from '../../functions/src/shared/school';

export interface StudentRow extends Student {
  orgId: string;
  admissionNo?: string | null;
  sponsors?: Sponsor[];
  enrolledOn?: string | null;
  withdrawnOn?: string | null;
  graduatedOn?: string | null;
}
export interface Sponsor { name: string; phone: string; relation?: string; whatsapp?: boolean }
export interface CourseRow extends Course { orgId: string }
export interface IntakeRow extends Intake { orgId: string }
export interface InvoiceRow extends Invoice { orgId: string; voidReason?: string; createdAt?: Timestamp }
export interface BalanceRow { id: string; studentId: string; billedCents: number; paidCents: number; balanceCents: number; oldestDue: string | null }
export interface FeeStructureRow { id: string; courseId: string; intakeId: string; items: FeeItem[]; deletedAt?: unknown }
export interface CertificateRow { id: string; studentId: string; courseId: string; issuedOn: string; serial?: string; file?: { size: number } | null; emailedTo?: string; emailedAt?: unknown }
export interface OutcomeRow { id: string; studentId: string; months: number; due: string; status: OutcomeStatus | null; note: string; recordedOn: string | null }

const col = (orgId: string, name: string) => collection(db, 'organizations', orgId, name);
const live = <T extends object>(rows: T[]) => rows.filter((r) => !(r as { deletedAt?: unknown }).deletedAt);

/**
 * Everything the ADIA screens show, live and available offline. Staff without fee access simply get no
 * invoices or balances (the server refuses those reads), so the same hook serves every screen.
 */
export function useSchool(orgId: string) {
  const { profile, can } = useAuth();
  const [settingsRaw, setSettingsRaw] = useState<Partial<SchoolSettings> | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const feesAllowed = can('gifts.write') || can('finance.reports') || can('giving.person.read');
  // The principal sees each student's balance only (Andy, 2026-10-25).
  const balancesAllowed = feesAllowed || can('fees.balances');
  const on = !!orgId && !!profile?.active;
  // A trainer reads only their department's names-only class list (Andy, 2026-10-28), never people or students.
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const full = on && !trainer;
  // A common-course lecturer also reads the whole class list of each cohort they teach a common course to.
  const roster = useRosters(on && trainer ? orgId : '', [...(profile?.trainerCourseIds ?? []).filter((id) => id !== COMMON_DEPARTMENT), ...(profile?.commonRosters ?? [])]);
  const classEvents = useClassEvents(on && trainer ? orgId : '', profile?.registerClasses ?? []);

  const courses = useLiveQuery<CourseRow>(() => (on ? col(orgId, 'courses') : null), [orgId, on]);
  const intakes = useLiveQuery<IntakeRow>(() => (on ? col(orgId, 'intakes') : null), [orgId, on]);
  const students = useLiveQuery<StudentRow>(() => (full ? col(orgId, 'students') : null), [orgId, full]);
  const assessments = useLiveQuery<Assessment & { orgId: string }>(() => (full ? col(orgId, 'assessments') : null), [orgId, full]);
  const marks = useLiveQuery<Mark & { id: string }>(() => (full ? col(orgId, 'marks') : null), [orgId, full]);
  const invoices = useLiveQuery<InvoiceRow>(() => (full && feesAllowed ? col(orgId, 'invoices') : null), [orgId, full, feesAllowed]);
  const balances = useLiveQuery<BalanceRow>(() => (full && balancesAllowed ? col(orgId, 'feeBalances') : null), [orgId, full, balancesAllowed]);
  const structures = useLiveQuery<FeeStructureRow>(() => (full && feesAllowed ? col(orgId, 'feeStructures') : null), [orgId, full, feesAllowed]);
  const certificates = useLiveQuery<CertificateRow>(() => (full ? col(orgId, 'certificates') : null), [orgId, full]);
  const outcomes = useLiveQuery<OutcomeRow & { deletedAt?: unknown }>(() => (full ? col(orgId, 'outcomes') : null), [orgId, full]);
  const events = useLiveQuery<ClassEvent>(() => (full ? query(col(orgId, 'events'), where('type', '==', 'class')) : null), [orgId, full]);
  const records = useLiveQuery<ClassRecord & { id: string }>(() => (full ? col(orgId, 'attendance') : null), [orgId, full]);

  useEffect(() => {
    setSettingsRaw(null);
    setSettingsReady(false);
    if (!on) return;
    return onSnapshot(doc(db, 'organizations', orgId, 'schoolSettings', 'main'), (snap) => {
      setSettingsRaw(snap.exists() ? (snap.data(ESTIMATE) as Partial<SchoolSettings>) : null);
      setSettingsReady(true);
    }, () => setSettingsReady(true));
  }, [orgId, on]);

  const settings = useMemo(() => withDefaults(settingsRaw), [settingsRaw]);
  return {
    courses: live(courses.rows).sort((a, b) => a.name.localeCompare(b.name)),
    intakes: live(intakes.rows).sort((a, b) => b.startDate.localeCompare(a.startDate)),
    students: trainer ? roster.students : live(students.rows),
    /** Names from a trainer's class list; everyone else takes names from People. */
    rosterNames: roster.names,
    assessments: live(assessments.rows).sort((a, b) => b.date.localeCompare(a.date)),
    marks: live(marks.rows),
    invoices: live(invoices.rows),
    balances: balances.rows,
    structures: live(structures.rows),
    certificates: live(certificates.rows),
    outcomes: live(outcomes.rows),
    events: trainer ? (classEvents.events as unknown as ClassEvent[]) : live(events.rows),
    records: live(records.rows),
    settings,
    settingsSaved: !!settingsRaw,
    feesAllowed,
    balancesAllowed,
    loading: courses.loading || (trainer ? roster.loading : students.loading) || !settingsReady,
  };
}

export type SchoolData = ReturnType<typeof useSchool>;

export interface StoredSchoolReport {
  id: string;
  type: 'weekly' | 'monthly';
  from: string;
  to: string;
  label: string;
  orgName?: string;
  generatedAt?: Timestamp;
}

/** A trainer's departments' names-only class lists (functions/src/rosters.ts), as student rows. */
function useRosters(orgId: string, courseIds: string[]) {
  const key = courseIds.join(',');
  const [lists, setLists] = useState<Record<string, { courseId: string; students: { id: string; name: string; admissionNo: string; intakeId: string; status: string; enrolledOn: string | null; courseId?: string }[] }>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLists({});
    const ids = key ? key.split(',') : [];
    setLoading(!!orgId && ids.length > 0);
    if (!orgId || !ids.length) return;
    const offs = ids.map((id) => onSnapshot(doc(db, 'organizations', orgId, 'rosters', id), (snap) => {
      setLists((m) => ({ ...m, [id]: { courseId: id, students: snap.exists() ? (snap.get('students') ?? []) : [] } }));
      setLoading(false);
    }, () => setLoading(false)));
    return () => offs.forEach((off) => off());
  }, [orgId, key]);
  return useMemo(() => {
    // A cohort's common list names each student's own department; a student on two lists counts once.
    const byId = new Map(Object.values(lists).flatMap((l) => l.students.map((st) => [st.id, { ...st, courseId: st.courseId || l.courseId }] as const)));
    const all = [...byId.values()];
    const students = all.map((st) => ({
      id: st.id, orgId, courseId: st.courseId, intakeId: st.intakeId, level: '', status: st.status, admissionNo: st.admissionNo, enrolledOn: st.enrolledOn,
    }) as StudentRow);
    return { students, names: new Map(all.map((st) => [st.id, st.name])), loading };
  }, [lists, loading, orgId]);
}
