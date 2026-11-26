import { HELPER_ROLE_ID, TEACHER_ROLE_ID, LABTECH_ROLE_ID, LIBRARIAN_ROLE_ID, TRAINER_ROLE_ID } from '../../functions/src/shared/permissions';

export interface RoleProfile { roleId?: string; registerClasses?: unknown[]; inventoryCourseIds?: unknown[]; extraPermissions?: readonly string[] }

/**
 * Some roles only see a few pages (Andy, 2026-10-25 to 2026-11-04): a trainer their marks sheets, a lab technician
 * their inventory, a Hope helper the registers and clubs. Returns where such a person is sent instead, or null when
 * the page is theirs. The menu and "Just ask Andy" both read this, so they always agree.
 */
export function roleRedirect(profile: RoleProfile | null | undefined, path: string): string | null {
  if (!profile) return null;
  // The Sunday prayer schedule is open to whoever holds its tick, whatever their role (Andy, 2026-11-26, 3A).
  if (/^\/prayer-schedule(\/|$)/.test(path) && (profile.extraPermissions ?? []).includes('prayer.manage')) return null;
  const counter = (profile.inventoryCourseIds?.length ?? 0) > 0;
  if (profile.roleId === TRAINER_ROLE_ID) {
    const register = (profile.registerClasses?.length ?? 0) > 0;
    // Their own Today, with the ADIA welcome card, is theirs too (Andy, 2026-11-11).
    const ok = new RegExp(`^/(school/exams|school/timetable|settings|manual|calendar|tutor-files|reviews${register ? '|attendance' : ''}${counter ? '|inventory' : ''})(/|$)`);
    return path === '/' || ok.test(path) ? null : '/';
  }
  if (profile.roleId === LABTECH_ROLE_ID) return path === '/' || /^\/(inventory|school\/timetable|settings|manual|calendar)(\/|$)/.test(path) ? null : '/';
  // A Librarian sees only the ADIA library (Andy, 2026-11-18, 2A).
  if (profile.roleId === LIBRARIAN_ROLE_ID) return path === '/' || /^\/(library|school\/timetable|settings|manual|calendar)(\/|$)/.test(path) ? null : '/';
  // A class teacher (Andy, 2026-11-22, 10A): Today, their register, the birthdays and the Teachers' room.
  if (profile.roleId === TEACHER_ROLE_ID) return /^\/($|hope\/register|hope\/birthdays|hope\/photos|hope\/more|settings|manual|help)/.test(path) ? null : '/';
  // A Sunday school teacher (Andy, 2026-11-23, 9A): the Sunday school page (their class count and the room).
  if (profile.roleId === 'ssteacher') return /^\/(sunday-school|settings|manual|help)(\/|$)/.test(path) ? null : '/sunday-school';
  // The youth leader (Andy, 2026-11-24: Sheila): the youth page (the count, the timetable and the Youth room).
  if (profile.roleId === 'youth') return /^\/(youth|settings|manual|help)(\/|$)/.test(path) ? null : '/youth';
  if (profile.roleId === HELPER_ROLE_ID) return /^\/($|hope\/register|hope\/gate|hope\/clubs|hope\/photos|hope\/more|settings|manual|calendar|help)/.test(path) ? null : '/';
  return null;
}
