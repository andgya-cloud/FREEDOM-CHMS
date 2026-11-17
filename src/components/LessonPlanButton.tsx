import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { isInventoryManager, TRAINER_ROLE_ID } from '../../functions/src/shared/permissions';
import { AdiaIcon } from './icons';

/**
 * The big gold "Upload lesson plan" button on every teacher's Today (Andy, 2026-11-17, 1A). Teachers are Trainer
 * accounts and anyone who teaches a common course; the principal gets "Lesson plans" to check them.
 */
export function LessonPlanButton() {
  const { profile, can } = useAuth();
  if (!profile) return null;
  const teaches = profile.roleId === TRAINER_ROLE_ID || (profile.commonClasses?.length ?? 0) > 0;
  const checks = isInventoryManager(profile) || can('exams.manage');
  if (!teaches && !checks) return null;
  return (
    <Link to="/tutor-files/lesson-plans" className="lp-hero">
      <span className="lp-hero-ico"><AdiaIcon name="files" /></span>
      <span className="lp-hero-text">
        <b>{teaches ? 'Upload lesson plan' : 'Lesson plans'}</b>
        <span>{teaches ? 'Pick your course and the date, then choose your file' : 'See, approve and download every teacher’s plans'}</span>
      </span>
      <svg className="lp-hero-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </Link>
  );
}
