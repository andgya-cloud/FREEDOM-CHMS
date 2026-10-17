import { useSyncState } from '../lib/sync';
import { formatDateTime } from '../../functions/src/shared/datetime';

export function SyncBadge() {
  const { online, pending, lastSyncedAt } = useSyncState();
  let label: string;
  let tone: 'ok' | 'busy' | 'offline';
  if (!online) {
    label = pending > 0 ? 'Offline, will sync' : 'Offline';
    tone = 'offline';
  } else if (pending > 0) {
    label = 'Syncing…';
    tone = 'busy';
  } else {
    label = 'All saved';
    tone = 'ok';
  }
  const title = lastSyncedAt ? `Last synced ${formatDateTime(lastSyncedAt)}` : 'Changes save on this device first, then sync.';
  return (
    <span className={`sync-badge sync-${tone}`} title={title} aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
