/**
 * Roles and permissions, shared by the web app (to decide what to show) and
 * Cloud Functions (to decide what is allowed). Firestore rules enforce the
 * same permissions from the `permissions` array that functions write onto
 * each user document, so the browser is never the source of truth.
 */

export const PERMISSIONS = [
  // Everyday work (admins have these by default)
  'people.read',
  'people.write',
  'attendance.write',
  'programs.write',
  'gifts.write',
  'receipts.issue',
  'followups.manage',
  // Sensitive areas the pastor can grant to an admin
  'pastoral.read',
  'giving.person.read',
  'finance.reports',
  'settings.manage',
  // ADIA petty cash: make requests, check them (accountant), give final approval and set the budget (board)
  'pettycash.request',
  'pettycash.check',
  'pettycash.approve',
  // An organization head adds and manages Staff accounts for their own organization only
  'team.manage',
  // Pastor only
  'users.manage',
  'audit.read',
  'data.export',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions the pastor may switch on for an individual admin. */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = [
  'pastoral.read',
  'giving.person.read',
  'finance.reports',
  'settings.manage',
  'pettycash.request',
  'pettycash.check',
  'pettycash.approve',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'people.read': 'See people',
  'people.write': 'Add and edit people',
  'attendance.write': 'Record attendance',
  'programs.write': 'Manage programs and groups',
  'gifts.write': 'Record gifts',
  'receipts.issue': 'Issue receipts',
  'followups.manage': 'Send follow-ups',
  'pastoral.read': 'Pastoral notes and salvation records',
  'giving.person.read': 'Giving history per person',
  'finance.reports': 'Financial reports',
  'settings.manage': 'Settings and organizations',
  'pettycash.request': 'Petty cash: make requests',
  'pettycash.check': 'Petty cash: check requests (accountant)',
  'pettycash.approve': 'Petty cash: final approval and monthly budget',
  'team.manage': 'Staff accounts for their own organization',
  'users.manage': 'User accounts',
  'audit.read': 'Audit log',
  'data.export': 'Export and erase data',
};

export interface RoleDefinition {
  name: string;
  /** An owner role always has every permission and every organization. */
  isOwner?: boolean;
  permissions: string[];
}

/** The day-to-day work of an organization, without any money. */
const TEAM_WORK = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'followups.manage'];

/** The role an organization head gives to the staff they add. */
export const TEAM_ROLE_ID = 'staff';

export const DEFAULT_ROLES: Record<'pastor' | 'admin' | 'head' | 'staff', RoleDefinition> = {
  pastor: { name: 'Pastor', isOwner: true, permissions: [...PERMISSIONS] },
  admin: {
    name: 'Admin',
    permissions: [
      'people.read',
      'people.write',
      'attendance.write',
      'programs.write',
      'gifts.write',
      'receipts.issue',
      'followups.manage',
    ],
  },
  // For the person in charge of one organization, such as ADIA or Freedom Hope Center:
  // their organization's everyday work, no money, and they can add Staff for it.
  head: { name: 'Organization head', permissions: [...TEAM_WORK, 'team.manage'] },
  staff: { name: 'Staff', permissions: [...TEAM_WORK] },
};

export function isDefaultRoleId(id: string): id is keyof typeof DEFAULT_ROLES {
  return Object.prototype.hasOwnProperty.call(DEFAULT_ROLES, id);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The permissions a user actually has: everything for an owner role,
 * otherwise the role's permissions plus any grants from the grantable list.
 * Unknown strings are dropped so a typo can never widen access.
 */
export function effectivePermissions(
  role: RoleDefinition | undefined,
  extraPermissions: readonly string[] = [],
): Permission[] {
  if (!role) return [];
  if (role.isOwner) return [...PERMISSIONS];
  const granted = new Set<Permission>();
  for (const p of role.permissions) if (isPermission(p)) granted.add(p);
  for (const p of extraPermissions) {
    if (isPermission(p) && GRANTABLE_PERMISSIONS.includes(p)) granted.add(p);
  }
  return PERMISSIONS.filter((p) => granted.has(p));
}

export interface AccessProfile {
  active: boolean;
  allOrgs?: boolean;
  orgIds?: readonly string[];
  permissions?: readonly string[];
}

export function can(profile: AccessProfile | null | undefined, permission: Permission): boolean {
  return !!profile?.active && !!profile.permissions?.includes(permission);
}

export function canAccessOrg(profile: AccessProfile | null | undefined, orgId: string): boolean {
  if (!profile?.active) return false;
  return !!profile.allOrgs || !!profile.orgIds?.includes(orgId);
}

export interface TeamAccount {
  roleId: string;
  allOrgs?: boolean;
  orgIds?: readonly string[];
}

/**
 * Whether an organization head (team.manage, not the pastor) may create or change this account:
 * only Staff accounts whose organizations are all among the head's own.
 */
export function canManageTeamAccount(head: AccessProfile | null | undefined, account: TeamAccount): boolean {
  if (!can(head, 'team.manage') || head?.allOrgs) return false;
  if (account.roleId !== TEAM_ROLE_ID || account.allOrgs) return false;
  const orgIds = account.orgIds ?? [];
  return orgIds.length > 0 && orgIds.every((id) => !!head?.orgIds?.includes(id));
}
