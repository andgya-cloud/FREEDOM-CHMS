import { useEffect } from 'react';
import { closedNow, saveExamCohort } from './examWrites';

/**
 * A cohort opened only to key in past results is remembered in this tab (Andy, 2026-11-01, 5A), so a reload or a
 * jump elsewhere still closes it: the past results page takes it back over, anywhere else closes it.
 */
const KEY = 'pastResultsOpen';
type Opened = { orgId: string; cohort: string };

export function rememberOpened(v: Opened | null) {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode: the three-hour limit still closes it */ }
}

export function openedInThisTab(): Opened | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Opened) : null;
  } catch {
    return null;
  }
}

/** In the app shell: away from the past results page, close a cohort this tab left open. */
export function useCloseLeftOpen(pathname: string, byName: string) {
  useEffect(() => {
    if (pathname.startsWith('/school/exams/past')) return;
    const left = openedInThisTab();
    if (!left) return;
    rememberOpened(null);
    saveExamCohort(left.orgId, left.cohort, true, { closed: true, closedAt: closedNow(), closedByName: byName, autoCloseAt: null }).catch(() => {});
  }, [pathname, byName]);
}
