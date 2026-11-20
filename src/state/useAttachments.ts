import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLiveQuery } from '../lib/useQuery';
import type { Attachment } from '../../functions/src/shared/attachment';

export type AttachmentRow = Attachment & { id: string; deletedAt?: unknown };
export interface AttachmentFilesRow { id: string; studentId: string; logbook?: { size: number } | null; form?: { size: number } | null; nita?: { size: number } | null }

/** Every student's industrial attachment record and which copies are kept (Andy, 2026-11-19), by student. */
export function useAttachments(orgId: string) {
  const { profile, can } = useAuth();
  const on = !!orgId && !!profile?.active && (can('people.read') || can('attendance.write'));
  const recs = useLiveQuery<AttachmentRow>(() => (on ? collection(db, 'organizations', orgId, 'attachments') : null), [orgId, on]);
  const files = useLiveQuery<AttachmentFilesRow>(() => (on ? collection(db, 'organizations', orgId, 'attachmentFiles') : null), [orgId, on]);
  // Kept the same object until the records change, so pages that work out results from it don't redo the work.
  const byStudent = useMemo(() => {
    const out: Record<string, AttachmentRow> = {};
    for (const r of recs.rows) if (!r.deletedAt) out[r.id] = r;
    return out;
  }, [recs.rows]);
  const filesOf: Record<string, AttachmentFilesRow> = {};
  for (const f of files.rows) filesOf[f.id] = f;
  return { byStudent, filesOf, loading: recs.loading };
}
