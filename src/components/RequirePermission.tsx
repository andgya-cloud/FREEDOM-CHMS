import type { ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import type { Permission } from '../../functions/src/shared/permissions';

type Props = { children: ReactNode } & ({ permission: Permission; anyOf?: never } | { anyOf: Permission[]; permission?: never });

/** Hides a screen from users without the permission (or any of several). The server rules enforce the same thing. */
export function RequirePermission({ permission, anyOf, children }: Props) {
  const { can } = useAuth();
  const allowed = permission ? can(permission) : anyOf.some((p) => can(p));
  if (!allowed) {
    return (
      <div className="page">
        <h1>Not available</h1>
        <p>Your account does not have access to this page. Ask the pastor if you need it.</p>
      </div>
    );
  }
  return <>{children}</>;
}
