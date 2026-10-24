import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, requireCaller, requireString, type UserProfile } from './common.js';
import { canAccessOrg } from './shared/permissions.js';

const CALLABLE = { invoker: 'public' } as const;
const perms = (u: UserProfile | undefined) => u?.permissions ?? [];

/**
 * The trainers the principal can give a course to (Andy, 2026-10-24): active accounts in this
 * organization that may key in marks. Only the principal (or the pastor) can ask.
 */
export const listExamTrainers = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | null)?.orgId, 'the organization', { max: 80 });
  const mine = perms(caller.profile);
  if (!canAccessOrg(caller.profile, orgId) || !(mine.includes('exams.manage') || mine.includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'Only the principal sets up courses.');
  }
  const users = await db.collection('users').where('active', '==', true).get();
  const trainers = users.docs
    .filter((d) => { const u = d.data() as UserProfile; const p = perms(u); return canAccessOrg(u, orgId) && (p.includes('exams.mark') || p.includes('exams.manage') || p.includes('users.manage')); })
    .map((d) => { const u = d.data() as UserProfile; return { uid: d.id, name: u.displayName || u.email, phone: u.phone ?? '' }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { trainers };
});
