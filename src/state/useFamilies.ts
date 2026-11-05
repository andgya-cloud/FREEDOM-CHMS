import { useMemo } from 'react';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import { createStamps, updateRecord } from '../lib/records';
import { trackWrite } from '../lib/sync';
import { updatePerson } from '../lib/peopleWrites';
import type { Person } from './PeopleContext';
import { roleOf, type FamilyRole } from '../../functions/src/shared/families';

interface HouseholdDoc { id: string; kind: 'family' | 'notFamily'; name: string | null; weddingDate?: string | null; deletedAt?: unknown }

/** Family names and the suggestions answered "No" (Andy, 2026-11-01, 4A 5A). */
export function useHouseholds(orgId: string) {
  const { can } = useAuth();
  const allowed = can('people.read');
  const { rows } = useLiveQuery<HouseholdDoc>(
    () => (orgId && allowed ? collection(db, 'organizations', orgId, 'households') : null),
    [orgId, allowed],
  );
  return useMemo(() => {
    const names = new Map<string, string>();
    const weddings = new Map<string, string>();
    const dismissed = new Set<string>();
    const existing = new Set<string>();
    for (const r of rows) {
      existing.add(r.id);
      if (r.kind === 'family' && r.name) names.set(r.id, r.name);
      if (r.kind === 'family' && r.weddingDate) weddings.set(r.id, r.weddingDate);
      if (r.kind === 'notFamily') dismissed.add(r.id.replace(/^no_/, ''));
    }
    return { names, weddings, dismissed, existing };
  }, [rows]);
}

function saveHousehold(orgId: string, id: string, exists: boolean, data: { kind: 'family' | 'notFamily'; name?: string | null; weddingDate?: string | null }) {
  const ref = doc(db, 'organizations', orgId, 'households', id);
  return exists ? updateRecord(ref, data) : trackWrite(setDoc(ref, { orgId, name: null, ...data, ...createStamps() }));
}

/** The couple's wedding date, "YYYY-MM-DD", or null to clear it (Andy, 2026-11-01, anniversaries A). */
export function setWeddingDate(orgId: string, householdId: string, exists: boolean, date: string | null) {
  return saveHousehold(orgId, householdId, exists, { kind: 'family', weddingDate: date || null });
}

/** Puts `member` into `anchor`'s family, starting one when the anchor has none. */
export function addToFamily(anchor: Person, member: Person, role: FamilyRole) {
  const householdId = anchor.householdId ?? anchor.id;
  const writes: Promise<unknown>[] = [];
  if (anchor.householdId !== householdId || !anchor.familyRole) {
    writes.push(updatePerson(anchor.orgId, anchor.id, { householdId, familyRole: anchor.familyRole ?? roleOf(anchor) }));
  }
  writes.push(updatePerson(member.orgId, member.id, { householdId, familyRole: role }));
  return Promise.all(writes);
}

export function setFamilyRole(person: Person, role: FamilyRole) {
  return updatePerson(person.orgId, person.id, { familyRole: role });
}

export function removeFromFamily(person: Person) {
  return updatePerson(person.orgId, person.id, { householdId: null, familyRole: null });
}

export function renameFamily(orgId: string, householdId: string, exists: boolean, name: string) {
  return saveHousehold(orgId, householdId, exists, { kind: 'family', name: name.trim() || null });
}

export function notSameFamily(orgId: string, key: string, exists: boolean) {
  return saveHousehold(orgId, `no_${key}`, exists, { kind: 'notFamily', name: null });
}
