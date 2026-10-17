import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from './common.js';
import { effectivePermissions, type RoleDefinition } from './shared/permissions.js';

/** When a role's permissions change, recompute every user who holds that role. */
export const syncRolePermissions = onDocumentWritten('roles/{roleId}', async (event) => {
  const role = event.data?.after.exists ? (event.data.after.data() as RoleDefinition) : undefined;
  const users = await db.collection('users').where('roleId', '==', event.params.roleId).get();
  const batch = db.batch();
  for (const user of users.docs) {
    const extra = (user.get('extraPermissions') as string[] | undefined) ?? [];
    batch.update(user.ref, {
      permissions: effectivePermissions(role, extra),
      ...(role?.isOwner ? { allOrgs: true } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (users.size) await batch.commit();
});
