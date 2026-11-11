import type { ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import { canKeepAccounts, type Permission } from '../../functions/src/shared/permissions';

type Props = { children: ReactNode } & ({ permission: Permission; anyOf?: never } | { anyOf: Permission[]; permission?: never });

/** Hides a screen from users without the permission (or any of several). The server rules enforce the same thing. */
export function RequirePermission({ permission, anyOf, children }: Props) {
  const { can } = useAuth();
  const allowed = permission ? can(permission) : anyOf.some((p) => can(p));
  if (!allowed) {
    return (
      <div className="page">
        <h1>Not available</h1>
        <p>This page is not part of your account, so you can’t open it. If you need it for your work, please ask Mr Andrew and he can give you access.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Staff accounts and passwords: only Andrew Guya and Doreen (Andy, 2026-10-24). The server checks the same. */
export function RequireAccountKeeper({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (!canKeepAccounts(profile)) {
    return (
      <div className="page">
        <h1>Not available</h1>
        <p>Only Mr Andrew and Doreen manage staff accounts and passwords. If you need a change, please ask Mr Andrew.</p>
      </div>
    );
  }
  return <>{children}</>;
}
