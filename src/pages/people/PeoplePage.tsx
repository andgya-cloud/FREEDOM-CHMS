import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePeople } from '../../state/PeopleContext';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { lookFor } from '../../lib/look';
import { PersonRow } from '../../components/PersonRow';
import { statusOptions, useCanChangeStatus, useStatusChanger } from '../../components/StatusPicker';
import type { Person } from '../../state/PeopleContext';
import { FamilyCard, FamilySuggestions } from '../../components/FamilyCard';
import { useWaitingSignups } from './SignupsPage';
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
  const status = showStatus ? (params.get('status') ?? '') as PersonStatus | 'signup' | '' : '';
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(
    () => people.filter((p) => (!status || (status === 'signup' ? !!p.signup : p.status === status)) && matchesSearch(p, query)),
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

  // Andrew and Doreen change statuses from the list, one at a time or several at once (Andy, 2026-11-02, 1A 2A 3).
  const edit = useCanChangeStatus();
  const changeStatus = useStatusChanger();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickFor = (p: Person) => (selecting ? {
    on: picked.has(p.id),
    toggle: () => setPicked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; }),
  } : undefined);
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const applyToPicked = (next: PersonStatus) => {
    changeStatus(people.filter((p) => picked.has(p.id)), next);
    stopSelecting();
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
        <span className="page-head-actions">
          {edit && !selecting && <button type="button" className="btn" onClick={() => setSelecting(true)}>Select</button>}
          {can('people.write') && <Link className="btn btn-primary" to="/people/new">Add person</Link>}
        </span>
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
            {church && <option value="signup">New sign-ups</option>}
          </select>
        </label>
      )}
      {church && can('people.write') && <p className="small people-join-link"><Link to="/people/join-qr">Family sign-up QR code</Link> <span className="muted">· download or share it</span>{edit && <> · <ApproveLink orgId={current?.id} /></>}</p>}
      {church && current && <FamilySuggestions orgId={current.id} suggestions={suggestions} existing={households.existing} />}
      <p className="muted small">{loading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'person' : 'people'}${grouped && families.size ? ` in ${items.length} ${items.length === 1 ? 'row' : 'rows'}` : ''}`}</p>
      {selecting && (
        <div className="select-bar" role="region" aria-label="Change status of the people chosen">
          <span><b>{picked.size}</b> chosen</span>
          <select value="" disabled={picked.size === 0} aria-label="Change status to" onChange={(e) => e.target.value && applyToPicked(e.target.value as PersonStatus)}>
            <option value="">Change status to…</option>
            {statusOptions(current?.type).map((s) => <option key={s} value={s}>{PERSON_STATUS_LABELS[s]}</option>)}
          </select>
          <button type="button" className="btn btn-quiet" onClick={stopSelecting}>Cancel</button>
        </div>
      )}
      {grouped && items.length > 0 && (
        <ul className="row-list">
          {items.slice(0, limit).map((i) => (i.kind === 'family'
            ? <FamilyCard key={i.id} members={i.members} name={households.names.get(i.id)} edit={edit && !selecting} pickFor={selecting ? pickFor : undefined} />
            : <PersonRow key={`${i.person.orgId}/${i.person.id}`} person={i.person} edit={edit && !selecting} pick={pickFor(i.person)} />))}
        </ul>
      )}
      {grouped && items.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      {!grouped && results.length > 0 && (
        <ul className="row-list">
          {results.slice(0, limit).map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} family={familyOf(p.householdId)} edit={edit && !selecting} pick={pickFor(p)} />)}
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

/** "Approve sign-ups", red with the count while forms wait, black when none do (Andy, 2026-11-02). */
function ApproveLink({ orgId }: { orgId: string | undefined }) {
  const { rows } = useWaitingSignups(orgId, true);
  return <Link to="/people/signups" className={rows.length ? 'signups-waiting-link' : 'signups-clear-link'}>Approve sign-ups{rows.length ? ` (${rows.length})` : ''}</Link>;
}
