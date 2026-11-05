import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePeople } from '../state/PeopleContext';
import { matchesSearch } from '../../functions/src/shared/people';
import { PersonRow } from './PersonRow';
import { useOrg, type Organization } from '../state/OrgContext';
import { useHopePage } from '../pages/hope/common';
import { normalizeCode } from '../../functions/src/shared/hope';

/** "Find anyone by name or phone": matches show as you type. Used on the Today page, and in the ADIA header. */
export function QuickSearch({ className = '' }: { className?: string }) {
  const { current } = useOrg();
  return current?.type === 'ministry' ? <ChildSearch org={current} className={className} /> : <PeopleSearch className={className} />;
}

/**
 * The Hope Centre's one search (v182, 8A): a child by name, HC code or the parent's phone, from the top of every page.
 * Enter shows all the matches on Children.
 */
function ChildSearch({ org, className }: { org: Organization; className: string }) {
  const h = useHopePage(org);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (t.length < 2) return [];
    const digits = t.replace(/\D/g, '').replace(/^254/, '0');
    const code = normalizeCode(query);
    return h.children.filter((c) => h.nameOf(c.id).toLowerCase().includes(t) || (!!code && c.code === code) || (c.code ?? '').toLowerCase().includes(t)
      || (digits.length >= 4 && (c.parentPhone ?? '').replace(/\D/g, '').replace(/^254/, '0').includes(digits))).slice(0, 8);
  }, [h, query]);
  return (
    <div className={`quick-search ${className}`}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setQuery(''); navigate(`/hope/children?show=all&q=${encodeURIComponent(query)}`); }}>
        <input type="search" className="search" placeholder="Find a child by name, code or parent's phone" aria-label="Find a child" value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>
      {results.length > 0 && (
        <ul className="row-list" onClick={() => setQuery('')}>
          {results.map((c) => <li key={c.id} className="row"><Link to={`/hope/children/${c.id}`} className="row-main"><span className="row-title">{h.nameOf(c.id)}</span><span className="row-detail">{[c.code, c.parentName].filter(Boolean).join(' · ')}</span></Link></li>)}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && <p className="muted quick-search-none">No child matches.</p>}
    </div>
  );
}

function PeopleSearch({ className }: { className: string }) {
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
