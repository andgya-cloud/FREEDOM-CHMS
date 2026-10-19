import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { ALL_ORGS, useOrg } from '../state/OrgContext';

/** Big buttons on the home screen to switch organization. A college opens its School section. */
export function OrgButtons() {
  const { organizations, currentId, select, loading } = useOrg();
  const { can, profile } = useAuth();
  const navigate = useNavigate();
  if (loading) return null;
  const real = organizations.filter((o) => !o.training);
  const hasCollege = organizations.some((o) => o.type === 'college');
  if (real.length < 2 && (hasCollege || !can('settings.manage'))) return null;
  return (
    <section className="card stack" aria-label="Switch organization">
      <h2>Where are you working?</h2>
      <div className="chips">
        {profile?.allOrgs && organizations.length > 1 && (
          <button type="button" className={`chip${currentId === ALL_ORGS ? ' chip-on' : ''}`} onClick={() => select(ALL_ORGS)}>All</button>
        )}
        {organizations.map((o) => (
          <button key={o.id} type="button" className={`chip${currentId === o.id ? ' chip-on' : ''}`} aria-pressed={currentId === o.id}
            onClick={() => { select(o.id); if (o.type === 'college') navigate('/school'); }}>
            {o.name}{o.type === 'college' ? ' → School' : ''}
          </button>
        ))}
      </div>
      {!hasCollege && can('settings.manage') && (
        <p className="notice notice-warn small">ADIA Training Centre has not been added yet. <Link to="/settings/organizations/new">Add it here</Link> (choose "ADIA Training Centre" from the list of suggestions, type College).</p>
      )}
    </section>
  );
}
