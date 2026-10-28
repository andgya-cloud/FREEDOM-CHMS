import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, auth, FieldValue, requireCaller, requireString, requireStringArray, writeAudit, type UserProfile } from './common.js';
import { DEFAULT_ROLES, TEAM_ROLE_ID, TRAINER_ROLE_ID, can, canKeepAccounts, canManageTeamAccount, accountPermissions, isDefaultRoleId, isPettyTitle, type RoleDefinition } from './shared/permissions.js';
import { passwordProblems } from './shared/password.js';
import { normalizePhone } from './shared/phone.js';
import { passwordInUse, saveSigningPassword } from './pettyPins.js';
import { rebuildRoster } from './rosters.js';

// The browser calls these directly, so anyone may reach them; each one checks
// the caller's sign-in and permissions itself. Without this, a deploy can leave
// them closed and every call fails.
const CALLABLE = { invoker: 'public' } as const;

async function loadRole(roleId: string, byUid?: string): Promise<RoleDefinition> {
  const ref = db.doc(`roles/${roleId}`);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as RoleDefinition;
  // Roles added after the first setup (Organization head, Staff) are created the first time they are used.
  if (byUid && isDefaultRoleId(roleId)) {
    const role = DEFAULT_ROLES[roleId];
    await ref.create({
      name: role.name, isOwner: !!role.isOwner, system: true, permissions: role.permissions,
      createdAt: FieldValue.serverTimestamp(), createdBy: byUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: byUid,
    }).catch((err: { code?: number }) => { if (err.code !== 6) throw err; }); // 6: created meanwhile
    return role;
  }
  throw new HttpsError('invalid-argument', 'That role does not exist.');
}

/**
 * The pastor (users.manage) may manage any account. An organization head (team.manage) may only manage
 * Staff accounts inside their own organizations, and gets back the caller with that limit applied.
 */
async function requireAccountManager(request: Parameters<typeof requireCaller>[0]) {
  const caller = await requireCaller(request);
  // Only Andrew Guya and Doreen manage accounts now (Andy, 2026-10-24); organization heads no longer do.
  if (canKeepAccounts(caller.profile)) return { caller, teamOnly: false };
  throw new HttpsError('permission-denied', 'Only Andrew Guya and Doreen can manage staff accounts.');
}

const OUTSIDE_TEAM = 'You can only manage Staff accounts for your own organization.';

/** A WhatsApp number as +2547…, or '' for none; refuses one that is not a phone number. */
function phoneFrom(value: unknown): string {
  if (value == null || (typeof value === 'string' && !value.trim())) return '';
  const phone = typeof value === 'string' ? normalizePhone(value) : null;
  if (!phone) throw new HttpsError('invalid-argument', 'Please check the WhatsApp number.');
  return phone;
}

