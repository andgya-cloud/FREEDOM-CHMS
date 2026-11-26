import { ALL_ORGS, useOrg } from '../state/OrgContext';
import { useAuth } from '../state/AuthContext';

export function OrgSwitcher() {
  const { organizations: own, limitedOrg, currentId, select } = useOrg();
  const { profile } = useAuth();
  // The "Freedom Church, limited" church is on the list too (Andy, 2026-11-26, 1A).
  const organizations = limitedOrg ? [...own, limitedOrg] : own;
  if (organizations.length === 0) return null;
  if (organizations.length === 1) return <span className="org-name">{organizations[0]!.name}</span>;
  return (
    <div className="org-switcher">
      <select aria-label="Organization" value={currentId} onChange={(e) => select(e.target.value)}>
        {profile?.allOrgs && <option value={ALL_ORGS}>All organizations</option>}
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.id === limitedOrg?.id ? ' (your jobs)' : ''}</option>
        ))}
      </select>
    </div>
  );
}
