import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { usePeople } from '../state/PeopleContext';
import { formatDate } from '../../functions/src/shared/datetime';
import { matchesSearch } from '../../functions/src/shared/people';
import { FirstRunChecklist } from '../components/FirstRunChecklist';
import { PersonRow } from '../components/PersonRow';

/**
 * The home screen: search first, then the four big actions.
 * Check in (Stage 3), Record gift (Stage 5) and Follow-ups (Stage 6) say when
 * they arrive instead of opening an empty screen.
 */
const ACTIONS = [
  { label: 'Check in', to: null, stage: 3, icon: 'M9 12l2 2 4-4M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0' },
  { label: 'Add visitor', to: '/visitors/new', stage: 2, icon: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6' },
  { label: 'Record gift', to: null, stage: 5, icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6' },
  { label: 'Follow-ups', to: null, stage: 6, icon: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z' },
] as const;

export function TodayPage() {
  const { profile, can } = useAuth();
  const { current, isCombined, organizations, loading } = useOrg();
  const { people } = usePeople();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const firstName = profile?.displayName.split(' ')[0] ?? '';
  const results = useMemo(() => (query.trim().length >= 2 ? people.filter((p) => matchesSearch(p, query)).slice(0, 8) : []), [people, query]);

  return (
    <div className="page">
      <p className="muted">{formatDate(new Date())}</p>
      <h1>Hello{firstName ? `, ${firstName}` : ''}</h1>
      {!loading && organizations.length > 0 && (
        <p className="lead">{isCombined ? 'All organizations' : current?.name}</p>
      )}

      {can('people.read') && organizations.length > 0 && (
        <form role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/people?q=${encodeURIComponent(query)}`); }}>
          <input
            type="search"
            className="search"
            placeholder="Find anyone by name or phone"
            aria-label="Find a person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      )}
      {results.length > 0 && <ul className="row-list">{results.map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} />)}</ul>}
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="muted">Nobody matches. <Link to="/visitors/new">Add as a visitor</Link></p>
      )}

      <FirstRunChecklist />

      <div className="big-actions">
        {ACTIONS.map((a) => {
          const ready = a.to && organizations.length > 0 && (a.to !== '/visitors/new' || can('people.write'));
          return ready ? (
            <Link key={a.label} to={a.to!} className="big-action">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
              <span className="big-action-label">{a.label}</span>
            </Link>
          ) : (
            <button key={a.label} type="button" className="big-action" disabled aria-describedby={`soon-${a.stage}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
              <span className="big-action-label">{a.label}</span>
              <span id={`soon-${a.stage}`} className="big-action-soon">{a.to ? 'Add an organization first' : `Arrives in Stage ${a.stage}`}</span>
            </button>
          );
        })}
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
