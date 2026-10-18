import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, auth, FieldValue, requireCaller, requireString, requireStringArray, writeAudit, type UserProfile } from './common.js';
import { effectivePermissions, type RoleDefinition } from './shared/permissions.js';
import { passwordProblems } from './shared/password.js';

// The browser calls these directly, so anyone may reach them; each one checks
// the caller's sign-in and permissions itself. Without this, a deploy can leave
// them closed and every call fails.
const CALLABLE = { invoker: 'public' } as const;

async function loadRole(roleId: string): Promise<RoleDefinition> {
  const snap = await db.doc(`roles/${roleId}`).get();
  if (!snap.exists) throw new HttpsError('invalid-argument', 'That role does not exist.');
  return snap.data() as RoleDefinition;
}

function checkPassword(password: unknown, email: string): string {
  if (typeof password !== 'string') throw new HttpsError('invalid-argument', 'Enter a password.');
  const problems = passwordProblems(password, email);
  if (problems.length) throw new HttpsError('invalid-argument', problems.join(' '));
  return password;
}

async function countActiveOwners(): Promise<number> {
  const roles = await db.collection('roles').where('isOwner', '==', true).get();
  const ownerRoleIds = roles.docs.map((d) => d.id);
  if (ownerRoleIds.length === 0) return 0;
  const owners = await db.collection('users').where('roleId', 'in', ownerRoleIds).where('active', '==', true).get();
  return owners.size;
}

/** Pastor creates a staff account with a temporary password. */
export const createUser = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request, 'users.manage');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const email = requireString(data.email, 'the email', { min: 3 }).toLowerCase();
  const displayName = requireString(data.displayName, 'the name', { min: 2, max: 80 });
  const roleId = requireString(data.roleId, 'the role');
  const orgIds = requireStringArray(data.orgIds ?? [], 'the organizations');
  const extraPermissions = requireStringArray(data.extraPermissions ?? [], 'the permissions');
  const password = checkPassword(data.password, email);
  const role = await loadRole(roleId);
  const allOrgs = role.isOwner ? true : data.allOrgs === true;
  if (!allOrgs && orgIds.length === 0) throw new HttpsError('invalid-argument', 'Choose at least one organization.');

  let uid: string;
  try {
    uid = (await auth.createUser({ email, password, displayName })).uid;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with that email already exists.');
    }
    throw err;
  }
  const profile: UserProfile & Record<string, unknown> = {
    email,
    displayName,
    roleId,
    extraPermissions,
    orgIds,
    allOrgs,
    permissions: effectivePermissions(role, extraPermissions),
    active: true,
    mustChangePassword: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  };
  await db.doc(`users/${uid}`).set(profile);
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'create', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null, note: `Created account for ${email} as ${role.name}`,
  });
  return { uid };
});

/** Pastor changes a user's role, organizations, granted permissions or active state. */
export const updateUser = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request, 'users.manage');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requireString(data.uid, 'the user');
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user does not exist.');
  const current = snap.data() as UserProfile;

  const next: Partial<UserProfile> = {};
  if (data.displayName !== undefined) next.displayName = requireString(data.displayName, 'the name', { min: 2, max: 80 });
  if (data.roleId !== undefined) next.roleId = requireString(data.roleId, 'the role');
  if (data.orgIds !== undefined) next.orgIds = requireStringArray(data.orgIds, 'the organizations');
  if (data.extraPermissions !== undefined) next.extraPermissions = requireStringArray(data.extraPermissions, 'the permissions');
  if (data.allOrgs !== undefined) next.allOrgs = data.allOrgs === true;
  if (data.active !== undefined) next.active = data.active === true;

  const merged = { ...current, ...next };
  const role = await loadRole(merged.roleId);
  const currentRole = await loadRole(current.roleId);
  if (role.isOwner) merged.allOrgs = true;
  if (!merged.allOrgs && merged.orgIds.length === 0) throw new HttpsError('invalid-argument', 'Choose at least one organization.');

  const losingOwner = currentRole.isOwner && current.active && (!role.isOwner || !merged.active);
  if (losingOwner && (await countActiveOwners()) <= 1) {
    throw new HttpsError('failed-precondition', 'There must always be at least one active pastor account.');
  }
  if (uid === caller.uid && merged.active === false) {
    throw new HttpsError('failed-precondition', 'You cannot deactivate your own account.');
  }

  await ref.update({
    displayName: merged.displayName,
    roleId: merged.roleId,
    orgIds: merged.orgIds,
    extraPermissions: merged.extraPermissions,
    allOrgs: merged.allOrgs,
    active: merged.active,
    permissions: effectivePermissions(role, merged.extraPermissions),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  if (data.displayName !== undefined || data.active !== undefined) {
    await auth.updateUser(uid, { displayName: merged.displayName, disabled: !merged.active });
  }
  if (next.active === false) await auth.revokeRefreshTokens(uid);

  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'update', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null, changedFields: Object.keys(next),
  });
  return { ok: true };
});

/** Pastor sets a new temporary password; the user must change it at next sign-in. */
export const resetUserPassword = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request, 'users.manage');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requireString(data.uid, 'the user');
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user does not exist.');
  const email = (snap.data() as UserProfile).email;
  const password = checkPassword(data.password, email);
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'password_reset', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null,
  });
  return { ok: true };
});

/** A user replaces their temporary password. Requires a sign-in within the last 10 minutes. */
export const changeMyPassword = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const authTime = Number(request.auth?.token.auth_time ?? 0);
  if (Date.now() / 1000 - authTime > 600) {
    throw new HttpsError('failed-precondition', 'Please sign in again, then change your password.');
  }
  const password = checkPassword((request.data as Record<string, unknown> | null)?.password, caller.email);
  await auth.updateUser(caller.uid, { password });
  await db.doc(`users/${caller.uid}`).update({ mustChangePassword: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'password_change', path: `users/${caller.uid}`,
    collection: 'users', docId: caller.uid, orgId: null,
  });
  return { ok: true };
});

/** Records a sign-in in the audit log. Called by the app right after a successful sign-in. */
export const recordSignIn = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  await db.doc(`users/${caller.uid}`).update({ lastSignInAt: FieldValue.serverTimestamp() });
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'sign_in', path: `users/${caller.uid}`,
    collection: 'users', docId: caller.uid, orgId: null,
  });
  return { ok: true };
});
