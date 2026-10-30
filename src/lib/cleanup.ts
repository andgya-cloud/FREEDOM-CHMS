import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { friendlyError } from './errors';
import type { BinState, CleanupKind } from '../../functions/src/shared/cleanup';

/** Clean-up calls (Andy, 2026-10-30): only Andrew Guya and Doreen; the server checks it. */
export interface FoundRow { id: string; label: string; detail: string; createdAt: number | null; createdByName: string; official: boolean }
export interface CheckedItem { kind: CleanupKind; id: string; label: string; detail: string; official: boolean; linked: Record<string, number>; linkedText: string }
export interface BinRow {
  id: string; kind: CleanupKind; label: string; detail: string; official: boolean; linkedText: string; reason: string;
  deletedByName: string; deletedAt: number; state: BinState; daysLeft: number | null; restoredAt: number | null; restoredByName: string | null;
}
export interface Item { kind: CleanupKind; id: string }

const call = <I, O>(name: string) => async (data: I) => (await httpsCallable<I, O>(functions, name)(data)).data;

export const findEntries = call<{ orgId: string; kind: CleanupKind; text: string; from: string; to: string; testOnly: boolean }, { total: number; rows: FoundRow[] }>('cleanupFind');
export const checkEntries = call<{ orgId: string; items: Item[] }, { items: CheckedItem[]; isDirector: boolean }>('cleanupCheck');
export const removeEntries = call<{ orgId: string; items: Item[]; reason: string; proof?: string }, { removed: number; binIds: string[] }>('cleanupDelete');
export const restoreEntries = call<{ orgId: string; binIds: string[] }, { restored: number }>('cleanupRestore');
export const loadBin = call<{ orgId: string }, { entries: BinRow[]; isDirector: boolean; binDays: number }>('cleanupBin');

/** The server's own words when it refuses, otherwise the usual friendly message. */
export function cleanupError(err: unknown) {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'auth/invalid-credential' || e?.code === 'auth/wrong-password') return 'That password is not right. Please type it again.';
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal' ? e.message.replace(/\s*\[\d+\]$/, '') : friendlyError(err);
}

export const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
