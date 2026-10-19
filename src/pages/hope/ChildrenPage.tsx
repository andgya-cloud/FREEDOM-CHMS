import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { consentMissing, normalizeCode } from '../../../functions/src/shared/hope';
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
  const [status, setStatus] = useState<'active' | 'exited' | 'all'>('active');
  const onlyMissing = params.get('consent') === 'missing';

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return h.children
      .map((c) => ({ c, name: h.nameOf(c.id) }))
      .filter(({ c, name }) => (status === 'all' || c.status === status) && (!onlyMissing || consentMissing(c))
        && (!text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code)))
      .sort((a, b) => (a.c.code ?? 'ZZ').localeCompare(b.c.code ?? 'ZZ') || a.name.localeCompare(b.name));
  }, [h.children, h.nameOf, q, status, onlyMissing]);

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Children</h1>{can('people.write') && <Link to="/hope/children/new" className="btn btn-primary">Register a child</Link>}</div>
      <HopeNav />
      <input type="search" className="search" placeholder="Find by name or code, for example HC-0042" aria-label="Find a child" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" role="group" aria-label="Status">
        {(['active', 'exited', 'all'] as const).map((v) => (
          <button key={v} type="button" className={`chip${status === v ? ' chip-on' : ''}`} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {v === 'active' ? 'Active' : v === 'exited' ? 'Left' : 'All'}
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
                <Link to={`/hope/children/${c.id}`}>
                  <span className="link-title">
                    <span className="muted small">{h.codeOf(c)}</span> {name}
                    {consentMissing(c) && <span className="badge badge-warn">Consent missing</span>}
                    {c.status === 'exited' && <span className="badge badge-muted">Left</span>}
                  </span>
                  <span className="link-detail">{age != null ? `${age} years · ` : ''}{c.programmes.map((p) => p.name).join(', ') || 'No programme yet'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
