import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePeople } from '../../state/PeopleContext';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { PersonRow } from '../../components/PersonRow';
import { matchesSearch, PERSON_STATUSES, PERSON_STATUS_LABELS, type PersonStatus } from '../../../functions/src/shared/people';

const PAGE = 100;

export function PeoplePage() {
  const { people, loading } = usePeople();
  const { can } = useAuth();
  const { current } = useOrg();
  // ADIA lists everyone; church statuses such as Visitor or Member don't apply to a college.
  const showStatus = current?.type !== 'college';
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const status = showStatus ? (params.get('status') ?? '') as PersonStatus | '' : '';
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(
    () => people.filter((p) => (!status || p.status === status) && matchesSearch(p, query)),
    [people, query, status],
  );

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>People</h1>
        {can('people.write') && <Link className="btn btn-primary" to="/people/new">Add person</Link>}
      </div>
      <input
        type="search"
        className="search"
        placeholder="Search by name or phone number"
        aria-label="Search people"
        autoFocus
        value={query}
        onChange={(e) => set('q', e.target.value)}
      />
      {showStatus && <div className="chips" role="group" aria-label="Filter by status">
        <button type="button" className={`chip ${!status ? 'chip-on' : ''}`} onClick={() => set('status', '')}>Everyone</button>
        {PERSON_STATUSES.map((s) => (
          <button key={s} type="button" className={`chip ${status === s ? 'chip-on' : ''}`} onClick={() => set('status', status === s ? '' : s)}>
            {PERSON_STATUS_LABELS[s]}
          </button>
        ))}
      </div>}
      <p className="muted small">{loading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'person' : 'people'}`}</p>
      {results.length > 0 && (
        <ul className="row-list">
          {results.slice(0, limit).map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} />)}
        </ul>
      )}
      {results.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      {!loading && results.length === 0 && query && (
        <div className="notice">
          <p>Nobody matches “{query}”.</p>
          {can('people.write') && <Link className="btn btn-primary" to="/visitors/new">Add as a visitor</Link>}
        </div>
      )}
    </div>
  );
}
