import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { ESTIMATE } from '../lib/firestoreOptions';
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
export interface CertificateRow { id: string; studentId: string; courseId: string; issuedOn: string; serial?: string }
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
  const on = !!orgId && !!profile?.active;

  const courses = useLiveQuery<CourseRow>(() => (on ? col(orgId, 'courses') : null), [orgId, on]);
  const intakes = useLiveQuery<IntakeRow>(() => (on ? col(orgId, 'intakes') : null), [orgId, on]);
  const students = useLiveQuery<StudentRow>(() => (on ? col(orgId, 'students') : null), [orgId, on]);
  const assessments = useLiveQuery<Assessment & { orgId: string }>(() => (on ? col(orgId, 'assessments') : null), [orgId, on]);
  const marks = useLiveQuery<Mark & { id: string }>(() => (on ? col(orgId, 'marks') : null), [orgId, on]);
  const invoices = useLiveQuery<InvoiceRow>(() => (on && feesAllowed ? col(orgId, 'invoices') : null), [orgId, on, feesAllowed]);
  const balances = useLiveQuery<BalanceRow>(() => (on && feesAllowed ? col(orgId, 'feeBalances') : null), [orgId, on, feesAllowed]);
  const structures = useLiveQuery<FeeStructureRow>(() => (on && feesAllowed ? col(orgId, 'feeStructures') : null), [orgId, on, feesAllowed]);
  const certificates = useLiveQuery<CertificateRow>(() => (on ? col(orgId, 'certificates') : null), [orgId, on]);
  const outcomes = useLiveQuery<OutcomeRow & { deletedAt?: unknown }>(() => (on ? col(orgId, 'outcomes') : null), [orgId, on]);
  const events = useLiveQuery<ClassEvent>(() => (on ? query(col(orgId, 'events'), where('type', '==', 'class')) : null), [orgId, on]);
  const records = useLiveQuery<ClassRecord & { id: string }>(() => (on ? col(orgId, 'attendance') : null), [orgId, on]);

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
    students: live(students.rows),
    assessments: live(assessments.rows).sort((a, b) => b.date.localeCompare(a.date)),
    marks: live(marks.rows),
    invoices: live(invoices.rows),
    balances: balances.rows,
    structures: live(structures.rows),
    certificates: certificates.rows,
    outcomes: live(outcomes.rows),
    events: live(events.rows),
    records: live(records.rows),
    settings,
    settingsSaved: !!settingsRaw,
    feesAllowed,
    loading: courses.loading || students.loading || !settingsReady,
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
