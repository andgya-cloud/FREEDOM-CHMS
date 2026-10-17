import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { RoleDefinition } from '../../functions/src/shared/permissions';

export type Role = RoleDefinition & { id: string };

export function useRoles(): Role[] {
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => onSnapshot(collection(db, 'roles'), (snap) => {
    setRoles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoleDefinition) })).sort((a, b) => Number(!!b.isOwner) - Number(!!a.isOwner) || a.name.localeCompare(b.name)));
  }, () => setRoles([])), []);
  return roles;
}