/** The petty cash voucher title, or '' for none. */
function pettyTitleFrom(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (!isPettyTitle(value)) throw new HttpsError('invalid-argument', 'Choose a voucher title from the list.');
  return value;
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

/**
 * A trainer's departments (Andy, 2026-10-28, 1A): the ADIA programmes ticked on
 * their account. They decide the register classes (the programme names) and
 * the students the trainer may see. Unknown programmes are dropped.
 */
async function trainerDepartments(value: unknown, orgIds: string[]): Promise<{ trainerCourseIds: string[]; registerClasses: string[] }> {
  const ids = [...new Set(requireStringArray(value ?? [], 'the departments'))].filter((id) => /^[a-z0-9_]{2,40}$/.test(id)).slice(0, 10);
  const found: { id: string; name: string }[] = [];
  for (const id of ids) {
    for (const orgId of orgIds) {
      const course = await db.doc(`organizations/${orgId}/courses/${id}`).get();
      if (course.exists && !course.get('deletedAt')) { found.push({ id, name: String(course.get('name') ?? '') }); break; }
    }
  }
  return { trainerCourseIds: found.map((c) => c.id), registerClasses: found.map((c) => c.name).filter(Boolean) };
}

/** Fill in the names-only class lists a trainer reads, so a new or changed trainer sees their students straight away. */
async function refreshRosters(orgIds: string[], courseIds: string[]) {
  for (const orgId of orgIds) {
    for (const courseId of courseIds) {
      if ((await db.doc(`organizations/${orgId}/courses/${courseId}`).get()).exists) await rebuildRoster(orgId, courseId);
    }
  }
}

/** Pastor (or an organization head, for their own Staff) creates an account with a temporary password. */
export const createUser = onCall(CALLABLE, async (request) => {
  const { caller, teamOnly } = await requireAccountManager(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const email = requireString(data.email, 'the email', { min: 3 }).toLowerCase();
  const displayName = requireString(data.displayName, 'the name', { min: 2, max: 80 });
  const roleId = teamOnly ? TEAM_ROLE_ID : requireString(data.roleId, 'the role');
  const orgIds = requireStringArray(data.orgIds ?? [], 'the organizations');
  const extraPermissions = teamOnly ? [] : requireStringArray(data.extraPermissions ?? [], 'the permissions');
  const password = checkPassword(data.password, email);
  const pettyTitle = teamOnly ? '' : pettyTitleFrom(data.pettyTitle);
  const phone = phoneFrom(data.phone);
  const dept = roleId === TRAINER_ROLE_ID ? await trainerDepartments(data.departments, orgIds) : { trainerCourseIds: [], registerClasses: [] };
  const role = await loadRole(roleId, caller.uid);
  const allOrgs = role.isOwner ? true : !teamOnly && data.allOrgs === true;
  if (teamOnly && !canManageTeamAccount(caller.profile, { roleId, allOrgs, orgIds })) {
    throw new HttpsError('permission-denied', OUTSIDE_TEAM);
  }
  if (!allOrgs && orgIds.length === 0) throw new HttpsError('invalid-argument', 'Choose at least one organization.');

  if (await passwordInUse(password, '')) throw new HttpsError('already-exists', 'Someone else already has this password. Please choose a different one.');
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
    pettyTitle,
    phone,
    ...dept,
    permissions: accountPermissions(roleId, role, extraPermissions),
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
  await saveSigningPassword(uid, password);
  await refreshRosters(orgIds, dept.trainerCourseIds);
  return { uid };
});

/** Pastor changes a user's role, organizations, granted permissions or active state. A head may change their own Staff's name, organizations and active state. */
export const updateUser = onCall(CALLABLE, async (request) => {
  const { caller, teamOnly } = await requireAccountManager(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requireString(data.uid, 'the user');
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user does not exist.');
  const current = snap.data() as UserProfile;
  if (teamOnly && (uid === caller.uid || !canManageTeamAccount(caller.profile, current))) {
    throw new HttpsError('permission-denied', OUTSIDE_TEAM);
  }

  const next: Partial<UserProfile> = {};
  if (data.displayName !== undefined) next.displayName = requireString(data.displayName, 'the name', { min: 2, max: 80 });
  if (data.roleId !== undefined && !teamOnly) next.roleId = requireString(data.roleId, 'the role');
  if (data.orgIds !== undefined) next.orgIds = requireStringArray(data.orgIds, 'the organizations');
  if (data.extraPermissions !== undefined && !teamOnly) next.extraPermissions = requireStringArray(data.extraPermissions, 'the permissions');
  if (data.allOrgs !== undefined && !teamOnly) next.allOrgs = data.allOrgs === true;
  if (data.active !== undefined) next.active = data.active === true;
  if (data.pettyTitle !== undefined && !teamOnly) next.pettyTitle = pettyTitleFrom(data.pettyTitle);
  if (data.phone !== undefined) next.phone = phoneFrom(data.phone);

  const merged = { ...current, ...next };
  if (teamOnly && !canManageTeamAccount(caller.profile, merged)) throw new HttpsError('permission-denied', OUTSIDE_TEAM);
  const role = await loadRole(merged.roleId, caller.uid);
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
  const kept = current as { trainerCourseIds?: string[]; registerClasses?: string[] };
  const dept = merged.roleId !== TRAINER_ROLE_ID ? { trainerCourseIds: [], registerClasses: [] }
    : data.departments !== undefined ? await trainerDepartments(data.departments, merged.orgIds)
      : { trainerCourseIds: kept.trainerCourseIds ?? [], registerClasses: kept.registerClasses ?? [] };

  await ref.update({
    displayName: merged.displayName,
    roleId: merged.roleId,
    orgIds: merged.orgIds,
    extraPermissions: merged.extraPermissions,
    allOrgs: merged.allOrgs,
    active: merged.active,
    pettyTitle: merged.pettyTitle ?? '',
    phone: merged.phone ?? '',
    // A trainer's departments and their register classes (Andy, 2026-10-28); nobody else carries any.
    ...dept,
    permissions: accountPermissions(merged.roleId, role, merged.extraPermissions),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  if (data.displayName !== undefined || data.active !== undefined) {
    await auth.updateUser(uid, { displayName: merged.displayName, disabled: !merged.active });
  }
  if (next.active === false) await auth.revokeRefreshTokens(uid);
  await refreshRosters(merged.orgIds, dept.trainerCourseIds);

  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'update', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null, changedFields: [...Object.keys(next), ...(data.departments !== undefined ? ['departments'] : [])],
  });
  return { ok: true };
});

/** Pastor (or a head, for their own Staff) sets a new temporary password; the user must change it at next sign-in. */
export const resetUserPassword = onCall(CALLABLE, async (request) => {
  const { caller, teamOnly } = await requireAccountManager(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requireString(data.uid, 'the user');
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user does not exist.');
  if (teamOnly && (uid === caller.uid || !canManageTeamAccount(caller.profile, snap.data() as UserProfile))) {
    throw new HttpsError('permission-denied', OUTSIDE_TEAM);
  }
  const email = (snap.data() as UserProfile).email;
  const password = checkPassword(data.password, email);
  // A password the pastor chose himself is kept as is (Andy, 2026-10-24); a generated one must be changed.
  const keep = data.keep === true;
  if (await passwordInUse(password, uid)) throw new HttpsError('already-exists', 'Someone else already has this password. Please choose a different one.');
  await auth.updateUser(uid, { password });
  await auth.revokeRefreshTokens(uid);
  // The same password also signs petty cash, checked on the server with no sign-in email involved.
  await saveSigningPassword(uid, password);
  await db.doc(`users/${uid}`).update({ mustChangePassword: !keep, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'password_reset', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null,
  });
  return { ok: true, loginEmail: (await auth.getUser(uid)).email ?? email };
});

/**
 * Pastor (or a head, for their own Staff) deletes an account for good: the sign-in and the profile go, so the
 * email can be used again. Records they made (attendance, gifts, signatures) stay, with their name on them.
 */
export const deleteUser = onCall(CALLABLE, async (request) => {
  const { caller, teamOnly } = await requireAccountManager(request);
  const uid = requireString(((request.data ?? {}) as Record<string, unknown>).uid, 'the user');
  if (uid === caller.uid) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That user does not exist.');
  const current = snap.data() as UserProfile;
  if (teamOnly && !canManageTeamAccount(caller.profile, current)) throw new HttpsError('permission-denied', OUTSIDE_TEAM);
  // A role that no longer exists cannot be an owner role.
  const roleDoc = await db.doc(`roles/${current.roleId}`).get();
  const role = roleDoc.exists ? (roleDoc.data() as RoleDefinition) : isDefaultRoleId(current.roleId) ? DEFAULT_ROLES[current.roleId] : undefined;
  if (role?.isOwner && current.active && (await countActiveOwners()) <= 1) {
    throw new HttpsError('failed-precondition', 'There must always be at least one active pastor account.');
  }
  await auth.deleteUser(uid).catch((err: { code?: string }) => { if (err.code !== 'auth/user-not-found') throw err; });
  await ref.delete();
  await writeAudit({
    actorUid: caller.uid, actorEmail: caller.email, action: 'delete', path: `users/${uid}`,
    collection: 'users', docId: uid, orgId: null, note: `Deleted the account of ${current.displayName} (${current.email})`,
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
  // Only the two account keepers change passwords, except someone made to choose their own at first sign-in.
  if (!caller.profile.mustChangePassword && !canKeepAccounts(caller.profile)) {
    throw new HttpsError('permission-denied', 'Only Andrew Guya and Doreen can change passwords. Ask one of them.');
  }
  const password = checkPassword((request.data as Record<string, unknown> | null)?.password, caller.email);
  if (await passwordInUse(password, caller.uid)) throw new HttpsError('already-exists', 'Someone else already has this password. Please choose a different one.');
  await auth.updateUser(caller.uid, { password });
  // The new password also signs in on its own and signs petty cash.
  await saveSigningPassword(caller.uid, password);
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

/** An organization head's Staff accounts. Heads cannot list the users collection, so they read it through here. */
export const listTeam = onCall(CALLABLE, async (request) => {
  const { caller, teamOnly } = await requireAccountManager(request);
  if (!teamOnly) throw new HttpsError('failed-precondition', 'The pastor sees every account in Staff accounts.');
  const snap = await db.collection('users').where('roleId', '==', TEAM_ROLE_ID).get();
  const users = snap.docs
    .filter((d) => canManageTeamAccount(caller.profile, d.data() as UserProfile))
    .map((d) => {
      const u = d.data() as UserProfile & { lastSignInAt?: FirebaseFirestore.Timestamp };
      return {
        uid: d.id, displayName: u.displayName, email: u.email, roleId: u.roleId, orgIds: u.orgIds, active: u.active,
        lastSignInAt: u.lastSignInAt ? u.lastSignInAt.toMillis() : null,
      };
    });
  return { users };
});
