import { useAuth } from '../state/AuthContext';
import { isDirectorProfile } from '../../functions/src/shared/permissions';

/** Andy (Andrew Guya's pastor account) changes anything with no password (Andy, 2026-11-06). */
export function useIsAndy(): boolean {
  const { profile } = useAuth();
  return isDirectorProfile(profile);
}
