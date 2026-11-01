import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePeople } from '../../state/PeopleContext';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { lookFor } from '../../lib/look';
import { PersonRow } from '../../components/PersonRow';
import { FamilyCard, FamilySuggestions } from '../../components/FamilyCard';
import { useHouseholds } from '../../state/useFamilies';
import { familyGroups, familyName, familySuggestions, groupedList } from '../../../functions/src/shared/families';
import { matchesSearch, PERSON_STATUS_LABELS, statusesFor, type PersonStatus } from '../../../functions/src/shared/people';

const PAGE = 100;

export function PeoplePage() {
  const { people, loading } = usePeople();
  const { can } = useAuth();
  const { current } = useOrg();
  // ADIA lists everyone; church statuses such as Visitor or Member don't apply to a college.
  const showStatus = current?.type !== 'college';
  // The menu-down-the-side places already have a search box at the top of every page (Andy, 2026-10-31, 1A).
  const topSearch = lookFor(current) !== 'standard';
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const status = showStatus ? (params.get('status') ?? '') as PersonStatus | '' : '';
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(
    () => people.filter((p) => (!status || p.status === status) && matchesSearch(p, query)),
    [people, query, status],
  );

  // Families sit together in one card (Andy, 2026-11-01, 1A-7A); a search or filter lists the matching people.
  const church = current?.type === 'church_campus';
  const households = useHouseholds(church ? current?.id ?? '' : '');
  const grouped = church && !query && !status;
  const items = useMemo(() => (grouped ? groupedList(results) : []), [grouped, results]);
  const families = useMemo(() => (church ? familyGroups(people) : new Map()), [church, people]);
  const suggestions = useMemo(() => (church ? familySuggestions(people, households.dismissed) : []), [church, people, households.dismissed]);
  const familyOf = (householdId?: string | null) => {
    const members = householdId ? families.get(householdId) : undefined;
    return members ? familyName(members, households.names.get(householdId!)) : null;
  };

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
      {!topSearch && (
        <input
          type="search"
          className="search"
          placeholder="Search by name or phone number"
          aria-label="Search people"
          autoFocus
          value={query}
          onChange={(e) => set('q', e.target.value)}
        />
      )}
      {topSearch && query && (
        <p className="muted small">Showing people matching “{query}”. <button type="button" className="link-button-inline" onClick={() => set('q', '')}>Show everyone</button></p>
      )}
      {/* Programmes live under People at Freedom Church (Andy, 2026-11-01, 7A). */}
      {current?.type === 'church_campus' && (
        <Link className="card people-programs" to="/programs">
          <b>Classes and programmes</b>
          <span className="muted small">Growth Track, teams and small groups</span>
        </Link>
      )}
      {showStatus && (
        <label className="filter-select">
          <span className="visually-hidden">Show</span>
          <select value={status} onChange={(e) => set('status', e.target.value)} aria-label="Filter by status">
            <option value="">Everyone</option>
            {statusesFor(current?.type).map((s) => <option key={s} value={s}>{PERSON_STATUS_LABELS[s]}</option>)}
          </select>
        </label>
      )}
      {church && current && <FamilySuggestions orgId={current.id} suggestions={suggestions} existing={households.existing} />}
      <p className="muted small">{loading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'person' : 'people'}${grouped && families.size ? ` in ${items.length} ${items.length === 1 ? 'row' : 'rows'}` : ''}`}</p>
      {grouped && items.length > 0 && (
        <ul className="row-list">
          {items.slice(0, limit).map((i) => (i.kind === 'family'
            ? <FamilyCard key={i.id} members={i.members} name={households.names.get(i.id)} />
            : <PersonRow key={`${i.person.orgId}/${i.person.id}`} person={i.person} />))}
        </ul>
      )}
      {grouped && items.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      {!grouped && results.length > 0 && (
        <ul className="row-list">
          {results.slice(0, limit).map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} family={familyOf(p.householdId)} />)}
        </ul>
      )}
      {!grouped && results.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      {!loading && results.length === 0 && query && (
        <div className="notice">
          <p>Nobody matches “{query}”.</p>
          {can('people.write') && <Link className="btn btn-primary" to="/visitors/new">Add as a visitor</Link>}
        </div>
      )}
    </div>
  );
}
