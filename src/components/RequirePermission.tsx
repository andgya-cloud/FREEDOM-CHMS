import type { ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import type { Permission } from '../../functions/src/shared/permissions';

/** Hides a screen from users without the permission. The server rules enforce the same thing. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="page">
        <h1>Not available</h1>
        <p>Your account does not have access to this page. Ask the pastor if you need it.</p>
      </div>
    );
  }
  return <>{children}</>;
}
