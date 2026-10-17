import { ALL_ORGS, useOrg } from '../state/OrgContext';
import { useAuth } from '../state/AuthContext';

export function OrgSwitcher() {
  const { organizations, currentId, select } = useOrg();
  const { profile } = useAuth();
  if (organizations.length === 0) return null;
  if (organizations.length === 1) return <span className="org-name">{organizations[0]!.name}</span>;
  return (
    <div className="org-switcher">
      <select aria-label="Organization" value={currentId} onChange={(e) => select(e.target.value)}>
        {profile?.allOrgs && <option value={ALL_ORGS}>All organizations</option>}
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
