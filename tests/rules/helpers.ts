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
    await setDoc(doc(db, 'settings/pipeline'), {
      stages: [], sensitiveStageIds: ['salvation', 'baptism'], createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor',
    });
    const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };
    await setDoc(doc(db, 'organizations/fcn/people/p1'), { ...person('fcn'), ...stamps });
    await setDoc(doc(db, 'organizations/adia/people/s1'), { ...person('adia'), fullName: 'Student One', ...stamps });
    await setDoc(doc(db, 'organizations/fcn/pipeline/p1_salvation'), { orgId: 'fcn', personId: 'p1', stageId: 'salvation', sensitive: true, status: 'completed', date: '2026-10-11', notes: '', details: {}, ...stamps });
    await setDoc(doc(db, 'organizations/fcn/pipeline/p1_visitor'), { orgId: 'fcn', personId: 'p1', stageId: 'visitor', sensitive: false, status: 'completed', date: '2026-10-04', notes: '', details: {}, ...stamps });
    await setDoc(doc(db, 'organizations/fcn/prayerRequests/r1'), { orgId: 'fcn', personId: 'p1', text: 'Healing for my mother', status: 'open', ...stamps });
    await setDoc(doc(db, 'organizations/fcn/pastoralNotes/n1'), { orgId: 'fcn', personId: 'p1', text: 'Private note', ...stamps });
    await setDoc(doc(db, 'organizations/fcn/followUps/p1_first_visit'), { orgId: 'fcn', personId: 'p1', reason: 'first_visit', status: 'open', ...stamps });
    await setDoc(doc(db, 'auditLog/one'), { action: 'create', at: old, actorUid: 'pastor', orgId: 'fcn' });
  });
}

export function person(orgId: string, overrides: Record<string, unknown> = {}) {
  return {
    orgId, fullName: 'Grace Wanjiku', firstName: 'Grace', phone: '+254712345678', whatsapp: '+254712345678',
    whatsappConsent: { given: true, date: '2026-10-17', recordedBy: 'admin', stoppedAt: null },
    status: 'visitor', firstVisitDate: '2026-10-17', possibleDuplicateIds: [], customFields: {},
    ...overrides,
  };
}

export function created(uid: string) {
  return { deletedAt: null, deletedBy: null, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid };
}

export function newOrg(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Freedom Church Mombasa', type: 'church_campus', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES',
    receiptPrefix: 'FCM', active: true, deletedAt: null, deletedBy: null,
    createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid,
    ...overrides,
  };
}
