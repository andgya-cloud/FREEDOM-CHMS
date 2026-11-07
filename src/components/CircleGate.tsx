import type { ReactNode } from 'react';
import { useOrg, type Organization } from '../state/OrgContext';
import { circleOf, type CircleType } from '../../functions/src/shared/circles';

/**
 * Opens a conversation page for ADIA or Freedom Church (Andy, 2026-11-07): the current organization when it is the
 * right kind, otherwise a choice of the ones that are. Who may read what is checked by the server.
 */
export function CircleGate({ type, title, children }: { type: CircleType; title: string; children: (org: Organization) => ReactNode }) {
  const { current, organizations, select } = useOrg();
  if (current && current.type === type) return <>{children(current)}</>;
  const fits = organizations.filter((o) => o.type === type && !o.deletedAt);
  if (fits.length === 1 && !current) return <>{children(fits[0]!)}</>;
  return (
    <div className="page narrow">
      <h1>{title}</h1>
      <div className="card">
        {fits.length === 0 ? <p className="muted">{circleOf(type).orgName} is not set up yet.</p> : (
          <>
            <p>This page is for {circleOf(type).orgName}.</p>
            <div className="chips">{fits.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}</div>
          </>
        )}
      </div>
    </div>
  );
}
