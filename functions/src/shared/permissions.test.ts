import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, GRANTABLE_PERMISSIONS, PERMISSIONS, can, canAccessOrg, canManageTeamAccount, effectivePermissions } from './permissions';

describe('effectivePermissions', () => {
  it('gives an owner role every permission', () => {
    expect(effectivePermissions(DEFAULT_ROLES.pastor)).toEqual([...PERMISSIONS]);
  });

  it('keeps admins out of pastoral notes, per-person giving, financial reports and settings by default', () => {
    const admin = effectivePermissions(DEFAULT_ROLES.admin);
    for (const p of ['pastoral.read', 'giving.person.read', 'finance.reports', 'settings.manage', 'users.manage', 'audit.read'] as const) {
      expect(admin).not.toContain(p);
    }
    expect(admin).toContain('people.write');
    expect(admin).toContain('gifts.write');
  });

  it('lets the pastor grant each sensitive permission to an admin', () => {
    for (const p of GRANTABLE_PERMISSIONS) {
      expect(effectivePermissions(DEFAULT_ROLES.admin, [p])).toContain(p);
    }
  });

  it('never grants pastor-only permissions through extras', () => {
    const result = effectivePermissions(DEFAULT_ROLES.admin, ['users.manage', 'audit.read', 'data.export']);
    expect(result).not.toContain('users.manage');
    expect(result).not.toContain('audit.read');
    expect(result).not.toContain('data.export');
  });

  it('drops unknown permission strings', () => {
    expect(effectivePermissions({ name: 'Odd', permissions: ['people.read', 'everything', '*'] })).toEqual(['people.read']);
  });

  it('gives nothing when the role is missing', () => {
    expect(effectivePermissions(undefined, ['pastoral.read'])).toEqual([]);
  });

  it('supports a third role defined only as data', () => {
    const usher = { name: 'Usher', permissions: ['people.read', 'attendance.write'] };
    expect(effectivePermissions(usher)).toEqual(['people.read', 'attendance.write']);
  });
});

describe('can and canAccessOrg', () => {
  const admin = { active: true, orgIds: ['fcn'], permissions: effectivePermissions(DEFAULT_ROLES.admin) };

  it('checks permissions only for active users', () => {
    expect(can(admin, 'people.write')).toBe(true);
    expect(can({ ...admin, active: false }, 'people.write')).toBe(false);
    expect(can(null, 'people.write')).toBe(false);
  });

  it('limits an admin to their organizations', () => {
    expect(canAccessOrg(admin, 'fcn')).toBe(true);
    expect(canAccessOrg(admin, 'adia')).toBe(false);
    expect(canAccessOrg({ ...admin, allOrgs: true }, 'adia')).toBe(true);
    expect(canAccessOrg({ ...admin, active: false }, 'fcn')).toBe(false);
  });
});

describe('organization heads', () => {
  const head = { active: true, orgIds: ['adia'], permissions: effectivePermissions(DEFAULT_ROLES.head) };

  it('see no money, and can only add staff', () => {
    for (const p of ['gifts.write', 'receipts.issue', 'giving.person.read', 'finance.reports', 'users.manage', 'settings.manage'] as const) {
      expect(head.permissions).not.toContain(p);
    }
    expect(head.permissions).toContain('team.manage');
    expect(effectivePermissions(DEFAULT_ROLES.staff)).not.toContain('team.manage');
    expect(effectivePermissions(DEFAULT_ROLES.staff)).not.toContain('gifts.write');
  });

  it('manage only Staff accounts inside their own organizations', () => {
    expect(canManageTeamAccount(head, { roleId: 'staff', orgIds: ['adia'] })).toBe(true);
    expect(canManageTeamAccount(head, { roleId: 'staff', orgIds: ['adia', 'hope'] })).toBe(false);
    expect(canManageTeamAccount(head, { roleId: 'staff', orgIds: [] })).toBe(false);
    expect(canManageTeamAccount(head, { roleId: 'staff', orgIds: ['adia'], allOrgs: true })).toBe(false);
    expect(canManageTeamAccount(head, { roleId: 'admin', orgIds: ['adia'] })).toBe(false);
    expect(canManageTeamAccount(head, { roleId: 'head', orgIds: ['adia'] })).toBe(false);
    expect(canManageTeamAccount({ ...head, active: false }, { roleId: 'staff', orgIds: ['adia'] })).toBe(false);
    expect(canManageTeamAccount({ ...head, allOrgs: true }, { roleId: 'staff', orgIds: ['adia'] })).toBe(false);
  });
});
