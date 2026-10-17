import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { formatDate } from '../../functions/src/shared/datetime';
import { FirstRunChecklist } from '../components/FirstRunChecklist';

/**
 * The home screen. The four big actions arrive in later stages:
 * Add visitor (Stage 2), Check in (Stage 3), Record gift (Stage 5), Follow-ups (Stage 6).
 * Until a stage ships, its button says when it is coming instead of opening an empty screen.
 */
const ACTIONS = [
  { label: 'Check in', stage: 3, icon: 'M9 12l2 2 4-4M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0' },
  { label: 'Add visitor', stage: 2, icon: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6' },
  { label: 'Record gift', stage: 5, icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6' },
  { label: 'Follow-ups', stage: 6, icon: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z' },
] as const;

export function TodayPage() {
  const { profile } = useAuth();
  const { current, isCombined, organizations, loading } = useOrg();
  const firstName = profile?.displayName.split(' ')[0] ?? '';

  return (
    <div className="page">
      <p className="muted">{formatDate(new Date())}</p>
      <h1>Hello{firstName ? `, ${firstName}` : ''}</h1>
      {!loading && organizations.length > 0 && (
        <p className="lead">{isCombined ? 'All organizations' : current?.name}</p>
      )}

      <FirstRunChecklist />

      <div className="big-actions">
        {ACTIONS.map((a) => (
          <button key={a.label} type="button" className="big-action" disabled aria-describedby={`soon-${a.stage}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
            <span className="big-action-label">{a.label}</span>
            <span id={`soon-${a.stage}`} className="big-action-soon">Arrives in Stage {a.stage}</span>
          </button>
        ))}
      </div>

      {!loading && organizations.length === 0 && (
        <div className="notice">
          <p>No organizations are set up for your account yet.</p>
          {profile?.permissions.includes('settings.manage') && profile.allOrgs
            ? <Link className="btn btn-primary" to="/settings/organizations/new">Add an organization</Link>
            : <p className="muted">Ask the pastor to give you access.</p>}
        </div>
      )}
    </div>
  );
}
