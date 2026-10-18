import type { ReactNode } from 'react';
import { useOrg, type Organization } from '../state/OrgContext';

/**
 * Programmes, Dream Team and Freedom Groups belong to church campuses.
 * Shows the page for the selected campus, or asks which campus to open.
 */
export function CampusGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
  const { current, isCombined, organizations, select } = useOrg();
  if (current && current.type === 'church_campus') return <>{children(current)}</>;

  const campuses = organizations.filter((o) => o.type === 'church_campus');
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        {current && !isCombined && <p>{current.name} does not run church programmes. Its classes and sessions are under Attendance.</p>}
        {campuses.length === 0 ? (
          <p className="muted">Add a church campus in Settings first.</p>
        ) : (
          <>
            <p>Which campus?</p>
            <div className="chips">
              {campuses.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
