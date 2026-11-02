import { Link } from 'react-router-dom';
import type { Person } from '../state/PeopleContext';
import { useOrg } from '../state/OrgContext';
import { PERSON_STATUS_LABELS } from '../../functions/src/shared/people';
import { formatPhone } from '../../functions/src/shared/phone';
import { StatusPicker } from './StatusPicker';

export interface RowPick { on: boolean; toggle: () => void }

export function PersonRow({ person, family, edit, pick }: { person: Person; family?: string | null; edit?: boolean; pick?: RowPick }) {
  const { isCombined, organizations } = useOrg();
  const orgName = isCombined ? organizations.find((o) => o.id === person.orgId)?.name : null;
  return (
    <li className={`row${pick?.on ? ' row-picked' : ''}`}>
      {pick && <input type="checkbox" className="row-pick" checked={pick.on} onChange={pick.toggle} aria-label={`Choose ${person.fullName}`} />}
      <Link to={`/people/${person.orgId}/${person.id}`} className="row-main">
        <span className="row-title">
          {person.fullName}
          {!edit && <span className={`badge badge-${person.status}`}>{PERSON_STATUS_LABELS[person.status]}</span>}
          {family && <span className="badge badge-family">{family}</span>}
          {(person.possibleDuplicateIds?.length ?? 0) > 0 && <span className="badge badge-warn">Possible duplicate</span>}
        </span>
        <span className="row-detail">
          {formatPhone(person.phone) || 'No phone'}
          {orgName ? ` · ${orgName}` : ''}
        </span>
      </Link>
      {edit && <StatusPicker person={person} />}
    </li>
  );
}
