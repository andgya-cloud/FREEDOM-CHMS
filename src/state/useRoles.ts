import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_ROLES, type RoleDefinition } from '../../functions/src/shared/permissions';

export type Role = RoleDefinition & { id: string };

export function useRoles(): Role[] {
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => onSnapshot(collection(db, 'roles'), (snap) => {
    const stored = snap.docs.map((d) => ({ id: d.id, ...(d.data() as RoleDefinition) }));
    // Built-in roles added after the first setup show up before anyone holds them; the server saves them on first use.
    const missing = Object.entries(DEFAULT_ROLES).filter(([id]) => !stored.some((r) => r.id === id)).map(([id, r]) => ({ id, ...r }));
    setRoles([...stored, ...missing].sort((a, b) => Number(!!b.isOwner) - Number(!!a.isOwner) || a.name.localeCompare(b.name)));
  }, () => setRoles([])), []);
  return roles;
}
