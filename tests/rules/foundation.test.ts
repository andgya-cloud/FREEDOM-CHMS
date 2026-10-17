import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { makeEnv, newOrg, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

describe('signed-out visitors', () => {
  it('cannot read anything', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'organizations/fcn')));
    await assertFails(getDoc(doc(db, 'users/pastor')));
    await assertFails(getDoc(doc(db, 'roles/admin')));
  });
});

describe('user profiles', () => {
  it('lets a user read their own profile only', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'users/admin')));
    await assertFails(getDoc(doc(as('admin'), 'users/pastor')));
    await assertFails(getDocs(collection(as('admin'), 'users')));
  });

  it('lets the pastor list every account', async () => {
    await assertSucceeds(getDocs(collection(as('pastor'), 'users')));
  });

  it('never lets anyone raise their own access from the app', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'users/admin'), { permissions: ['users.manage'] }));
    await assertFails(updateDoc(doc(as('admin'), 'users/admin'), { allOrgs: true }));
    await assertFails(setDoc(doc(as('pastor'), 'users/newperson'), { roleId: 'pastor', active: true }));
  });
});

describe('organization separation', () => {
  it('lets an admin open only their own organization', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'organizations/fcn')));
    await assertFails(getDoc(doc(as('admin'), 'organizations/adia')));
    await assertFails(getDocs(collection(as('admin'), 'organizations')));
  });

  it('lets the pastor see every organization (combined view)', async () => {
    await assertSucceeds(getDocs(collection(as('pastor'), 'organizations')));
  });

  it('shuts out a switched-off account', async () => {
    await assertFails(getDoc(doc(as('inactive'), 'organizations/fcn')));
  });
});

describe('adding a campus is a form', () => {
  it('lets the pastor add one', async () => {
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor')));
  });

  it('refuses admins, even one allowed into settings but not every organization', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcm'), newOrg('admin')));
    await assertFails(setDoc(doc(as('settingsAdmin'), 'organizations/fcm'), newOrg('settingsAdmin')));
  });

  it('requires the creator and server time to be stamped honestly', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor', { createdBy: 'someoneElse' })));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor', { createdAt: new Date('2020-01-01') })));
  });

  it('rejects bad fields', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor', { receiptPrefix: 'fc' })));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor', { type: 'business' })));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcm'), newOrg('pastor', { secret: 'x' })));
  });
});

describe('editing and deleting', () => {
  const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

  it('lets an admin with settings access edit their own organization only', async () => {
    await assertSucceeds(updateDoc(doc(as('settingsAdmin'), 'organizations/fcn'), { name: 'Freedom Church Nairobi CBD', ...stamp('settingsAdmin') }));
    await assertFails(updateDoc(doc(as('settingsAdmin'), 'organizations/adia'), { name: 'X', ...stamp('settingsAdmin') }));
  });

  it('refuses edits from an admin without settings access', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'organizations/fcn'), { name: 'X', ...stamp('admin') }));
  });

  it('refuses edits that change who created the record', async () => {
    await assertFails(updateDoc(doc(as('pastor'), 'organizations/fcn'), { createdBy: 'admin', ...stamp('pastor') }));
  });

  it('allows soft delete and restore, never a hard delete', async () => {
    const ref = doc(as('pastor'), 'organizations/fcn');
    await assertSucceeds(updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: 'pastor', ...stamp('pastor') }));
    await assertSucceeds(updateDoc(ref, { deletedAt: null, deletedBy: null, ...stamp('pastor') }));
    await assertFails(deleteDoc(ref));
  });

  it('refuses a back-dated or misattributed soft delete', async () => {
    const ref = doc(as('pastor'), 'organizations/fcn');
    await assertFails(updateDoc(ref, { deletedAt: new Date('2020-01-01'), deletedBy: 'pastor', ...stamp('pastor') }));
    await assertFails(updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: 'admin', ...stamp('pastor') }));
  });
});

describe('roles as data', () => {
  it('lets the pastor add a third role', async () => {
    await assertSucceeds(setDoc(doc(as('pastor'), 'roles/usher'), {
      name: 'Usher', isOwner: false, permissions: ['people.read', 'attendance.write'], system: false,
      createdAt: serverTimestamp(), createdBy: 'pastor', updatedAt: serverTimestamp(), updatedBy: 'pastor',
    }));
  });

  it('stops admins changing roles, and stops the pastor role losing owner status', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'roles/admin'), { permissions: ['users.manage'], updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(as('pastor'), 'roles/pastor'), { isOwner: false, updatedAt: serverTimestamp(), updatedBy: 'pastor' }));
  });
});

describe('audit log', () => {
  it('is readable by the pastor and nobody else', async () => {
    await assertSucceeds(getDoc(doc(as('pastor'), 'auditLog/one')));
    await assertFails(getDoc(doc(as('admin'), 'auditLog/one')));
    await assertFails(getDoc(doc(as('settingsAdmin'), 'auditLog/one')));
  });

  it('cannot be written or erased from the app, even by the pastor', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'auditLog/fake'), { action: 'create' }));
    await assertFails(updateDoc(doc(as('pastor'), 'auditLog/one'), { action: 'nothing' }));
    await assertFails(deleteDoc(doc(as('pastor'), 'auditLog/one')));
  });
});
