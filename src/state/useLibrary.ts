import { useMemo } from 'react';
import { collection, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useOrg } from './OrgContext';
import { useLiveDoc, useLiveQuery } from '../lib/useQuery';
import { isLibraryManager } from '../../functions/src/shared/permissions';
import { librarySettings, type LibraryBook, type LibraryLoanRecord, type LibraryMember, type LibrarySettings, type ShelfCheck } from '../../functions/src/shared/library';

/** Who runs the ADIA library (Andy, 2026-11-18, 2A). */
export function useLibraryAccess() {
  const { profile } = useAuth();
  const { current } = useOrg();
  return { manager: current?.type === 'college' && !!profile && isLibraryManager(profile) };
}

const live = <T extends { deletedAt?: unknown }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

/** Every book, loan, member and shelf check of the library, live and on the device so it works offline. */
export function useLibrary(orgId: string) {
  const { manager } = useLibraryAccess();
  const on = !!orgId && manager;
  const col = (name: string) => collection(db, 'organizations', orgId, name);
  const books = useLiveQuery<LibraryBook>(() => (on ? col('libraryBooks') : null), [orgId, on]);
  const loans = useLiveQuery<LibraryLoanRecord>(() => (on ? col('libraryLoans') : null), [orgId, on]);
  const members = useLiveQuery<LibraryMember>(() => (on ? col('libraryMembers') : null), [orgId, on]);
  const checks = useLiveQuery<ShelfCheck>(() => (on ? col('libraryChecks') : null), [orgId, on]);
  const settingsDoc = useLiveDoc<Partial<LibrarySettings>>(() => (on ? doc(db, 'organizations', orgId, 'libraryMeta', 'settings') : null), [orgId, on]);
  return useMemo(() => {
    const b = live(books.rows).sort((x, y) => x.n - y.n);
    return {
      books: b,
      loans: live(loans.rows),
      members: live(members.rows).sort((x, y) => x.name.localeCompare(y.name)),
      checks: live(checks.rows).sort((x, y) => y.startedOn.localeCompare(x.startedOn)),
      settings: librarySettings(settingsDoc.data),
      settingsSaved: !!settingsDoc.data,
      highest: b.reduce((m, x) => Math.max(m, x.n), 0),
      loading: books.loading,
    };
  }, [books.rows, books.loading, loans.rows, members.rows, checks.rows, settingsDoc.data]);
}
export type LibraryData = ReturnType<typeof useLibrary>;
