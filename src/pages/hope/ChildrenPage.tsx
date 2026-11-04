import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { consentMissing, isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { kidRate } from '../../../functions/src/shared/hopeRegister';
import { useChildPhotos, useHopeDays } from '../../state/useHope';
import { Avatar, PctBadge } from './registerParts';
import { HopeGate, HopeNav, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function ChildrenPage() {
  return <HopeGate title="Children">{(org) => <Children org={org} />}</HopeGate>;
}

function Children({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'current' | 'departing' | 'exited' | 'all'>('current');
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const onlyMissing = params.get('consent') === 'missing';

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return h.children
      .map((c) => ({ c, name: h.nameOf(c.id) }))
      .filter(({ c, name }) => (status === 'all' || (status === 'current' ? isCurrentChild(c) : c.status === status)) && (!onlyMissing || consentMissing(c))
        && (!text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code)))
      .sort((a, b) => (a.c.code ?? 'ZZ').localeCompare(b.c.code ?? 'ZZ') || a.name.localeCompare(b.name));
  }, [h.children, h.nameOf, q, status, onlyMissing]);

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Children</h1>{can('people.write') && <div className="chips"><Link to="/hope/children/import" className="btn">Upload from Excel</Link><Link to="/hope/children/new" className="btn btn-primary">Register a child</Link></div>}</div>
      <HopeNav />
      <input type="search" className="search" placeholder="Find by name or code, for example HC-0042" aria-label="Find a child" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" role="group" aria-label="Status">
        {(['current', 'departing', 'exited', 'all'] as const).map((v) => (
          <button key={v} type="button" className={`chip${status === v ? ' chip-on' : ''}`} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {v === 'current' ? 'Current' : v === 'departing' ? 'Departing' : v === 'exited' ? 'Past children' : 'All'}
          </button>
        ))}
        <button type="button" className={`chip${onlyMissing ? ' chip-on' : ''}`} aria-pressed={onlyMissing}
          onClick={() => setParams(onlyMissing ? {} : { consent: 'missing' })}>Consent missing</button>
      </div>
      {h.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No children match. {h.children.length === 0 && 'Register the first child with the button above.'}</p></div> : (
        <ul className="link-list">
          {rows.map(({ c, name }) => {
            const age = h.ageOf(c);
            return (
              <li key={c.id}>
                <Link to={`/hope/children/${c.id}`} className="hr-who">
                  <Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} />
                  <span className="grow">
                  <span className="link-title">
                    <span className="muted small">{h.codeOf(c)}</span> {name}
                    {consentMissing(c) && <span className="badge badge-warn">Consent missing</span>}
                    {c.status === 'departing' && <span className="badge badge-warn">Departing</span>}
                    {c.status === 'exited' && <span className="badge badge-muted">Departed</span>}
                  </span>
                  <span className="link-detail">{[age != null ? `${age} years` : '', c.dateOfBirth ? `born ${c.dateOfBirth.slice(8)}/${c.dateOfBirth.slice(5, 7)}` : '', c.school, c.sponsorName ? `sponsor ${c.sponsorName}` : '', c.parentPhone || ''].filter(Boolean).join(' · ') || 'No details yet'}</span>
                  </span>
                  <PctBadge pct={kidRate(c.id, days).pct} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
