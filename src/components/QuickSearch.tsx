import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePeople } from '../state/PeopleContext';
import { matchesSearch } from '../../functions/src/shared/people';
import { PersonRow } from './PersonRow';

/** "Find anyone by name or phone": matches show as you type. Used on the Today page, and in the ADIA header. */
export function QuickSearch({ className = '' }: { className?: string }) {
  const { people } = usePeople();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim().length >= 2 ? people.filter((p) => matchesSearch(p, query)).slice(0, 8) : []), [people, query]);
  return (
    <div className={`quick-search ${className}`}>
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
      {results.length > 0 && <ul className="row-list" onClick={() => setQuery('')}>{results.map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} />)}</ul>}
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="muted quick-search-none">Nobody matches. <Link to="/visitors/new" onClick={() => setQuery('')}>Add as a visitor</Link></p>
      )}
    </div>
  );
}
