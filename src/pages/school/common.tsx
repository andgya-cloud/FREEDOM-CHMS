import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

/**
 * One "Go to" dropdown at the top of every school page, in place of a row of buttons (Andy, 2026-10-26, 2A).
 * The dashboard is Today and Exam Records sits in the side menu, so neither is repeated here (1A, 3A).
 */
export function SchoolNav({ feesAllowed }: { feesAllowed: boolean }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const items: [string, string, boolean][] = [
    ['/school/students', 'Students', true], ['/school/courses', 'Programmes', true], ['/school/fees', 'Fees', feesAllowed],
    ['/school/graduation', 'Graduation', true], ['/school/reports', 'Reports', can('finance.reports')],
  ];
  const shown = items.filter((i) => i[2]);
  const here = shown.find(([to]) => pathname === to || pathname.startsWith(`${to}/`))?.[0] ?? '';
  return (
    <label className="field school-goto no-print"><span>Go to</span>
      <select value={here} onChange={(e) => navigate(e.target.value)}>
        {!here && <option value="">Choose…</option>}
        {shown.map(([to, label]) => <option key={to} value={to}>{label}</option>)}
      </select>
    </label>
  );
}

export function useSchoolPage(org: Organization) {
  const data = useSchool(org.id);
  const { byId, loading: peopleLoading } = usePeople();
  const nameOf = (id: string) => byId(id)?.fullName ?? data.rosterNames.get(id) ?? (peopleLoading ? '…' : 'Unknown student');
  const today = localDateKey(new Date(), org.timeZone);
  const courseName = (id: string) => data.courses.find((c) => c.id === id)?.name ?? '';
  const intakeName = (id: string) => data.intakes.find((i) => i.id === id)?.name ?? '';
  return { ...data, peopleLoading, nameOf, today, courseName, intakeName, byId };
}

export const money = (org: Organization, cents: number) => formatMoney(cents, org.currency || 'KES');
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
export type StudentWithName = StudentRow & { name: string };
