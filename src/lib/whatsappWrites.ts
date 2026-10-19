import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, updateRecord } from './records';
import { trackWrite } from './sync';
import type { OutboxItem } from '../state/useOutbox';
import type { WhatsAppSettings } from '../../functions/src/shared/whatsapp';

const outboxRef = (i: Pick<OutboxItem, 'orgId' | 'id'>) => doc(db, 'organizations', i.orgId, 'whatsappOutbox', i.id);

/** Staff say yes: a Cloud Function sends the message as soon as it sees this. The approver's first name signs it. */
export function approveOutbox(item: OutboxItem, staffName: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  return updateRecord(outboxRef(item), { status: 'queued', approvedBy: uid, approvedByName: staffName.trim().slice(0, 80) || 'Staff' });
}

export function cancelOutbox(item: OutboxItem) {
  return updateRecord(outboxRef(item), { status: 'cancelled' });
}

/** Saves the WhatsApp automation settings (Settings → WhatsApp automation). The access token is not part of this. */
export async function saveWhatsAppSettings(settings: WhatsAppSettings) {
  const ref = doc(db, 'settings', 'whatsapp');
  const exists = (await getDoc(ref).catch(() => null))?.exists() ?? false;
  const clean = {
    enabled: settings.enabled,
    phoneNumberId: settings.phoneNumberId.trim(),
    modes: settings.modes,
    metaNames: Object.fromEntries(Object.entries(settings.metaNames).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
    language: settings.language.trim() || 'en',
  };
  return exists ? updateRecord(ref, clean) : trackWrite(setDoc(ref, { ...clean, ...createStamps(), updatedAt: serverTimestamp() }));
}
