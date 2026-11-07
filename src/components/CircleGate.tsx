import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useOrg, type Organization } from '../state/OrgContext';
import { circleOf, isCircleType, type CircleType } from '../../functions/src/shared/circles';

/**
 * Opens a conversation page for ADIA or Freedom Church (Andy, 2026-11-07): the current organization when it is the
 * right kind, otherwise a choice of the ones that are. Who may read what is checked by the server.
 */
export function CircleGate({ type, title, page, children }: { type: CircleType; title: string; page: CirclePage; children: (org: Organization) => ReactNode }) {
  const { current, organizations, select } = useOrg();
  const { search } = useLocation();
  if (current && current.type === type) return <>{children(current)}</>;
  // Switched to another organization while here (Andy, 2026-11-07): open that organization's own page instead.
  // A link to one report or conversation (from an email) keeps the choice, so it is not lost.
  if (current && isCircleType(current.type) && !isOneItem(page, search)) return <Navigate to={circlePageFor(current.type, page)} replace />;
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

export type CirclePage = 'photos' | 'vault' | 'chat';
/** The same page in another organization: a single conversation goes back to that organization's list. */
export function circlePageFor(type: CircleType, page: CirclePage): string {
  const c = circleOf(type);
  return page === 'photos' ? c.photosPath : c.vaultPath;
}
export const isOneItem = (page: CirclePage, search: string) => page === 'chat' || /[?&]report=/.test(search);
