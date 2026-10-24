import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useSchool, type StudentRow } from '../../state/useSchool';
import { formatMoney } from '../../../functions/src/shared/giving';
import { localDateKey } from '../../../functions/src/shared/datetime';

/** The ADIA screens belong to a college organization; asks which one when another is selected. */
export function SchoolGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
  const { current, isCombined, organizations, select } = useOrg();
  if (current && current.type === 'college') return <>{children(current)}</>;
  const colleges = organizations.filter((o) => o.type === 'college' && !o.deletedAt);
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        {current && !isCombined && <p>{current.name} is not a training centre.</p>}
        {colleges.length === 0 ? <p className="muted">Add a college in Settings → Organizations first.</p> : (
          <>
            <p>Which centre?</p>
            <div className="chips">{colleges.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** The row of school sections shown at the top of every ADIA page. */
export function SchoolNav({ feesAllowed }: { feesAllowed: boolean }) {
  const { can } = useAuth();
  const items: [string, string, boolean][] = [
    ['/school', 'Overview', true], ['/school/students', 'Students', true], ['/school/courses', 'Courses', true],
    ['/school/results', 'Results', true], ['/school/exams', 'Exam Records', can('exams.mark') || can('exams.manage') || can('users.manage')], ['/school/fees', 'Fees', feesAllowed], ['/school/graduation', 'Graduation', true],
    ['/school/reports', 'Reports', can('finance.reports')],
  ];
  return (
    <nav className="chips" aria-label="School">
      {items.filter((i) => i[2]).map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/school'} className={({ isActive }) => `chip${isActive ? ' chip-on' : ''}`}>{label}</NavLink>
      ))}
    </nav>
  );
}

export function useSchoolPage(org: Organization) {
  const data = useSchool(org.id);
  const { byId, loading: peopleLoading } = usePeople();
  const nameOf = (id: string) => byId(id)?.fullName ?? (peopleLoading ? '…' : 'Unknown student');
  const today = localDateKey(new Date(), org.timeZone);
  const courseName = (id: string) => data.courses.find((c) => c.id === id)?.name ?? '';
  const intakeName = (id: string) => data.intakes.find((i) => i.id === id)?.name ?? '';
  return { ...data, peopleLoading, nameOf, today, courseName, intakeName, byId };
}

export const money = (org: Organization, cents: number) => formatMoney(cents, org.currency || 'KES');
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
export type StudentWithName = StudentRow & { name: string };
