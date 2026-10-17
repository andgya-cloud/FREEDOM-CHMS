import { useSyncState } from './sync';

/** "Saved" online; "Saved on this device. It will sync when you're back online." offline. */
export function useSavedMessage() {
  const { online } = useSyncState();
  return (what = 'Saved') => (online ? `${what}.` : `${what} on this device. It will sync when you're back online.`);
}
