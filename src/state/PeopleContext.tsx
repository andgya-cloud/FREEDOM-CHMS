import type { PersonAbout, SignupMark } from '../../functions/src/shared/familySignup';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, collectionGroup, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useOrg } from './OrgContext';
import type { PersonStatus } from '../../functions/src/shared/people';
import { ESTIMATE } from '../lib/firestoreOptions';

export interface WhatsAppConsent {
  given: boolean;
  /** YYYY-MM-DD the answer was recorded */
  date: string | null;
  recordedBy: string | null;
  /** Set when the person asked us to stop. */
  stoppedAt?: string | null;
}

export interface Person {
  id: string;
  orgId: string;
  fullName: string;
  firstName: string;
  phone: string | null;
  whatsapp: string | null;
  whatsappConsent: WhatsAppConsent;
  email?: string | null;
  status: PersonStatus;
  firstVisitDate?: string | null;
  gender?: string | null;
  /** "MM-DD", no year. */
  birthday?: string | null;
  /** Optional; orders a family's children (Andy, 2026-11-01). */
  birthYear?: number | null;
  /** The day they became a Member, "YYYY-MM-DD" (Andy, 2026-11-02, 5A). */
  memberSince?: string | null;
  /** From the family sign-up form, until Andrew or Doreen confirm (Andy, 2026-11-02). */
  signup?: SignupMark | null;
  householdId?: string | null;
  familyRole?: 'parent' | 'spouse' | 'child' | null;
  guardianId?: string | null;
  howHeard?: string | null;
  invitedBy?: string | null;
  invitedById?: string | null;
  serviceAttended?: string | null;
  /** Answers from the family sign-up form: marital status, age range, born again, baptised… (Andy, 2026-11-02). */
  about?: Partial<PersonAbout> | null;
  customFields?: Record<string, unknown>;
  possibleDuplicateIds?: string[];
  deletedAt: Timestamp | null;
  createdAt?: Timestamp;
  createdBy?: string;
  updatedAt?: Timestamp;
}

interface PeopleValue {
  people: Person[];
  /** Includes the bin. */
  allIncludingDeleted: Person[];
  loading: boolean;
  byId: (id: string) => Person | undefined;
}

const PeopleContext = createContext<PeopleValue | null>(null);

/**
 * Keeps the selected organization's people on the device, so search is
 * instant and works offline. In the combined view it reads every organization.
 */
export function PeopleProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const { currentId, isCombined, organizations } = useOrg();
  const practiceIds = organizations.filter((o) => o.training).map((o) => o.id).join(',');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const allowed = can('people.read');

  useEffect(() => {
    setPeople([]);
    if (!allowed || !currentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const source = isCombined ? collectionGroup(db, 'people') : collection(db, 'organizations', currentId, 'people');
    return onSnapshot(source, { includeMetadataChanges: false }, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as Person);
      // Practice people never mix into the combined view.
      setPeople(isCombined ? rows.filter((p) => !practiceIds.split(',').includes(p.orgId)) : rows);
      setLoading(false);
    }, () => setLoading(false));
  }, [allowed, currentId, isCombined, practiceIds]);

  const value = useMemo<PeopleValue>(() => {
    const live = people.filter((p) => !p.deletedAt).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const index = new Map(people.map((p) => [p.id, p]));
    return { people: live, allIncludingDeleted: people, loading, byId: (id) => index.get(id) };
  }, [people, loading]);

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople(): PeopleValue {
  const v = useContext(PeopleContext);
  if (!v) throw new Error('usePeople outside PeopleProvider');
  return v;
}
