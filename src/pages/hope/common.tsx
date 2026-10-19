import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useHope, type ChildRow } from '../../state/useHope';
import { ageOn } from '../../../functions/src/shared/hope';

/** The Hope Center screens belong to a ministry organization; asks which one when another is selected. */
export function HopeGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
  const { current, isCombined, organizations, select } = useOrg();
  if (current && current.type === 'ministry') return <>{children(current)}</>;
  const ministries = organizations.filter((o) => o.type === 'ministry' && !o.deletedAt);
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        {current && !isCombined && <p>{current.name} is not a ministry.</p>}
        {ministries.length === 0 ? <p className="muted">Add the Freedom Hope Center in Settings → Organizations first (type Ministry).</p> : (
          <>
            <p>Which ministry?</p>
            <div className="chips">{ministries.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** The row of Hope Center sections shown at the top of every page. */
export function HopeNav() {
  const { can } = useAuth();
  const items: [string, string, boolean][] = [
    ['/hope', 'Overview', true], ['/hope/children', 'Children', true], ['/hope/reports', 'Reports', true], ['/hope/exports', 'Exports', can('people.read')],
  ];
  return (
    <nav className="chips" aria-label="Hope Center">
      {items.filter((i) => i[2]).map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/hope'} className={({ isActive }) => `chip${isActive ? ' chip-on' : ''}`}>{label}</NavLink>
      ))}
    </nav>
  );
}

export function useHopePage(org: Organization) {
  const data = useHope(org);
  const { byId, loading: peopleLoading } = usePeople();
  const nameOf = (id: string) => byId(id)?.fullName ?? (peopleLoading ? '…' : 'Unknown child');
  const codeOf = (c: Pick<ChildRow, 'code'>) => c.code || 'code pending';
  const ageOf = (c: ChildRow) => ageOn(c.dateOfBirth, data.today);
  return { ...data, peopleLoading, nameOf, codeOf, ageOf, byId };
}

export const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
