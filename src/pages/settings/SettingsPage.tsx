import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { canKeepAccounts, type Permission } from '../../../functions/src/shared/permissions';

const ITEMS: { to: string; label: string; detail: string; permission?: Permission; orPermission?: Permission; keepersOnly?: boolean; petty?: boolean }[] = [
  { to: '/settings/organizations', label: 'Organizations', detail: 'Campuses, the college and ministries', permission: 'settings.manage' },
  { to: '/settings/pipeline', label: 'Journey stages', detail: 'Visitor, Salvation, Baptism, Growth Track…', permission: 'settings.manage' },
  { to: '/settings/custom-fields', label: 'Extra fields', detail: 'Your own fields on every person', permission: 'settings.manage' },
  { to: '/settings/funds', label: 'Funds', detail: 'Tithes, Offerings and other funds for giving', permission: 'settings.manage' },
  { to: '/school/courses', label: 'Programmes', detail: 'ADIA programmes (departments) and their cohorts', permission: 'settings.manage', orPermission: 'school.manage' },
  { to: '/school/settings', label: 'School settings', detail: 'ADIA grading scale, pass mark, attendance alert and director', permission: 'settings.manage' },
  { to: '/settings/templates', label: 'WhatsApp messages', detail: 'The words for welcomes, check-ins, care and receipts', permission: 'settings.manage' },
  { to: '/settings/whatsapp', label: 'WhatsApp automation', detail: 'Let welcomes and check-ins send themselves, with your approval first', permission: 'settings.manage' },
  { to: '/settings/reports', label: 'Reports', detail: 'Regular attenders, who gets reports by email, giving budget', permission: 'settings.manage' },
  { to: '/settings/users', label: 'Staff accounts', detail: 'Add staff, reset passwords, set access', keepersOnly: true },
  { to: '/settings/data', label: 'Data and backups', detail: 'Weekly backup, download everything, one person’s data, practice mode', permission: 'data.export' },
  { to: '/settings/audit', label: 'Audit log', detail: 'Who changed what, and when', permission: 'audit.read' },
  { to: '/settings/signing-pin', label: 'Signing PIN', detail: 'Set or change the PIN used to sign petty cash', petty: true },
  { to: '/settings/my-password', label: 'My password', detail: 'Change your own password; it also signs you in on its own', keepersOnly: true },
  { to: '/help', label: 'Help', detail: 'How to do the everyday jobs' },
  { to: '/settings/device', label: 'This device', detail: 'Install, sync, theme and sign-out' },
];

const PETTY_PERMS: Permission[] = ['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize'];

export function SettingsPage() {
  const { can, profile, signOut } = useAuth();
  return (
    <div className="page">
      <h1>Settings</h1>
      <ul className="link-list">
        {ITEMS.filter((i) => (!i.keepersOnly || canKeepAccounts(profile)) && (!i.petty || PETTY_PERMS.some((x) => can(x)) || can('users.manage')) && (!i.permission || can(i.permission) || (!!i.orPermission && can(i.orPermission)))).map((i) => (
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
