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
  'pettycash.authorize',
  // ADIA payroll: keep staff pay details and prepare pay runs; approve pay runs and set the deduction rates
  'payroll.manage',
  'payroll.approve',
  // ADIA exam records: trainers key in their own marks sheets; the principal compiles, edits and unlocks
  'exams.mark',
  'exams.manage',
  // ADIA principal (Andy, 2026-10-25): keep admission numbers and issue certificates; see each student's fee balance only
  'school.manage',
  'fees.balances',
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
  // Three petty cash roles (Andy, 2026-10-24): Request, Sign, Top up. The old "check" tick now counts as Sign.
  'pettycash.request',
  'pettycash.approve',
  'pettycash.authorize',
  'payroll.manage',
  'payroll.approve',
  'exams.mark',
  'exams.manage',
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
  'pettycash.request': 'Petty cash: Request (raise requisitions)',
  'pettycash.check': 'Petty cash: Sign (old tick)',
  'pettycash.approve': 'Petty cash: Sign (approve requisitions, any two)',
  'pettycash.authorize': 'Petty cash: Top up (add money; also signs)',
  'payroll.manage': 'Payroll: staff pay details and preparing pay runs',
  'payroll.approve': 'Payroll: approving pay runs and deduction rates',
  'exams.mark': 'Exam records: key in my own marks sheets (trainer)',
  'exams.manage': 'Exam records: compile reports, edit and unlock sheets (principal)',
  'school.manage': 'Students: admission numbers, graduation and certificates',
  'fees.balances': "Each student's fee balance (no payments)",
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

/** The ADIA principal: students, attendance, Exam Records and graduation, each student's fee balance, nothing else (Andy, 2026-10-25). */
export const PRINCIPAL_ROLE_ID = 'principal';

/** An ADIA trainer: keys in their own classes' marks in Exam Records and sees nothing else (Andy, 2026-10-25). */
export const TRAINER_ROLE_ID = 'trainer';

/** The role for the petty cash signatories: they raise and sign requests, top-ups and resets, and see nothing else. */
export const SIGNATORY_ROLE_ID = 'signatory';

/** The title printed under each signature on a petty cash voucher. Every request needs the accountant's signature. */
export const PETTY_TITLES = ['Director', 'Chairman', 'Administrator', 'Accountant', 'Board member'] as const;
export type PettyTitle = (typeof PETTY_TITLES)[number];
export const ACCOUNTANT_TITLE: PettyTitle = 'Accountant';

export function isPettyTitle(value: unknown): value is PettyTitle {
  return typeof value === 'string' && (PETTY_TITLES as readonly string[]).includes(value);
}

export const DEFAULT_ROLES: Record<'pastor' | 'admin' | 'head' | 'staff' | 'signatory' | 'principal' | 'trainer', RoleDefinition> = {
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
  signatory: { name: 'Petty cash signatory', permissions: ['pettycash.request', 'pettycash.approve', 'pettycash.authorize'] },
  principal: { name: 'Principal', permissions: ['people.read', 'people.write', 'attendance.write', 'exams.manage', 'school.manage', 'fees.balances'] },
  // A trainer reads only their department's names-only class list, never people or students (Andy, 2026-10-28).
  trainer: { name: 'Trainer', permissions: ['exams.mark'] },
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
  for (const raw of extraPermissions) {
    const p = raw === 'pettycash.check' ? 'pettycash.approve' : raw;
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

/**
 * Only Andrew Guya and Doreen Mayaka (also "Doreen Guya") may open Staff accounts and set anyone's
 * password (Andy, 2026-10-24), and only while their account manages users.
 */
export const ACCOUNT_KEEPER_NAMES = ['Andrew Guya', 'Doreen Mayaka', 'Doreen Guya'] as const;
export function canKeepAccounts(profile: (AccessProfile & { displayName?: string }) | null | undefined): boolean {
  const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
  return can(profile, 'users.manage') && ACCOUNT_KEEPER_NAMES.some((n) => plain(n) === plain(profile?.displayName ?? ''));
}

/** The Director: Andrew Guya's pastor account. Only he deletes alone, sees the deletion register and puts entries back (Andy, 2026-10-24). */
export function isDirectorProfile(profile: (AccessProfile & { displayName?: string }) | null | undefined): boolean {
  return can(profile, 'users.manage') && (profile?.displayName ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'andrewguya';
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

/**
 * A user's permissions as stored on their account. A trainer never gets
 * people.read, whatever their role document says: they read only their
 * department's names-only class list (Andy, 2026-10-28).
 */
export function accountPermissions(roleId: string, role: RoleDefinition | undefined, extraPermissions: readonly string[] = []): Permission[] {
  const all = effectivePermissions(role, extraPermissions);
  return roleId === TRAINER_ROLE_ID ? all.filter((p) => p !== 'people.read') : all;
}
