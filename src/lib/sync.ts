import { useSyncExternalStore } from 'react';
import { waitForPendingWrites } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Tracks whether the device is online and how many local changes are still
 * waiting to reach the server. Firestore keeps queued writes on the device,
 * even across restarts; this store only drives the status badge.
 */
interface SyncState {
  online: boolean;
  pending: number;
  lastSyncedAt: Date | null;
}

let state: SyncState = { online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0, lastSyncedAt: null };
const listeners = new Set<() => void>();

function set(next: Partial<SyncState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers a write that may still be queued. The promise settles when the server has it. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  set({ pending: state.pending + 1 });
  write.then(
    () => set({ pending: Math.max(0, state.pending - 1), lastSyncedAt: new Date() }),
    () => set({ pending: Math.max(0, state.pending - 1) }),
  );
  return write;
}

let started = false;
export function startSyncMonitor() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => set({ online: true }));
  window.addEventListener('offline', () => set({ online: false }));
  // Writes queued before the app was last closed are not in our counter;
  // count them as one "pending" item until Firestore confirms they synced.
  set({ pending: state.pending + 1 });
  waitForPendingWrites(db).then(
    () => set({ pending: Math.max(0, state.pending - 1), lastSyncedAt: new Date() }),
    () => set({ pending: Math.max(0, state.pending - 1) }),
  );
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
