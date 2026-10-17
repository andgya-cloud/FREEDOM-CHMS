import { Link } from 'react-router-dom';
import type { Person } from '../state/PeopleContext';
import { useOrg } from '../state/OrgContext';
import { PERSON_STATUS_LABELS } from '../../functions/src/shared/people';
import { formatPhone } from '../../functions/src/shared/phone';

export function PersonRow({ person }: { person: Person }) {
  const { isCombined, organizations } = useOrg();
  const orgName = isCombined ? organizations.find((o) => o.id === person.orgId)?.name : null;
  return (
    <li className="row">
      <Link to={`/people/${person.orgId}/${person.id}`} className="row-main">
        <span className="row-title">
          {person.fullName}
          <span className={`badge badge-${person.status}`}>{PERSON_STATUS_LABELS[person.status]}</span>
          {(person.possibleDuplicateIds?.length ?? 0) > 0 && <span className="badge badge-warn">Possible duplicate</span>}
        </span>
        <span className="row-detail">
          {formatPhone(person.phone) || 'No phone'}
          {orgName ? ` · ${orgName}` : ''}
        </span>
      </Link>
    </li>
  );
}
