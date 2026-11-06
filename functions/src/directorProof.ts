import type { DecodedIdToken } from 'firebase-admin/auth';
import { db, type UserProfile } from './common.js';
import { isDirectorProfile } from './shared/permissions.js';

/**
 * How old a password proof is, in seconds. Andy (Andrew Guya's pastor account) needs no password at all
 * (Andy, 2026-11-06, "No password for me at all"): a token freshly made by his own signed-in account counts as
 * just typed. Everyone else's proof is as old as their last password sign-in.
 */
export async function proofAge(t: DecodedIdToken): Promise<number> {
  const now = Date.now() / 1000;
  if (await isAndy(t.uid)) return now - Math.max(t.auth_time, t.iat);
  return now - t.auth_time;
}

export async function isAndy(uid: string): Promise<boolean> {
  const u = (await db.doc(`users/${uid}`).get()).data() as UserProfile | undefined;
  return !!u && u.active !== false && isDirectorProfile(u);
}
