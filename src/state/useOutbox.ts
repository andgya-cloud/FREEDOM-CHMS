import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import type { OutboxStatus } from '../../functions/src/shared/whatsapp';

/** An automatic WhatsApp message for a follow-up, with its delivery state. Created and sent by Cloud Functions. */
export interface OutboxItem {
  id: string;
  orgId: string;
  followUpId: string;
  templateId: string;
  toName: string;
  viaGuardian: boolean;
  preview: string;
  mode: 'approve' | 'auto';
  status: OutboxStatus;
  error?: string | null;
  approvedByName?: string | null;
  sentAt?: Timestamp | null;
  repliedAt?: Timestamp | null;
}

/** The automatic message for one follow-up, if there is one. Each follow-up has at most one, with the same id. */
export function useOutboxItem(orgId: string, followUpId: string): OutboxItem | null {
  const { can } = useAuth();
  const allowed = can('followups.manage');
  const [item, setItem] = useState<OutboxItem | null>(null);
  useEffect(() => {
    if (!allowed) return;
    return onSnapshot(
      doc(db, 'organizations', orgId, 'whatsappOutbox', followUpId),
      (snap) => setItem(snap.exists() ? ({ id: snap.id, ...snap.data() } as OutboxItem) : null),
      () => setItem(null),
    );
  }, [allowed, orgId, followUpId]);
  return item;
}
