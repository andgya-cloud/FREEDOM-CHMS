import type { ReactNode } from 'react';
import { useOrg, type Organization } from '../state/OrgContext';

/**
 * Giving is kept per organization (each has its own receipt numbers).
 * Shows the page for the selected organization, or asks which one to open
 * when the combined view is selected.
 */
export function OrgGate({ title, children }: { title: string; children: (org: Organization) => ReactNode }) {
  const { current, organizations, select } = useOrg();
  if (current) return <>{children(current)}</>;
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        {organizations.length === 0 ? <p className="muted">Add an organization in Settings first.</p> : (
          <>
            <p>Which organization?</p>
            <div className="chips">
              {organizations.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
