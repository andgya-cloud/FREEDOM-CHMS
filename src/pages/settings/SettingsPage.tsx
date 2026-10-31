import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { canKeepAccounts, type Permission } from '../../../functions/src/shared/permissions';

const ITEMS: { to: string; label: string; detail: string; permission?: Permission; orPermission?: Permission; keepersOnly?: boolean; petty?: boolean; churchOnly?: boolean; collegeOnly?: boolean }[] = [
  { to: '/settings/organizations', label: 'Organizations', detail: 'Campuses, the college and ministries', permission: 'settings.manage' },
  { churchOnly: true, to: '/settings/group/people', label: 'People', detail: 'Journey stages and your own extra fields', permission: 'settings.manage' },
  { collegeOnly: true, to: '/school/courses', label: 'Departments', detail: 'ADIA departments and their cohorts', permission: 'settings.manage', orPermission: 'school.manage' },
  { collegeOnly: true, to: '/school/settings', label: 'School settings', detail: 'ADIA grading scale, pass mark, attendance alert and director', permission: 'settings.manage' },
  { churchOnly: true, to: '/settings/group/whatsapp', label: 'WhatsApp', detail: 'The words of each message, and which ones send themselves', permission: 'settings.manage' },
  { to: '/settings/users', label: 'Staff accounts', detail: 'Add staff, reset passwords, set access', keepersOnly: true },
  { to: '/settings/cleanup', label: 'Clean-up', detail: 'Remove test data and clutter; Recycle Bin and Forever', keepersOnly: true },
  { to: '/settings/data', label: 'Data and backups', detail: 'Weekly backup, download everything, one person’s data, practice mode', permission: 'data.export' },
  { to: '/settings/audit', label: 'Audit log', detail: 'Who changed what, and when', permission: 'audit.read' },
  // ADIA keeps these three on the list; elsewhere they sit inside This device (Andy, 2026-10-31, 6A was for Freedom Church).
  { collegeOnly: true, to: '/settings/signing-pin', label: 'Signing PIN', detail: 'Set or change the PIN used to sign petty cash', petty: true },
  { collegeOnly: true, to: '/settings/my-password', label: 'My password', detail: 'Change your own password; it also signs you in on its own', keepersOnly: true },
  { collegeOnly: true, to: '/help', label: 'Help', detail: 'How to do the everyday jobs' },
  { to: '/settings/device', label: 'This device', detail: 'Install, sync, theme, your signing PIN and password, help, sign-out' },
];

/**
 * Settings that sit together under one line (Andy, 2026-10-31, 6A: twelve lines cut down). Funds moved to Giving,
 * report settings to Reports, and Signing PIN, My password and Help to This device.
 */
const GROUPS: Record<string, { title: string; items: { to: string; label: string; detail: string }[] }> = {
  people: {
    title: 'People settings',
    items: [
      { to: '/settings/pipeline', label: 'Journey stages', detail: 'Visitor, Salvation, Baptism, Growth Track…' },
      { to: '/settings/custom-fields', label: 'Extra fields', detail: 'Your own fields on every person' },
    ],
  },
  whatsapp: {
    title: 'WhatsApp',
    items: [
      { to: '/settings/templates', label: 'Messages', detail: 'The words for welcomes, check-ins, care and receipts' },
      { to: '/settings/whatsapp', label: 'Automation', detail: 'Let welcomes and check-ins send themselves, with your approval first' },
    ],
  },
};

export function SettingsGroupPage() {
  const { group = '' } = useParams();
  const { can } = useAuth();
  const g = GROUPS[group];
  if (!g || !can('settings.manage')) return <Navigate to="/settings" replace />;
  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>{g.title}</h1>
      <ul className="link-list">
        {g.items.map((i) => (
          <li key={i.to}>
            <Link to={i.to}>
              <span className="link-title">{i.label}</span>
              <span className="link-detail">{i.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PETTY_PERMS: Permission[] = ['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize'];

export function SettingsPage() {
  const { can, profile, signOut } = useAuth();
  // In ADIA only the school's own settings show (Andy, 2026-10-30, 3A); church settings stay under the church.
  const college = useOrg().current?.type === 'college';
  return (
    <div className="page">
      <h1>Settings</h1>
      <ul className="link-list">
        {ITEMS.filter((i) => !(college && i.churchOnly) && !(!college && i.collegeOnly) && (!i.keepersOnly || canKeepAccounts(profile)) && (!i.petty || PETTY_PERMS.some((x) => can(x)) || can('users.manage')) && (!i.permission || can(i.permission) || (!!i.orPermission && can(i.orPermission)))).map((i) => (
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
