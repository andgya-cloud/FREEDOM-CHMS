import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg, type Organization } from '../state/OrgContext';
import { useChildren, useOpenConcerns } from '../state/useHope';
import { consentMissing } from '../../functions/src/shared/hope';

/**
 * On the home screen: how many children have consent missing, and (for the pastor only) open safeguarding
 * concerns. Counts only; nothing here names a child.
 */
export function HopeAlerts() {
  const { organizations } = useOrg();
  const { can } = useAuth();
  if (!can('people.read')) return null;
  return <>{organizations.filter((o) => o.type === 'ministry' && !o.training).map((o) => <OneCenter key={o.id} org={o} />)}</>;
}

function OneCenter({ org }: { org: Organization }) {
  const { select } = useOrg();
  const { children } = useChildren(org.id);
  const concerns = useOpenConcerns(org.id);
  const missing = children.filter(consentMissing).length;
  if (missing === 0 && concerns.length === 0) return null;
  return (
    <section className="card stack" aria-label={`${org.name} alerts`}>
      <h2>{org.name}</h2>
      {concerns.length > 0 && (
        <p className="notice notice-warn">
          <strong>{concerns.length} safeguarding {concerns.length === 1 ? 'concern needs' : 'concerns need'} your attention.</strong>{' '}
          <Link to="/hope" onClick={() => select(org.id)}>Open</Link>
        </p>
      )}
      {missing > 0 && (
        <p className="notice notice-warn small"><span><Link to="/hope/children?consent=missing" onClick={() => select(org.id)}>{missing} {missing === 1 ? 'child has' : 'children have'} consent missing</Link>.</span></p>
      )}
    </section>
  );
}
