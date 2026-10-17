import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, setLogLevel, Timestamp } from 'firebase/firestore';

setLogLevel('silent');

export const PROJECT_ID = 'demo-freedom-chms';

export async function makeEnv(): Promise<RulesTestEnvironment> {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  });
}

const PASTOR_PERMS = [
  'people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue',
  'followups.manage', 'pastoral.read', 'giving.person.read', 'finance.reports', 'settings.manage',
  'users.manage', 'audit.read', 'data.export',
];
const ADMIN_PERMS = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage'];

const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

/** Seeds users and organizations with rules switched off. */
export async function seed(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const user = (roleId: string, permissions: string[], extra: Record<string, unknown>) => ({
      email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: [], allOrgs: false,
      permissions, active: true, ...extra,
    });
    await setDoc(doc(db, 'users/pastor'), user('pastor', PASTOR_PERMS, { allOrgs: true }));
    await setDoc(doc(db, 'users/admin'), user('admin', ADMIN_PERMS, { orgIds: ['fcn'] }));
    await setDoc(doc(db, 'users/settingsAdmin'), user('admin', [...ADMIN_PERMS, 'settings.manage'], { orgIds: ['fcn'] }));
    await setDoc(doc(db, 'users/inactive'), user('admin', ADMIN_PERMS, { orgIds: ['fcn'], active: false }));
    await setDoc(doc(db, 'roles/pastor'), { name: 'Pastor', isOwner: true, permissions: PASTOR_PERMS, system: true, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' });
    await setDoc(doc(db, 'roles/admin'), { name: 'Admin', isOwner: false, permissions: ADMIN_PERMS, system: true, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' });
    for (const [id, name, type, prefix] of [['fcn', 'Freedom Church Nairobi', 'church_campus', 'FCN'], ['adia', 'ADIA Training Centre', 'college', 'ADIA']] as const) {
      await setDoc(doc(db, `organizations/${id}`), {
        name, type, parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: prefix, active: true,
        deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor',
      });
    }
    await setDoc(doc(db, 'auditLog/one'), { action: 'create', at: old, actorUid: 'pastor', orgId: 'fcn' });
  });
}

export function newOrg(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Freedom Church Mombasa', type: 'church_campus', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES',
    receiptPrefix: 'FCM', active: true, deletedAt: null, deletedBy: null,
    createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid,
    ...overrides,
  };
}
