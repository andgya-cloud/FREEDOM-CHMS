import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { AccessProfile, Permission } from './shared/permissions.js';
import { can } from './shared/permissions.js';

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue };

export interface UserProfile extends AccessProfile {
  email: string;
  displayName: string;
  roleId: string;
  extraPermissions: string[];
  orgIds: string[];
  allOrgs: boolean;
  permissions: string[];
  mustChangePassword?: boolean;
  /** Petty cash voucher title, such as Accountant; '' for none. */
  pettyTitle?: string;
}

export interface Caller {
  uid: string;
  email: string;
  profile: UserProfile;
}

/** Loads the signed-in caller and checks they are active (and hold `permission`, if given). */
export async function requireCaller(request: CallableRequest, permission?: Permission): Promise<Caller> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  const profile = snap.data() as UserProfile | undefined;
  if (!profile || !profile.active) throw new HttpsError('permission-denied', 'This account is not active.');
  if (permission && !can(profile, permission)) {
    throw new HttpsError('permission-denied', 'You do not have permission to do that.');
  }
  return { uid: request.auth.uid, email: profile.email, profile };
}

export interface AuditEntry {
  actorUid: string | null;
  actorEmail?: string | null;
  action: string;
  path: string;
  collection: string;
  docId: string;
  orgId: string | null;
  changedFields?: string[];
  note?: string;
}

/** Writes an audit-log entry. Values are never copied, only field names, to keep sensitive data out of the log. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.collection('auditLog').add({
    ...entry,
    actorEmail: entry.actorEmail ?? null,
    changedFields: entry.changedFields ?? [],
    note: entry.note ?? null,
    at: FieldValue.serverTimestamp(),
  });
}

export function requireString(value: unknown, field: string, { min = 1, max = 200 } = {}): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new HttpsError('invalid-argument', `Please check ${field}.`);
  }
  return value.trim();
}

export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new HttpsError('invalid-argument', `Please check ${field}.`);
  }
  return [...new Set(value as string[])];
}
