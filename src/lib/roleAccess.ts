import { HELPER_ROLE_ID, LABTECH_ROLE_ID, TRAINER_ROLE_ID } from '../../functions/src/shared/permissions';

export interface RoleProfile { roleId?: string; registerClasses?: unknown[]; inventoryCourseIds?: unknown[] }

/**
 * Some roles only see a few pages (Andy, 2026-10-25 to 2026-11-04): a trainer their marks sheets, a lab technician
 * their inventory, a Hope helper the registers and clubs. Returns where such a person is sent instead, or null when
 * the page is theirs. The menu and "Just ask Andy" both read this, so they always agree.
 */
export function roleRedirect(profile: RoleProfile | null | undefined, path: string): string | null {
  if (!profile) return null;
  const counter = (profile.inventoryCourseIds?.length ?? 0) > 0;
  if (profile.roleId === TRAINER_ROLE_ID) {
    const register = (profile.registerClasses?.length ?? 0) > 0;
    const ok = new RegExp(`^/(school/exams|settings|tutor-files${register ? '|attendance' : ''}${counter ? '|inventory' : ''})(/|$)`);
    return ok.test(path) ? null : '/school/exams';
  }
  if (profile.roleId === LABTECH_ROLE_ID) return /^\/(inventory|settings)(\/|$)/.test(path) ? null : '/inventory';
  if (profile.roleId === HELPER_ROLE_ID) return /^\/($|hope\/register|hope\/gate|hope\/clubs|hope\/photos|hope\/more|settings|help)/.test(path) ? null : '/';
  return null;
}
