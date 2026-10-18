import type { SnapshotOptions } from 'firebase/firestore';

/**
 * Read a not-yet-synced server time as the device's estimate instead of null.
 * Without this, something deleted offline (deletedAt = server time) would
 * still look current until the internet came back.
 */
export const ESTIMATE: SnapshotOptions = { serverTimestamps: 'estimate' };
