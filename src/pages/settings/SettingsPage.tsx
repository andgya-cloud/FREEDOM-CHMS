import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Permission } from '../../../functions/src/shared/permissions';

const ITEMS: { to: string; label: string; detail: string; permission?: Permission }[] = [
  { to: '/settings/organizations', label: 'Organizations', detail: 'Campuses, the college and ministries', permission: 'settings.manage' },
  { to: '/settings/pipeline', label: 'Journey stages', detail: 'Visitor, Salvation, Baptism, Growth Track…', permission: 'settings.manage' },
  { to: '/settings/custom-fields', label: 'Extra fields', detail: 'Your own fields on every person', permission: 'settings.manage' },
  { to: '/settings/users', label: 'Staff accounts', detail: 'Add staff, reset passwords, set access', permission: 'users.manage' },
  { to: '/settings/audit', label: 'Audit log', detail: 'Who changed what, and when', permission: 'audit.read' },
  { to: '/settings/device', label: 'This device', detail: 'Install, sync, theme and sign-out' },
];

export function SettingsPage() {
  const { can, profile, signOut } = useAuth();
  return (
    <div className="page">
      <h1>Settings</h1>
      <ul className="link-list">
        {ITEMS.filter((i) => !i.permission || can(i.permission)).map((i) => (
          <li key={i.to}>
            <Link to={i.to}>
              <span className="link-title">{i.label}</span>
              <span className="link-detail">{i.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="card">
        <p>Signed in as <strong>{profile?.displayName}</strong> ({profile?.email})</p>
        <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}
